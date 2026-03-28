// index.js
import 'dotenv/config';
import fs from 'fs';
import {
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
} from 'discord.js';

// --- ENV ---
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;

// --- CLIENT ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

// --- DATA ---
let data = {
  users: {},
  threads: {},
  confessionCount: 0,
  dmChats: {},
  userChats: {},
  chatCount: 0,
  reports: {},
  reportCount: 0,
  logs: {}
};

// Load persistent logs if exist
if (fs.existsSync('./chat_logs.json')) {
  data.logs = JSON.parse(fs.readFileSync('./chat_logs.json'));
}

// --- UTIL FUNCTIONS ---
function getFakeID(userId) {
  if (!data.users[userId]) data.users[userId] = Math.floor(1000 + Math.random() * 9000);
  return data.users[userId];
}

async function dmAdmin(message) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(message);
  } catch {}
}

// --- REGISTER COMMANDS ---
async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('Missing TOKEN, CLIENT_ID, or GUILD_ID!');
    process.exit(1);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send an anonymous confession')
      .addStringOption(opt => opt.setName('message').setDescription('Your confession').setRequired(true)),

    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal the user behind a fake ID (admin only)')
      .addIntegerOption(opt => opt.setName('fakeid').setDescription('Fake ID to reveal').setRequired(true)),

    new SlashCommandBuilder()
      .setName('listchats')
      .setDescription('List all active chats (admin only)'),

    new SlashCommandBuilder()
      .setName('closechat')
      .setDescription('Close a chat')
      .addIntegerOption(opt => opt.setName('id').setDescription('Chat ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('closeallchats')
      .setDescription('Close all chats (admin only)'),

    new SlashCommandBuilder()
      .setName('inspectchat')
      .setDescription('Inspect chat participants (admin only)')
      .addIntegerOption(opt => opt.setName('id').setDescription('Chat ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('report')
      .setDescription('Report a chat')
      .addIntegerOption(opt => opt.setName('chatid').setDescription('Chat ID to report').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for report').setRequired(true)),

    new SlashCommandBuilder()
      .setName('viewchatlogs')
      .setDescription('View full chat logs (admin only)')
      .addIntegerOption(opt => opt.setName('id').setDescription('Chat ID').setRequired(true))
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- INTERACTIONS ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);

  if (!channel?.isTextBased()) return;

  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    // --- CONFESS ---
    if (interaction.commandName === 'confess') {
      const msg = interaction.options.getString('message');
      const fakeID = getFakeID(interaction.user.id);
      data.confessionCount++;
      const confNum = data.confessionCount;

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reply_${confNum}`).setLabel('Reply anonymously').setStyle(ButtonStyle.Primary)
      );

      const confMessage = await channel.send({
        content: `📩 **Confession #${confNum}**\n👤 User #${fakeID}\n\n${msg}`,
        components: [buttonRow]
      });

      const thread = await confMessage.startThread({ name: `Confession #${confNum}`, autoArchiveDuration: 1440 });
      data.threads[confNum] = thread.id;

      dmAdmin(`👀 CONFESSION #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${fakeID}\n\n${msg}`);

      try { await interaction.user.send(`✅ You sent Confession #${confNum} as User #${fakeID}\n\n"${msg}"`); } catch {}

      await interaction.editReply({ content: `✅ Sent as Confession #${confNum}` });
    }

    // --- REVEAL ---
    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Only the admin can use this.' });
      const fakeid = interaction.options.getInteger('fakeid');
      const realUser = Object.entries(data.users).find(([uid, fid]) => fid === fakeid);
      if (!realUser) return interaction.editReply({ content: '❌ Fake ID not found.' });
      const user = await client.users.fetch(realUser[0]);
      interaction.editReply({ content: `👤 Fake ID #${fakeid} belongs to ${user.tag} (${user.id})` });
    }

    // --- LIST CHATS ---
    if (interaction.commandName === 'listchats') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.', ephemeral: true });
      const activeChats = Object.values(data.dmChats).filter(c => c.active);
      if (activeChats.length === 0) return interaction.editReply({ content: 'No active chats.', ephemeral: true });

      let msg = '📋 Active Chats:\n';
      for (const chat of activeChats) msg += `Chat #${chat.id}\n`;
      interaction.editReply({ content: msg, ephemeral: true });
    }

    // --- CLOSE CHAT ---
    if (interaction.commandName === 'closechat') {
      const chatId = interaction.options.getInteger('id');
      const chat = data.dmChats[chatId];
      if (!chat || !chat.active) return interaction.editReply({ content: '❌ Chat not found or already closed.', ephemeral: true });
      if (![chat.user1, chat.user2, ADMIN_ID].includes(interaction.user.id)) return interaction.editReply({ content: '❌ Not part of this chat.', ephemeral: true });

      chat.active = false;
      for (const uid of [chat.user1, chat.user2, ADMIN_ID]) {
        try { const u = await client.users.fetch(uid); await u.send(`🔒 Chat #${chatId} has been closed.`); } catch {}
      }
      interaction.editReply({ content: `✅ Closed Chat #${chatId}`, ephemeral: true });
    }

    // --- CLOSE ALL CHATS ---
    if (interaction.commandName === 'closeallchats') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.', ephemeral: true });
      for (const chat of Object.values(data.dmChats)) {
        if (!chat.active) continue;
        chat.active = false;
        for (const uid of [chat.user1, chat.user2, ADMIN_ID]) {
          try { const u = await client.users.fetch(uid); await u.send(`🔒 Chat #${chat.id} closed by admin.`); } catch {}
        }
      }
      interaction.editReply({ content: '✅ All chats closed.', ephemeral: true });
    }

    // --- INSPECT CHAT ---
    if (interaction.commandName === 'inspectchat') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.', ephemeral: true });
      const chatId = interaction.options.getInteger('id');
      const chat = data.dmChats[chatId];
      if (!chat) return interaction.editReply({ content: '❌ Chat not found.', ephemeral: true });

      const user1 = await client.users.fetch(chat.user1);
      const user2 = await client.users.fetch(chat.user2);
      interaction.editReply({
        content: `🔍 Chat #${chatId}\nUser 1: ${user1.tag} (${user1.id})\nUser 2: ${user2.tag} (${user2.id})\nStatus: ${chat.active ? '🟢 Active' : '🔴 Closed'}`,
        ephemeral: true
      });
    }

    // --- REPORT ---
    if (interaction.commandName === 'report') {
      const chatId = interaction.options.getInteger('chatid');
      const reason = interaction.options.getString('reason');
      const chat = data.dmChats[chatId];
      if (!chat) return interaction.editReply({ content: '❌ Chat not found.', ephemeral: true });

      data.reportCount++;
      const reportId = data.reportCount;
      data.reports[reportId] = { id: reportId, chatId, reporter: interaction.user.id, reason, timestamp: Date.now() };

      await interaction.editReply({ content: `🚨 Report submitted (ID: ${reportId}). Admin notified.`, ephemeral: true });
      dmAdmin(`🚨 REPORT #${reportId}\nChat: #${chatId}\nReporter: ${interaction.user.tag} (${interaction.user.id})\nReason:\n${reason}`);
    }

    // --- VIEW CHAT LOGS ---
    if (interaction.commandName === 'viewchatlogs') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.', ephemeral: true });
      const chatId = interaction.options.getInteger('id');
      const log = data.logs[chatId];
      if (!log || log.length === 0) return interaction.editReply({ content: '❌ No logs.', ephemeral: true });

      let msg = `📜 Logs for Chat #${chatId}:\n\n`;
      for (const m of log) {
        const sender = await client.users.fetch(m.sender);
        msg += `[${new Date(m.timestamp).toLocaleString()}] ${sender.tag} (ID: ${m.sender}, Fake: #${m.fakeID}): ${m.content}\n`;
      }

      const chunks = msg.match(/[\s\S]{1,1900}/g);
      for (const chunk of chunks) await interaction.user.send(chunk);
      interaction.editReply({ content: '✅ Chat logs sent to your DM.', ephemeral: true });
    }
  }

  // --- BUTTON REPLIES / MODALS ---
  if (interaction.isButton() && interaction.customId.startsWith('reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[1]);
    const modal = new ModalBuilder().setCustomId(`modal_reply_${confNum}`).setTitle(`Reply to Confession #${confNum}`);
    const input = new TextInputBuilder().setCustomId('reply_input').setLabel('Your anonymous reply').setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    interaction.showModal(modal);
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[2]);
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const senderFakeID = getFakeID(interaction.user.id);

    const threadId = data.threads[confNum];
    if (!threadId) return interaction.reply({ content: '❌ Confession thread not found.', ephemeral: true });

    const thread = await client.channels.fetch(threadId);
    await thread.send(`💬 **Reply to Confession #${confNum}**\n👤 User #${senderFakeID}\n\n${replyMsg}`);

    // --- Create DM chat ---
    data.chatCount++;
    const chatId = data.chatCount;
    const originalUserId = Object.entries(data.users).find(([uid, fid]) => fid === getFakeID(interaction.user.id))?.[0] || interaction.user.id;

    data.dmChats[chatId] = { id: chatId, user1: interaction.user.id, user2: originalUserId, active: true };
    if (!data.userChats[interaction.user.id]) data.userChats[interaction.user.id] = [];
    if (!data.userChats[originalUserId]) data.userChats[originalUserId] = [];
    data.userChats[interaction.user.id].push(chatId);
    data.userChats[originalUserId].push(chatId);

    // Log message
    data.logs[chatId] = [{
      timestamp: Date.now(),
      sender: interaction.user.id,
      fakeID: senderFakeID,
      content: replyMsg
    }];

    dmAdmin(`👀 REPLY to #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${senderFakeID}\n\n${replyMsg}`);

    try {
      const recipient = await client.users.fetch(originalUserId);
      await recipient.send(`💬 [Chat #${chatId}] Anonymous #${senderFakeID}: ${replyMsg}\nReply here to continue conversation. Use /closechat ${chatId} to end.`);
    } catch {}

    interaction.reply({ content: '✅ Your reply was sent anonymously and DM chat started!', ephemeral: true });

    // Save logs persistently
    fs.writeFileSync('./chat_logs.json', JSON.stringify(data.logs, null, 2));
  }
});

