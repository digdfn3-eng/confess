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

// --- Environment variables ---
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;

// --- Discord client ---
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

// Safe load data.json
if (fs.existsSync('data.json')) {
  try {
    const fileContent = fs.readFileSync('data.json', 'utf8').trim();
    if (fileContent) {
      data = JSON.parse(fileContent);
    } else {
      console.log('data.json is empty, initializing fresh data.');
    }
  } catch (err) {
    console.error('Failed to parse data.json, initializing fresh data:', err);
  }
}

function saveData() {
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
}

// --- Generate fake ID ---
function getFakeID(userId) {
  if (!data.users[userId]) {
    const fake = Math.floor(1000 + Math.random() * 9000);
    data.users[userId] = fake;
    saveData();
  }
  return data.users[userId];
}

// --- Slash commands registration ---
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

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
})();

// --- Bot ready ---
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// --- DM admin helper ---
async function dmAdmin(message) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(message);
  } catch {}
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);

  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
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

      const thread = await confMessage.startThread({
        name: `Confession #${confNum}`,
        autoArchiveDuration: 1440
      });

      data.threads[confNum] = thread.id;
      saveData();

      dmAdmin(`👀 CONFESSION #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${fakeID}\n\n${msg}`);
      interaction.user.send(`✅ You sent Confession #${confNum} as User #${fakeID}\n\n"${msg}"`).catch(() => {});
      await interaction.reply({ content: `✅ Sent as Confession #${confNum}`, ephemeral: true });
    }

    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Only admin can use this.', ephemeral: true });
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

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    interaction.showModal(modal);
  }

  // --- Modal reply submit ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[2]);
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const senderFakeID = getFakeID(interaction.user.id);

    const threadId = data.threads[confNum];
    if (!threadId) return interaction.reply({ content: '❌ Confession thread not found.', ephemeral: true });

    const thread = await client.channels.fetch(threadId);
    await thread.send(`💬 **Reply to Confession #${confNum}**\n👤 User #${senderFakeID}\n\n${replyMsg}`);
    dmAdmin(`👀 REPLY to #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nFake ID: #${senderFakeID}\n\n${replyMsg}`);

    const confPosterId = Object.entries(data.threads).find(([num, tid]) => parseInt(num) === confNum)?.[0];
    if (confPosterId) {
      try {
        const confPoster = await client.users.fetch(confPosterId);
        const confPosterFakeID = getFakeID(confPosterId);
        confPoster.send(`💬 Anonymous #${senderFakeID} replied to your confession:\n\n${replyMsg}`).catch(() => {});
        data.dmChats[senderFakeID] = confPosterFakeID;
        data.dmChats[confPosterFakeID] = senderFakeID;
      } catch {}
    }
    saveData();
    interaction.reply({ content: '✅ Your reply was sent anonymously!', ephemeral: true });
  }
});

// --- DM forwarding ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return;

  const senderFakeID = getFakeID(message.author.id);
  const recipientFakeID = data.dmChats[senderFakeID];
  if (!recipientFakeID) return;

  dmAdmin(`👀 DM from ${message.author.tag} (${message.author.id}) as Anonymous #${senderFakeID}:\n${message.content}`);

  const recipientId = Object.entries(data.users).find(([uid, fid]) => fid === recipientFakeID)?.[0];
  if (!recipientId) return;

  try {
    const recipient = await client.users.fetch(recipientId);
    recipient.send(`💬 Anonymous #${senderFakeID}: ${message.content}`).catch(() => {});
  } catch {}
});

// --- Login ---
client.login(TOKEN);
