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
  ],
  partials: ['CHANNEL']
});

// --- In-memory data ---
const data = {
  users: {},           // userId => fakeID
  threads: {},         // confNum => threadId
  confessionCount: 0,
  chats: {},           // chatId => {users: [user1,user2], messages: []}
  activeChats: {}      // userId => chatId
};
let chatCounter = 0;

// --- Helpers ---
function getFakeID(userId) {
  if (!data.users[userId]) {
    data.users[userId] = Math.floor(1000 + Math.random() * 9000);
  }
  return data.users[userId];
}

async function dmAdmin(msg) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(msg);
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
      .addStringOption(option => option.setName('message').setDescription('Your confession').setRequired(true)),

    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal a fake ID (admin only)')
      .addIntegerOption(option => option.setName('fakeid').setDescription('Fake ID to reveal').setRequired(true)),

    new SlashCommandBuilder()
      .setName('listchats')
      .setDescription('List all active DM chats (admin only)'),

    new SlashCommandBuilder()
      .setName('inspect')
      .setDescription('Inspect a chat by ID (admin only)')
      .addIntegerOption(option => option.setName('chatid').setDescription('Chat ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('closechat')
      .setDescription('Close a chat by ID (admin only)')
      .addIntegerOption(option => option.setName('chatid').setDescription('Chat ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('closeallchats')
      .setDescription('Close all chats (admin only)')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton() && interaction.type !== InteractionType.ModalSubmit) return;
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);

  // --- Slash Commands ---
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    // CONFESS
    if (interaction.commandName === 'confess') {
      const msg = interaction.options.getString('message');
      const fakeID = getFakeID(interaction.user.id);
      data.confessionCount++;
      const confNum = data.confessionCount;

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reply_${confNum}`)
          .setLabel('Reply anonymously')
          .setStyle(ButtonStyle.Primary)
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

    // REVEAL
    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Only the admin can use this.' });
      const fakeid = interaction.options.getInteger('fakeid');
      const realUser = Object.entries(data.users).find(([uid, fid]) => fid === fakeid);
      if (!realUser) return interaction.editReply({ content: '❌ Fake ID not found.' });
      const user = await client.users.fetch(realUser[0]);
      interaction.editReply({ content: `👤 Fake ID #${fakeid} belongs to ${user.tag} (${user.id})` });
    }

    // LIST CHATS
    if (interaction.commandName === 'listchats') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.' });
      if (!Object.keys(data.chats).length) return interaction.editReply({ content: '❌ No active chats.' });
      let list = Object.entries(data.chats).map(([id, c]) => `Chat #${id} with Users: ${c.users.map(u => getFakeID(u)).join(', ')}`).join('\n');
      interaction.editReply({ content: `📂 Active Chats:\n${list}` });
    }

    // INSPECT CHAT
    if (interaction.commandName === 'inspect') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.' });
      const chatid = interaction.options.getInteger('chatid');
      const chat = data.chats[chatid];
      if (!chat) return interaction.editReply({ content: '❌ Chat not found.' });
      let log = chat.messages.map(m => `${getFakeID(m.from)}: ${m.content}`).join('\n');
      interaction.editReply({ content: `📝 Chat #${chatid} Log:\n${log}` });
    }

    // CLOSE CHAT
    if (interaction.commandName === 'closechat') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.' });
      const chatid = interaction.options.getInteger('chatid');
      if (!data.chats[chatid]) return interaction.editReply({ content: '❌ Chat not found.' });
      for (const u of data.chats[chatid].users) delete data.activeChats[u];
      delete data.chats[chatid];
      interaction.editReply({ content: `✅ Chat #${chatid} closed.` });
    }

    // CLOSE ALL CHATS
    if (interaction.commandName === 'closeallchats') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Admin only.' });
      data.chats = {};
      data.activeChats = {};
      chatCounter = 0;
      interaction.editReply({ content: '✅ All chats closed.' });
    }
  }

  // --- Reply Button ---
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
    interaction.showModal(modal);
  }

  // --- Modal Submit ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[2]);
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const senderId = interaction.user.id;
    const senderFakeID = getFakeID(senderId);

    // Start a new chat with original poster
    const threadId = data.threads[confNum];
    if (!threadId) return interaction.reply({ content: '❌ Confession thread not found.', ephemeral: true });

    const thread = await client.channels.fetch(threadId);

    // Find original poster by checking who posted confession in memory
    const originalPosterId = Object.entries(data.users).find(([uid,fid]) => fid === parseInt(thread.name.split('#')[1]))?.[0] || null;

    if (!originalPosterId) return interaction.reply({ content: '❌ Original poster not found.', ephemeral: true });

    // Assign chat
    chatCounter++;
    const chatId = chatCounter;
    data.chats[chatId] = {
      users: [senderId, originalPosterId],
      messages: [{ from: senderId, content: replyMsg }]
    };
    data.activeChats[senderId] = chatId;
    data.activeChats[originalPosterId] = chatId;

    // Notify both users
    const poster = await client.users.fetch(originalPosterId);
    poster.send(`💬 You got a reply to your confession (Chat #${chatId}) from an anonymous user:\n"${replyMsg}"\nReply here to continue the conversation.`).catch(() => {});
    interaction.user.send(`💬 Your reply was sent (Chat #${chatId}). You can reply here to continue the conversation.`).catch(() => {});

    // Log for admin
    dmAdmin(`👀 REPLY to Confession #${confNum} (Chat #${chatId})\nFrom: ${interaction.user.tag} (${senderId})\nMessage: ${replyMsg}`);

    interaction.reply({ content: `✅ Reply sent anonymously in Chat #${chatId}`, ephemeral: true });
  }
});

// --- DM handling ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return; // Only DMs

  const userId = message.author.id;
  const chatId = data.activeChats[userId];
  if (!chatId) return;

  const chat = data.chats[chatId];
  const otherUserId = chat.users.find(u => u !== userId);

  chat.messages.push({ from: userId, content: message.content });

  // Forward message to other participant
  try {
    const otherUser = await client.users.fetch(otherUserId);
    otherUser.send(`💬 Chat #${chatId} | Anonymous: ${message.content}`).catch(() => {});
  } catch {}

  // Log for admin
  dmAdmin(`👀 DM in Chat #${chatId} | From ${message.author.tag} (${userId}): ${message.content}`);
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