// --- DM FORWARDING ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return;

  const userChats = data.userChats?.[message.author.id];
  if (!userChats || userChats.length === 0) return;

  const chatId = userChats[userChats.length - 1];
  const chat = data.dmChats[chatId];
  if (!chat || !chat.active) return;

  const senderFakeID = getFakeID(message.author.id);
  const participants = [chat.user1, chat.user2, ADMIN_ID];

  for (const uid of participants) {
    if (uid === message.author.id) continue;
    try {
      const user = await client.users.fetch(uid);
      if (uid === ADMIN_ID) {
        await user.send(`👀 Chat #${chatId}\nFrom: ${message.author.tag} (${message.author.id})\nFake ID: #${senderFakeID}\n${message.content}`);
      } else {
        await user.send(`💬 [Chat #${chatId}] Anonymous #${senderFakeID}: ${message.content}`);
      }
    } catch {}
  }

  // Log message
  if (!data.logs[chatId]) data.logs[chatId] = [];
  data.logs[chatId].push({
    timestamp: Date.now(),
    sender: message.author.id,
    fakeID: senderFakeID,
    content: message.content
  });

  // Save logs persistently
  fs.writeFileSync('./chat_logs.json', JSON.stringify(data.logs, null, 2));
});

// --- READY ---
client.once('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// --- LOGIN & REGISTER ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
