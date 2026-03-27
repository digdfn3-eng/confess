require('dotenv').config();
const fs = require('fs');
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

// --- Persistent data ---
let data = { users: {}, threads: {}, confessionCount: 0, dmChats: {} };

// Auto-create data.json if missing
if (!fs.existsSync('data.json')) {
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ data.json initialized.');
} else {
  try {
    data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  } catch (e) {
    console.error('⚠️ data.json corrupted. Re-initializing...');
    data = { users: {}, threads: {}, confessionCount: 0, dmChats: {} };
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  }
}

function saveData() {
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
}

// Get persistent fake ID for a user
function getFakeID(userId) {
  if (!data.users[userId]) {
    const fake = Math.floor(1000 + Math.random() * 9000);
    data.users[userId] = fake;
    saveData();
  }
  return data.users[userId];
}

// --- Register slash commands ---
async function registerCommands() {
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
      .setDescription('Reveal the real user behind a fake ID (admin only)')
      .addIntegerOption(option =>
        option.setName('fakeid')
          .setDescription('Fake ID to reveal')
          .setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Registered slash commands.');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// --- Helper to DM admin ---
async function dmAdmin(message) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    admin.send(message).catch(() => {});
  } catch {}
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {

    // /confess
    if (interaction.commandName === 'confess') {
      const msg = interaction.options.getString('message');
      const fakeID = getFakeID(interaction.user.id);
      data.confessionCount++;
      const confNum = data.confessionCount;

      // Post anonymous confession with reply button
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

      // Create a thread
      const thread = await confMessage.startThread({
        name: `Confession #${confNum}`,
        autoArchiveDuration: 1440
      });
      data.threads[confNum] = thread.id;
      saveData();

      // DM admin
      dmAdmin(`👀 CONFESSION #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${fakeID}\n\n${msg}`);

      // DM user confirmation
      interaction.user.send(`✅ You sent Confession #${confNum} as User #${fakeID}\n\n"${msg}"`).catch(() => {});

      await interaction.reply({ content: `✅ Sent as Confession #${confNum}`, ephemeral: true });
    }

    // /reveal
    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Only the admin can use this.', ephemeral: true });
      const fakeid = interaction.options.getInteger('fakeid');
      const realUser = Object.entries(data.users).find(([uid, fid]) => fid === fakeid);
      if (!realUser) return interaction.reply({ content: '❌ Fake ID not found.', ephemeral: true });
      const user = await client.users.fetch(realUser[0]);
      interaction.reply({ content: `👤 Fake ID #${fakeid} belongs to ${user.tag} (${user.id})`, ephemeral: true });
    }
  }

  // --- Reply button ---
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

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);
    interaction.showModal(modal);
  }

  // --- Modal submit for reply ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[2]);
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const senderFakeID = getFakeID(interaction.user.id);

    const threadId = data.threads[confNum];
    if (!threadId) return interaction.reply({ content: '❌ Confession thread not found.', ephemeral: true });

    const thread = await client.channels.fetch(threadId);
    await thread.send(`💬 **Reply to Confession #${confNum}**\n👤 User #${senderFakeID}\n\n${replyMsg}`);

    // Admin sees who replied
    dmAdmin(`👀 REPLY to #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${senderFakeID}\n\n${replyMsg}`);

    // DM the original confession poster
    const confPosterId = Object.entries(data.threads).find(([num, tid]) => parseInt(num) === confNum)?.[0];
    let confPosterFakeID = null;
    if (confPosterId) {
      confPosterFakeID = getFakeID(confPosterId);
      try {
        const confPoster = await client.users.fetch(confPosterId);
        confPoster.send(`💬 Anonymous #${senderFakeID} replied to your confession:\n\n${replyMsg}`).catch(() => {});
      } catch {}
    }

    // Track DM chat for back-and-forth
    data.dmChats[senderFakeID] = confPosterFakeID;
    data.dmChats[confPosterFakeID] = senderFakeID;
    saveData();

    interaction.reply({ content: '✅ Your reply was sent anonymously!', ephemeral: true });
  }
});

// --- DM message forwarding for anonymous chat ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return; // Only DMs

  const senderFakeID = getFakeID(message.author.id);
  const recipientFakeID = data.dmChats[senderFakeID];
  if (!recipientFakeID) return; // Not part of an anonymous chat

  // Admin sees the real conversation
  dmAdmin(`👀 DM from ${message.author.tag} (${message.author.id}) as Anonymous #${senderFakeID}:\n${message.content}`);

  // Find real recipient user
  const recipientId = Object.entries(data.users).find(([uid, fid]) => fid === recipientFakeID)?.[0];
  if (!recipientId) return;

  try {
    const recipient = await client.users.fetch(recipientId);
    recipient.send(`💬 Anonymous #${senderFakeID}: ${message.content}`).catch(() => {});
  } catch {}
});

// --- Start bot ---
(async () => {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID || !CONFESSION_CHANNEL_ID || !ADMIN_ID) {
    console.error('❌ Missing required environment variables.');
    process.exit(1);
  }

  await registerCommands();
  await client.login(TOKEN);
})();
