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
  users: {},          // userId -> fakeID
  confessions: {},    // confNum -> { userId, message, threadId }
  confessionCount: 0,
  dmChats: {},        // chatId -> { user1, user2, logs: [], active }
  chatCount: 0
};

function getFakeID(userId) {
  if (!data.users[userId]) {
    data.users[userId] = Math.floor(1000 + Math.random() * 9000);
  }
  return data.users[userId];
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
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send an anonymous confession')
      .addStringOption(option => option.setName('message').setDescription('Your confession').setRequired(true)),
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal the user behind a fake ID (admin only)')
      .addIntegerOption(option => option.setName('fakeid').setDescription('Fake ID to reveal').setRequired(true)),
    new SlashCommandBuilder()
      .setName('listchats')
      .setDescription('List all active DM chats (admin only)'),
    new SlashCommandBuilder()
      .setName('closechat')
      .setDescription('Close a specific DM chat')
      .addIntegerOption(option => option.setName('chatid').setDescription('Chat ID to close').setRequired(true)),
    new SlashCommandBuilder()
      .setName('closeallchats')
      .setDescription('Close all DM chats (admin only)'),
    new SlashCommandBuilder()
      .setName('report')
      .setDescription('Inspect a chat (admin only)')
      .addIntegerOption(option => option.setName('chatid').setDescription('Chat ID to inspect').setRequired(true))
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    const userFakeID = getFakeID(interaction.user.id);

    if (interaction.commandName === 'confess') {
      const msg = interaction.options.getString('message');
      data.confessionCount++;
      const confNum = data.confessionCount;

      const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) return interaction.editReply('Confession channel not found.');

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reply_${confNum}`)
          .setLabel('Reply anonymously')
          .setStyle(ButtonStyle.Primary)
      );

      const confMessage = await channel.send({
        content: `📩 **Confession #${confNum}**\n👤 User #${userFakeID}\n\n${msg}`,
        components: [buttonRow]
      });

      const thread = await confMessage.startThread({ name: `Confession #${confNum}`, autoArchiveDuration: 1440 });
      data.confessions[confNum] = { userId: interaction.user.id, message: msg, threadId: thread.id };

      dmAdmin(`👀 CONFESSION #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id}) as #${userFakeID}\n\n${msg}`);
      try { await interaction.user.send(`✅ You sent Confession #${confNum} as User #${userFakeID}`); } catch {}

      return interaction.editReply(`✅ Sent as Confession #${confNum}`);
    }

    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
      const fakeid = interaction.options.getInteger('fakeid');
      const realUser = Object.entries(data.users).find(([uid, fid]) => fid === fakeid);
      if (!realUser) return interaction.editReply('❌ Fake ID not found.');
      const user = await client.users.fetch(realUser[0]);
      return interaction.editReply(`👤 Fake ID #${fakeid} belongs to ${user.tag} (${user.id})`);
    }

    if (interaction.commandName === 'listchats') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
      const chats = Object.entries(data.dmChats).filter(([id, c]) => c.active).map(([id, c]) => `${id}: ${c.user1} ↔ ${c.user2}`);
      return interaction.editReply(chats.length ? chats.join('\n') : 'No active chats.');
    }

    if (interaction.commandName === 'closechat') {
      const chatId = `chat${interaction.options.getInteger('chatid')}`;
      if (!data.dmChats[chatId]) return interaction.editReply('❌ Chat not found.');
      data.dmChats[chatId].active = false;
      return interaction.editReply(`✅ Closed ${chatId}`);
    }

    if (interaction.commandName === 'closeallchats') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
      for (const c of Object.values(data.dmChats)) c.active = false;
      return interaction.editReply('✅ Closed all chats');
    }

    if (interaction.commandName === 'report') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
      const chatId = `chat${interaction.options.getInteger('chatid')}`;
      const chat = data.dmChats[chatId];
      if (!chat) return interaction.editReply('❌ Chat not found.');
      if (!chat.logs.length) return interaction.editReply('No messages in this chat.');
      const logMsgs = chat.logs.map(m => `${m.sender}: ${m.content}`).join('\n');
      return interaction.editReply(`Logs for ${chatId}:\n${logMsgs}`);
    }
  }

  // --- Button for replying ---
  if (interaction.isButton() && interaction.customId.startsWith('reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[1]);
    const modal = new ModalBuilder()
      .setCustomId(`modal_reply_${confNum}`)
      .setTitle(`Reply to Confession #${confNum}`);

    const input = new TextInputBuilder()
      .setCustomId('reply_input')
      .setLabel('Your anonymous reply')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // --- Modal submit ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[2]);
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const senderFakeID = getFakeID(interaction.user.id);

    const conf = data.confessions[confNum];
    if (!conf) return interaction.reply({ content: '❌ Original poster not found.', ephemeral: true });

    const thread = await client.channels.fetch(conf.threadId);
    await thread.send(`💬 Reply to Confession #${confNum}\n👤 User #${senderFakeID}\n${replyMsg}`);

    // Create DM chat
    data.chatCount++;
    const chatId = `chat${data.chatCount}`;
    data.dmChats[chatId] = { user1: conf.userId, user2: interaction.user.id, logs: [{ sender: senderFakeID, content: replyMsg }], active: true };

    try {
      const originalUser = await client.users.fetch(conf.userId);
      await originalUser.send(`💬 Anonymous #${senderFakeID} replied to Confession #${confNum}: "${replyMsg}"\nYou can reply to this message to continue anonymously.`);
    } catch {}

    dmAdmin(`👀 REPLY to #${confNum} by ${interaction.user.tag} (${interaction.user.id}) as #${senderFakeID}: ${replyMsg}`);

    return interaction.reply({ content: `✅ Reply sent and DM chat created (${chatId})!`, ephemeral: true });
  }
});

// --- DM forwarding ---
client.on('messageCreate', async message => {
  if (message.author.bot || message.channel.type !== 1) return;

  const senderFakeID = getFakeID(message.author.id);
  const chat = Object.entries(data.dmChats).find(([id, c]) => c.active && (c.user1 === message.author.id || c.user2 === message.author.id));
  if (!chat) return;

  const [chatId, c] = chat;
  c.logs.push({ sender: senderFakeID, content: message.content });

  const recipientId = c.user1 === message.author.id ? c.user2 : c.user1;
  dmAdmin(`👀 DM ${chatId} from ${message.author.tag} (${message.author.id}) as #${senderFakeID}: ${message.content}`);

  try {
    const recipient = await client.users.fetch(recipientId);
    recipient.send(`💬 Anonymous #${senderFakeID}: ${message.content}`);
  } catch {}
});

// --- Ready ---
client.on('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// --- Start ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
