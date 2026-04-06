require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const EXPOSE_CHANNEL_ID = '1490140096517767268'; // channel for exposes
const ADMIN_ID = process.env.ADMIN_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// --- In-memory data ---
const data = {
  confessions: {}, // confessionID -> {userId, message, replies: [{userId,msg,replyTo}]}
  blacklist: new Set(),
  confessionCount: 0
};

// --- Helper functions ---
function getRandomID() {
  return Math.floor(1000 + Math.random() * 9000);
}

async function dmAdmin(msg) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(msg);
  } catch {}
}

// --- Register slash commands ---
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send an anonymous confession'),
    new SlashCommandBuilder()
      .setName('unblacklist')
      .setDescription('Unblacklist a user')
      .addUserOption(option => option.setName('user').setDescription('User to unblacklist').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show confession stats')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {

  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'confess') {
      if (data.blacklist.has(interaction.user.id)) {
        return interaction.reply({ content: '❌ You are blacklisted.', flags: 64 });
      }

      const modal = new ModalBuilder()
        .setCustomId('confess_modal')
        .setTitle('Anonymous Confession');

      const input = new TextInputBuilder()
        .setCustomId('confess_input')
        .setLabel('Your confession')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.commandName === 'unblacklist') {
      const user = interaction.options.getUser('user');
      data.blacklist.delete(user.id);
      return interaction.reply({ content: `✅ ${user.tag} unblacklisted.`, flags: 64 });
    }

    if (interaction.commandName === 'stats') {
      return interaction.reply({ content: `📄 Total confessions: ${data.confessionCount}`, flags: 64 });
    }
  }

  // --- Modal submit ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'confess_modal') {
    const msg = interaction.fields.getTextInputValue('confess_input');
    const confessionID = ++data.confessionCount;
    const fakeID = getRandomID();

    data.confessions[confessionID] = { userId: interaction.user.id, message: msg, replies: [] };

    const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
    const reportButton = new ButtonBuilder()
      .setCustomId(`report_${confessionID}`)
      .setLabel('Report')
      .setStyle(ButtonStyle.Danger);

    const replyButton = new ButtonBuilder()
      .setCustomId(`reply_${confessionID}_0`)
      .setLabel('Reply')
      .setStyle(ButtonStyle.Primary);

    await channel.send({
      content: `📩 **Confession #${confessionID}**\n👤 User #${fakeID}\n\n${msg}`,
      components: [new ActionRowBuilder().addComponents(replyButton, reportButton)]
    });

    dmAdmin(`👀 CONFESSION #${confessionID}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${fakeID}\n\n${msg}`);
    return interaction.reply({ content: `✅ Sent as Confession #${confessionID}`, flags: 64 });
  }

  // --- Button interactions ---
  if (interaction.isButton()) {
    const [action, confessionID, replyIndex] = interaction.customId.split('_');
    const confession = data.confessions[confessionID];
    if (!confession) return interaction.reply({ content: '❌ Confession not found.', flags: 64 });

    // Reply button
    if (action === 'reply') {
      const modal = new ModalBuilder()
        .setCustomId(`reply_modal_${confessionID}_${replyIndex}`)
        .setTitle(`Reply to Confession #${confessionID}`);

      const input = new TextInputBuilder()
        .setCustomId('reply_input')
        .setLabel('Your anonymous reply')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // Report button
    if (action === 'report') {
      const userId = confession.userId;
      data.blacklist.add(userId);
      const exposeChannel = await client.channels.fetch(EXPOSE_CHANNEL_ID);
      await exposeChannel.send(`📢 **Expose Confession #${confessionID}**\nAhaaha, don't do this again! <@${userId}>`);
      return interaction.reply({ content: `✅ Reported and blacklisted.`, flags: 64 });
    }
  }

  // --- Reply modal submit ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('reply_modal_')) {
    const parts = interaction.customId.split('_');
    const confessionID = parts[2];
    const replyTo = parseInt(parts[3]);

    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const confession = data.confessions[confessionID];
    if (!confession) return interaction.reply({ content: '❌ Confession not found.', flags: 64 });

    confession.replies.push({ userId: interaction.user.id, msg: replyMsg, replyTo });
    const replyIndex = confession.replies.length;

    const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
    const reportButton = new ButtonBuilder()
      .setCustomId(`report_${confessionID}`)
      .setLabel('Report')
      .setStyle(ButtonStyle.Danger);

    const replyButton = new ButtonBuilder()
      .setCustomId(`reply_${confessionID}_${replyIndex}`)
      .setLabel('Reply')
      .setStyle(ButtonStyle.Primary);

    await channel.send({
      content: `💬 **Reply to Confession #${confessionID} (Reply #${replyIndex})**\n👤 User #${getRandomID()}\n\n${replyMsg}`,
      components: [new ActionRowBuilder().addComponents(replyButton, reportButton)]
    });

    dmAdmin(`👀 REPLY to #${confessionID}\nFrom: ${interaction.user.tag} (${interaction.user.id})\n\n${replyMsg}`);
    return interaction.reply({ content: '✅ Your reply was sent anonymously!', flags: 64 });
  }

});

// --- Client ready ---
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// --- Start bot ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
