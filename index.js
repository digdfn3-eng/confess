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
const data = { users: {}, threads: {}, confessionCount: 0, dmChats: {}, chatLogs: {} };

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
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

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

    if (interaction.commandName === 'reveal') {
      if (interaction.user.id !== ADMIN_ID) return interaction.editReply({ content: '❌ Only the admin can use this.' });
      const fakeid = interaction.options.getInteger('fakeid');
      const realUser = Object.entries(data.users).find(([uid, fid]) => fid === fakeid);
      if (!realUser) return interaction.editReply({ content: '❌ Fake ID not found.' });
      const user = await client.users.fetch(realUser[0]);
      interaction.editReply({ content: `👤 Fake ID #${fakeid} belongs to ${user.tag} (${user.id})` });
    }
  }

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

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')) {
    const confNum = parseInt(interaction.customId.split('_')[2]);
    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    const senderFakeID = getFakeID(interaction.user.id);

    const threadId = data.threads[confNum];
    if (!threadId) return interaction.reply({ content: '❌ Confession thread not found.', ephemeral: true });

    const thread = await client.channels.fetch(threadId);
    await thread.send(`💬 **Reply to Confession #${confNum}**\n👤 User #${senderFakeID}\n\n${replyMsg}`);

    dmAdmin(`👀 REPLY to #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id}) as User #${senderFakeID}\n\n${replyMsg}`);

    interaction.reply({ content: '✅ Your reply was sent anonymously!', ephemeral: true });
  }
});

// --- DM forwarding ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return; // only DMs

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

// --- Ready event ---
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// --- Start bot ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
