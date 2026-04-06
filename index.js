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
const EXPOSE_CHANNEL_ID = '1490140096517767268';

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
  confessions: {}, // confessionID: {userId, message, replies: [{id, parentId, userId, message}]}
  threads: {},     // confessionID: threadId
  blacklisted: new Set(),
  confessionCount: 0,
  replyCount: 0
};

// --- Helpers ---
function randomID() {
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
  const commands = [
    new SlashCommandBuilder().setName('confess').setDescription('Send an anonymous confession'),
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal a user by confession ID')
      .addIntegerOption(opt => opt.setName('id').setDescription('Confession ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Blacklist a user by ID')
      .addUserOption(opt => opt.setName('user').setDescription('User to blacklist').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unblacklist')
      .setDescription('Remove user from blacklist')
      .addUserOption(opt => opt.setName('user').setDescription('User to unblacklist').setRequired(true)),
    new SlashCommandBuilder().setName('stats').setDescription('Show confession stats')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interactions ---
client.on('interactionCreate', async interaction => {
  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'confess') {
      if (data.blacklisted.has(interaction.user.id)) return interaction.reply({ content: '❌ You are blacklisted.', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('modal_confess').setTitle('Send Anonymous Confession');
      const input = new TextInputBuilder().setCustomId('confess_input').setLabel('Your confession').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Only admin.', ephemeral: true });
      const id = interaction.options.getInteger('id');
      const conf = data.confessions[id];
      if (!conf) return interaction.reply({ content: '❌ Not found.', ephemeral: true });
      const user = await client.users.fetch(conf.userId);
      return interaction.reply({ content: `👤 Confession #${id} by ${user.tag}` });
    }

    if (interaction.commandName === 'blacklist') {
      if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Only admin.', ephemeral: true });
      const user = interaction.options.getUser('user');
      data.blacklisted.add(user.id);
      return interaction.reply({ content: `✅ Blacklisted ${user.tag}` });
    }

    if (interaction.commandName === 'unblacklist') {
      if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Only admin.', ephemeral: true });
      const user = interaction.options.getUser('user');
      data.blacklisted.delete(user.id);
      return interaction.reply({ content: `✅ Unblacklisted ${user.tag}` });
    }

    if (interaction.commandName === 'stats') {
      return interaction.reply({ content: `📄 Total confessions: ${data.confessionCount}\nTotal replies: ${data.replyCount}`, ephemeral: true });
    }
  }

  // --- Modal submit ---
  if (interaction.type === InteractionType.ModalSubmit) {
    // Confession modal
    if (interaction.customId === 'modal_confess') {
      const msg = interaction.fields.getTextInputValue('confess_input');
      const id = ++data.confessionCount;
      const fakeId = randomID();
      data.confessions[id] = { userId: interaction.user.id, message: msg, replies: [] };

      const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reply_${id}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`report_${id}`).setLabel('Report').setStyle(ButtonStyle.Danger)
      );

      const confMessage = await channel.send({ content: `📩 **Confession #${id}**\n👤 User #${fakeId}\n\n${msg}`, components: [buttonRow] });
      const thread = await confMessage.startThread({ name: `Confession #${id}`, autoArchiveDuration: 1440 });
      data.threads[id] = thread.id;

      dmAdmin(`📨 CONFESSION #${id}\nUser: ${interaction.user.tag}\nID: ${id}\nMessage: ${msg}`);
      await interaction.user.send(`✅ Sent Confession #${id} as User #${fakeId}`);
      return interaction.reply({ content: `✅ Confession #${id} sent!`, ephemeral: true });
    }

    // Reply modal
    if (interaction.customId.startsWith('modal_reply_')) {
      const id = parseInt(interaction.customId.split('_')[2]);
      const parentReplyId = parseInt(interaction.customId.split('_')[3]) || null; // optional parent reply
      const conf = data.confessions[id];
      if (!conf) return interaction.reply({ content: '❌ Confession not found.', ephemeral: true });

      const replyMsg = interaction.fields.getTextInputValue('reply_input');
      const replyId = ++data.replyCount;
      conf.replies.push({ id: replyId, parentId: parentReplyId, userId: interaction.user.id, message: replyMsg });

      const thread = await client.channels.fetch(data.threads[id]);
      let replyText = `💬 Reply #${replyId}`;
      if (parentReplyId) replyText += ` to Reply #${parentReplyId}`;
      replyText += `:\n${replyMsg}`;
      await thread.send(replyText);

      dmAdmin(`💬 REPLY to Confession #${id}\nUser: ${interaction.user.tag}\nMessage: ${replyMsg}`);
      return interaction.reply({ content: '✅ Reply sent!', ephemeral: true });
    }
  }

  // --- Button interactions ---
  if (interaction.isButton()) {
    const [action, idStr, replyIdStr] = interaction.customId.split('_');
    const id = parseInt(idStr);
    const conf = data.confessions[id];
    if (!conf) return interaction.reply({ content: '❌ Confession not found.', ephemeral: true });

    if (action === 'reply') {
      const modal = new ModalBuilder().setCustomId(`modal_reply_${id}_${replyIdStr || ''}`).setTitle(`Reply to Confession #${id}`);
      const input = new TextInputBuilder().setCustomId('reply_input').setLabel('Your reply').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'report') {
      const channel = await client.channels.fetch(EXPOSE_CHANNEL_ID);
      await channel.send({ content: `⚠️ **Anonymous expose**\nUser: <@${conf.userId}>\nMessage: "${conf.message}"\nDon't do this again!` });
      data.blacklisted.add(conf.userId);
      return interaction.reply({ content: '✅ Confession reported and user blacklisted.', ephemeral: true });
    }
  }
});

// --- Ready ---
client.on('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// --- Start bot ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
