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
const data = { users: {}, threads: {}, confessionCount: 0, replies: {}, reports: 0 };

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
  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send an anonymous confession'),
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal the user behind a confession (admin only)')
      .addIntegerOption(opt =>
        opt.setName('fakeid')
          .setDescription('The ID of the confession')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show confession stats')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interaction handler ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  // --- Commands ---
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === 'confess') {
      const modal = new ModalBuilder()
        .setCustomId('confess_modal')
        .setTitle('Send a Confession');

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
      const fakeid = interaction.options.getInteger('fakeid');
      const found = Object.entries(data.users).find(([uid, info]) => info.id === fakeid);
      if (!found) return interaction.editReply({ content: '❌ ID not found.' });
      const user = await client.users.fetch(found[0]);
      return interaction.editReply({ content: `👤 Confession #${fakeid} by ${user.tag}` });
    }

    if (interaction.commandName === 'stats') {
      return interaction.editReply({
        content: `📊 Total confessions: ${data.confessionCount}\nReports: ${data.reports}`
      });
    }
  }

  // --- Modals ---
  if (interaction.isModalSubmit()) {
    // Confession modal
    if (interaction.customId === 'confess_modal') {
      const msg = interaction.fields.getTextInputValue('confess_input');
      const fakeID = getRandomID();
      data.confessionCount++;
      const confNum = data.confessionCount;

      data.users[interaction.user.id] = { id: fakeID, message: msg };
      data.replies[confNum] = []; // initialize replies array

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reply_${confNum}`)
          .setLabel('Reply')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`report_${confNum}`)
          .setLabel('Report')
          .setStyle(ButtonStyle.Danger)
      );

      const confMessage = await channel.send({
        content: `📩 **Confession #${confNum}**\n👤 Anonymous #${fakeID}\n\n${msg}`,
        components: [row]
      });

      const thread = await confMessage.startThread({ name: `Confession #${confNum}`, autoArchiveDuration: 1440 });
      data.threads[confNum] = thread.id;

      dmAdmin(`👀 Confession #${confNum}\nFrom: ${interaction.user.tag} (${interaction.user.id})\nMessage: ${msg}`);
      return interaction.editReply({ content: `✅ Sent as Confession #${confNum}` });
    }

    // Reply modal
    if (interaction.customId.startsWith('reply_modal_')) {
      const confNum = parseInt(interaction.customId.split('_')[2]);
      const replyMsg = interaction.fields.getTextInputValue('reply_input');
      const senderFakeID = getRandomID();

      const threadId = data.threads[confNum];
      if (!threadId) return interaction.reply({ content: '❌ Thread not found.', ephemeral: true });

      data.replies[confNum].push({ id: senderFakeID, msg: replyMsg });

      const thread = await client.channels.fetch(threadId);
      let chain = '';
      data.replies[confNum].forEach(r => chain += `👤 Anonymous #${r.id}: ${r.msg}\n`);
      await thread.send(`💬 Reply chain:\n${chain}`);

      dmAdmin(`👀 Reply to Confession #${confNum} from ${interaction.user.tag} (Anon #${senderFakeID}): ${replyMsg}`);
      return interaction.reply({ content: '✅ Reply sent!', ephemeral: true });
    }
  }

  // --- Buttons ---
  if (interaction.isButton()) {
    const [action, confNumStr] = interaction.customId.split('_');
    const confNum = parseInt(confNumStr);
    if (!data.threads[confNum]) return interaction.reply({ content: '❌ Thread not found.', ephemeral: true });

    if (action === 'reply') {
      const modal = new ModalBuilder()
        .setCustomId(`reply_modal_${confNum}`)
        .setTitle(`Reply to Confession #${confNum}`);

      const input = new TextInputBuilder()
        .setCustomId('reply_input')
        .setLabel('Your reply')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'report') {
      data.reports++;
      dmAdmin(`⚠️ Confession #${confNum} reported by ${interaction.user.tag}`);
      return interaction.reply({ content: '✅ Report sent.', ephemeral: true });
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
