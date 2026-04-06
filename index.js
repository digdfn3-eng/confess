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
  ChannelType
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const EXPOSE_CHANNEL_ID = process.env.EXPOSE_CHANNEL_ID; // For anonymous exposes

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
  confessions: {},        // confessionNum: { userId, message, replies: [] }
  confessionCount: 0,
  blacklisted: new Set(),
  replyCount: 0
};

// --- Utils ---
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
      .setName('reveal')
      .setDescription('Reveal the user behind a confession/reply')
      .addIntegerOption(option => option.setName('id').setDescription('Confession or reply ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Blacklist a user from confessing')
      .addUserOption(option => option.setName('user').setDescription('User to blacklist').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unblacklist')
      .setDescription('Remove a user from blacklist')
      .addUserOption(option => option.setName('user').setDescription('User to unblacklist').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show confession stats')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  // --- Slash Commands ---
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === 'confess') {
      if (data.blacklisted.has(interaction.user.id)) {
        return interaction.editReply('❌ You are blacklisted from confessing.');
      }

      // Show modal
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

    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin.');
      const id = interaction.options.getInteger('id');
      let entry = Object.entries(data.confessions).find(([num, conf]) => conf.randomID === id);
      if (!entry) {
        // search replies
        for (const [num, conf] of Object.entries(data.confessions)) {
          const reply = conf.replies.find(r => r.randomID === id);
          if (reply) entry = [num, reply];
        }
      }
      if (!entry) return interaction.editReply('❌ ID not found.');
      const user = await client.users.fetch(entry[1]?.userId || entry[1]?.userId || entry[1].userId);
      return interaction.editReply(`👤 ID ${id} belongs to ${user.tag}`);
    }

    if (interaction.commandName === 'blacklist') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin.');
      const user = interaction.options.getUser('user');
      data.blacklisted.add(user.id);
      return interaction.editReply(`✅ Blacklisted ${user.tag}`);
    }

    if (interaction.commandName === 'unblacklist') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin.');
      const user = interaction.options.getUser('user');
      data.blacklisted.delete(user.id);
      return interaction.editReply(`✅ Unblacklisted ${user.tag}`);
    }

    if (interaction.commandName === 'stats') {
      const total = Object.keys(data.confessions).length;
      const replies = Object.values(data.confessions).reduce((acc, c) => acc + c.replies.length, 0);
      return interaction.editReply(`📊 Total confessions: ${total}\n💬 Total replies: ${replies}`);
    }
  }

  // --- Modal Submit ---
  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'confess_modal') {
      const msg = interaction.fields.getTextInputValue('confess_input');
      const randomID = getRandomID();
      data.confessionCount++;
      const confNum = data.confessionCount;

      data.confessions[confNum] = { userId: interaction.user.id, message: msg, randomID, replies: [] };

      const replyBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reply_${confNum}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`report_${confNum}`).setLabel('Report').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ content: `✅ Confession #${confNum} sent as ID ${randomID}`, ephemeral: true });

      const confMsg = await channel.send({ content: `📩 **Confession #${confNum}**\nID: ${randomID}\n\n${msg}`, components: [replyBtn] });
      dmAdmin(`Confession #${confNum} from ${interaction.user.tag} (${interaction.user.id})\n${msg}`);
    }
  }

  // --- Button Clicks ---
  if (interaction.isButton()) {
    const [action, confNum] = interaction.customId.split('_');
    const conf = data.confessions[confNum];
    if (!conf) return interaction.reply({ content: '❌ Confession not found.', ephemeral: true });

    if (action === 'reply') {
      const modal = new ModalBuilder().setCustomId(`reply_modal_${confNum}`).setTitle(`Reply to Confession #${confNum}`);
      const input = new TextInputBuilder().setCustomId('reply_input').setLabel('Reply').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'report') {
      if (interaction.user.id === ADMIN_ID) return;
      const exposedMsg = `📢 Anonymous expose in chat\nID: ${conf.randomID}\nConfession: "${conf.message}"\nAhaaha dont do this again.`;
      const exposeChannel = await client.channels.fetch(EXPOSE_CHANNEL_ID);
      await exposeChannel.send({ content: exposedMsg });
      return interaction.reply({ content: '✅ Report sent', ephemeral: true });
    }
  }

  // --- Reply Modal Submit ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('reply_modal_')) {
    const confNum = interaction.customId.split('_')[2];
    const conf = data.confessions[confNum];
    if (!conf) return interaction.reply({ content: '❌ Confession not found', ephemeral: true });
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const randomID = getRandomID();
    data.replyCount++;
    const replyEntry = { userId: interaction.user.id, message: replyMsg, randomID, replies: [] };
    conf.replies.push(replyEntry);

    const replyBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`replyreply_${confNum}_${conf.replies.length-1}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`reportreply_${confNum}_${conf.replies.length-1}`).setLabel('Report').setStyle(ButtonStyle.Danger)
    );

    const confChannel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
    await confChannel.send({ content: `💬 Reply to Confession #${confNum}\nID: ${randomID}\n${replyMsg}`, components: [replyBtn] });

    dmAdmin(`Reply to Confession #${confNum} from ${interaction.user.tag} (${interaction.user.id})\n${replyMsg}`);

    return interaction.reply({ content: '✅ Reply sent', ephemeral: true });
  }
});

// --- Ready ---
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// --- Start ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
