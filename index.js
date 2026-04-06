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
  InteractionType,
  PermissionsBitField
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const EXPOSE_CHANNEL_ID = '1490140096517767268';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

// --- In-memory data ---
const data = { users: {}, threads: {}, confessionCount: 0, blacklisted: new Set() };

function getRandomID() {
  return Math.floor(1000 + Math.random() * 9000);
}

async function dmAdmin(message) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(message);
  } catch {}
}

// --- Register slash commands ---
async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('Missing TOKEN, CLIENT_ID, or GUILD_ID!');
    process.exit(1);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send an anonymous confession'),
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal a user behind a confession (admin only)')
      .addIntegerOption(option =>
        option.setName('id')
          .setDescription('Confession ID')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('See bot stats')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const confChannel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!confChannel?.isTextBased()) return;

  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === 'confess') {
      if (data.blacklisted.has(interaction.user.id)) {
        return interaction.editReply({ content: '❌ You are blacklisted from sending confessions.' });
      }

      // Show modal
      const modal = new ModalBuilder()
        .setCustomId('modal_confess')
        .setTitle('Send Anonymous Confession');

      const input = new TextInputBuilder()
        .setCustomId('confess_input')
        .setLabel('Your confession')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Only admin can use this.' });
      const confID = interaction.options.getInteger('id');
      const confUser = data.users[confID];
      if (!confUser) return interaction.editReply({ content: '❌ Confession not found.' });
      const user = await client.users.fetch(confUser);
      return interaction.editReply({ content: `User who sent Confession #${confID}: ${user.tag} (${user.id})` });
    }

    if (interaction.commandName === 'stats') {
      return interaction.editReply({ content: `📊 Confessions sent: ${data.confessionCount}\nBlacklisted users: ${data.blacklisted.size}` });
    }
  }

  // --- Modal submit ---
  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'modal_confess') {
      const msg = interaction.fields.getTextInputValue('confess_input');
      const confID = ++data.confessionCount;
      const fakeID = getRandomID();
      data.users[confID] = interaction.user.id;

      // Create reply & report buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reply_${confID}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`report_${confID}`).setLabel('Report').setStyle(ButtonStyle.Danger)
      );

      const confMsg = await confChannel.send({
        content: `📩 **Confession #${confID}**\n👤 User #${fakeID}\n\n${msg}`,
        components: [row]
      });

      // Start a thread for replies
      const thread = await confMsg.startThread({ name: `Confession #${confID}`, autoArchiveDuration: 1440 });
      data.threads[confID] = thread.id;

      dmAdmin(`👀 CONFESSION #${confID}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nMessage: ${msg}`);
      await interaction.user.send(`✅ Sent Confession #${confID} as User #${fakeID}\n\n"${msg}"`);
      return interaction.editReply({ content: `✅ Your confession was sent as #${confID}` });
    }

    if (interaction.customId.startsWith('modal_reply_')) {
      const confID = parseInt(interaction.customId.split('_')[2]);
      const replyMsg = interaction.fields.getTextInputValue('reply_input');
      const senderID = interaction.user.id;

      const threadId = data.threads[confID];
      if (!threadId) return interaction.reply({ content: '❌ Confession thread not found.', ephemeral: true });
      const thread = await client.channels.fetch(threadId);

      // Send reply in thread
      await thread.send(`💬 **Reply to Confession #${confID}**\n👤 User: Anonymous\n\n${replyMsg}`);
      dmAdmin(`👀 REPLY to #${confID} from ${interaction.user.tag} (${senderID}): ${replyMsg}`);
      return interaction.reply({ content: '✅ Your reply was sent anonymously!', ephemeral: true });
    }
  }

  // --- Buttons ---
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('reply_')) {
      const confID = parseInt(interaction.customId.split('_')[1]);
      const modal = new ModalBuilder()
        .setCustomId(`modal_reply_${confID}`)
        .setTitle(`Reply to Confession #${confID}`);

      const input = new TextInputBuilder()
        .setCustomId('reply_input')
        .setLabel('Your anonymous reply')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId.startsWith('report_')) {
      const confID = parseInt(interaction.customId.split('_')[1]);
      const reportedUserID = data.users[confID];
      if (!reportedUserID) return interaction.reply({ content: '❌ User not found.', ephemeral: true });

      data.blacklisted.add(reportedUserID);

      // Delete confession
      const threadId = data.threads[confID];
      if (threadId) {
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (thread) await thread.delete().catch(() => {});
      }

      const confMsg = await confChannel.messages.fetch({ limit: 100 }).then(msgs => msgs.find(m => m.content.includes(`Confession #${confID}`)));
      if (confMsg) await confMsg.delete().catch(() => {});

      // Send expose
      const exposeChannel = await client.channels.fetch(EXPOSE_CHANNEL_ID);
      if (exposeChannel?.isTextBased()) {
        exposeChannel.send(`💥 **Anonymous Expose**\n<@${reportedUserID}> dont ever do this again ur exposed!`);
      }

      return interaction.reply({ content: '✅ Report submitted and user blacklisted.', ephemeral: true });
    }
  }
});

// --- Ready ---
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// --- Start bot ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
