const fs = require('fs');
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

// --- Load or initialize data ---
const DATA_FILE = './data.json';
let data = { users: {}, confessions: {}, dmChats: {}, nextConfession: 0, nextChatId: 1 };

if (fs.existsSync(DATA_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } 
  catch (e) { console.error('Failed to load data.json, starting fresh'); }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

// --- Helpers ---
function getFakeID(userId) {
  if (!data.users[userId]) data.users[userId] = Math.floor(1000 + Math.random() * 9000);
  saveData();
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
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('Missing TOKEN, CLIENT_ID, or GUILD_ID!');
    process.exit(1);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send an anonymous confession')
      .addStringOption(option =>
        option.setName('message')
          .setDescription('Your confession')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal the user behind a fake ID (admin only)')
      .addIntegerOption(option =>
        option.setName('fakeid')
          .setDescription('Fake ID to reveal')
          .setRequired(true)
      ),
    new SlashCommandBuilder().setName('inspect').setDescription('Inspect all in-memory data (admin only)'),
    new SlashCommandBuilder().setName('listchats').setDescription('List all active DM chats (admin only)'),
    new SlashCommandBuilder()
      .setName('closechat')
      .setDescription('Close a specific chat (admin only)')
      .addIntegerOption(option => option.setName('chatid').setDescription('Chat ID to close').setRequired(true)),
    new SlashCommandBuilder().setName('closeallchats').setDescription('Close all DM chats (admin only)')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  await interaction.deferReply({ ephemeral: true });

  // --- Confess ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'confess') {
    const msg = interaction.options.getString('message');
    const fakeID = getFakeID(interaction.user.id);
    data.nextConfession++;
    const confNum = data.nextConfession;

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`reply_${confNum}`).setLabel('Reply anonymously').setStyle(ButtonStyle.Primary)
    );

    const confMessage = await channel.send({
      content: `📩 **Confession #${confNum}**\n👤 User #${fakeID}\n\n${msg}`,
      components: [buttonRow]
    });

    const thread = await confMessage.startThread({ name: `Confession #${confNum}`, autoArchiveDuration: 1440 });
    data.confessions[confNum] = { userId: interaction.user.id, fakeID, message: msg, threadId: thread.id };
    saveData();

    dmAdmin(`👀 CONFESSION #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${fakeID}\n\n${msg}`);
    try { await interaction.user.send(`✅ You sent Confession #${confNum} as User #${fakeID}\n\n"${msg}"`); } catch {}

    return interaction.editReply(`✅ Sent as Confession #${confNum}`);
  }

  // --- Reveal ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'reveal') {
    if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
    const fakeid = interaction.options.getInteger('fakeid');
    const realUser = Object.entries(data.users).find(([uid, fid]) => fid === fakeid);
    if (!realUser) return interaction.editReply('❌ Fake ID not found.');
    const user = await client.users.fetch(realUser[0]);
    return interaction.editReply(`👤 Fake ID #${fakeid} belongs to ${user.tag} (${user.id})`);
  }

  // --- Inspect ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'inspect') {
    if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
    return interaction.editReply('```json\n' + JSON.stringify(data, null, 2) + '\n```');
  }

  // --- List Chats ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'listchats') {
    if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
    let list = '**Active DM Chats:**\n';
    for (const [id, chat] of Object.entries(data.dmChats)) list += `Chat #${id}: ${chat.user1} ↔ ${chat.user2}\n`;
    return interaction.editReply(list || 'No active chats.');
  }

  // --- Close Chat ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'closechat') {
    if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
    const chatId = interaction.options.getInteger('chatid');
    if (!data.dmChats[chatId]) return interaction.editReply('❌ Chat not found.');
    delete data.dmChats[chatId];
    saveData();
    return interaction.editReply(`✅ Closed Chat #${chatId}`);
  }

  // --- Close All Chats ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'closeallchats') {
    if (interaction.user.id !== ADMIN_ID) return interaction.editReply('❌ Only admin can use this.');
    data.dmChats = {};
    saveData();
    return interaction.editReply('✅ All chats closed.');
  }

  // --- Reply button ---
  if (interaction.isButton() && interaction.customId.startsWith('reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[1]);
    const modal = new ModalBuilder().setCustomId(`modal_reply_${confNum}`).setTitle(`Reply to Confession #${confNum}`);
    const input = new TextInputBuilder().setCustomId('reply_input').setLabel('Your anonymous reply').setStyle(TextInputStyle.Paragraph).setRequired(true);
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

    // Create DM chat
    const chatId = data.nextChatId++;
    data.dmChats[chatId] = { user1: conf.userId, user2: interaction.user.id };
    saveData();

    // DM original poster
    try {
      const recipient = await client.users.fetch(conf.userId);
      await recipient.send(`💬 Reply from Anonymous #${senderFakeID} regarding Confession #${confNum} (Chat #${chatId}):\n"${replyMsg}"\nReply here to continue anonymously.`);
    } catch {}

    // DM replier
    try { await interaction.user.send(`💬 You replied to Confession #${confNum} (Chat #${chatId}):\n"${replyMsg}"\nReply here to continue anonymously.`); } catch {}

    dmAdmin(`👀 REPLY to Confession #${confNum} | Chat #${chatId} | From: ${interaction.user.tag} (${interaction.user.id}) as #${senderFakeID}\n"${replyMsg}"`);

    return interaction.reply({ content: '✅ Your reply was sent anonymously and a DM chat was created!', ephemeral: true });
  }
});

// --- DM forwarding ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return;

  const chat = Object.entries(data.dmChats).find(([id, c]) => c.user1 === message.author.id || c.user2 === message.author.id);
  if (!chat) return;
  const chatId = chat[0];
  const chatData = chat[1];
  const recipientId = chatData.user1 === message.author.id ? chatData.user2 : chatData.user1;
  const senderFakeID = getFakeID(message.author.id);

  try {
    const recipient = await client.users.fetch(recipientId);
    await recipient.send(`💬 Anonymous #${senderFakeID} (Chat #${chatId}): ${message.content}`);
  } catch {}

  dmAdmin(`👀 DM Chat #${chatId} | From: ${message.author.tag} (${message.author.id}) as #${senderFakeID}\nMsg: "${message.content}"`);
});

// --- Ready ---
client.once('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// --- Start ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
