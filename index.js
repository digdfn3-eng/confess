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
    GatewayIntentBits.MessageContent
  ]
});

// In-memory storage
const data = {
  confessions: {}, // confessionId: { userId, content, replies: [] }
  confessionCount: 0
};

// Utils
function generateRandomID() {
  return Math.floor(1000 + Math.random() * 9000);
}

async function dmAdmin(message) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(message);
  } catch {}
}

// --- Slash Commands Registration ---
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send a confession anonymously'),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show confession stats')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands');
}

// --- Interaction Handler ---
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'confess') {
      const modal = new ModalBuilder()
        .setCustomId('confess_modal')
        .setTitle('Send a Confession');

      const input = new TextInputBuilder()
        .setCustomId('confess_input')
        .setLabel('Type your confession')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.commandName === 'stats') {
      const total = data.confessionCount;
      return interaction.reply({ content: `📊 Total confessions: ${total}`, ephemeral: true });
    }
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'confess_modal') {
    const content = interaction.fields.getTextInputValue('confess_input');
    const confessionId = ++data.confessionCount;
    const randomID = generateRandomID();

    const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`reply_${confessionId}`)
        .setLabel('Reply')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`report_${confessionId}`)
        .setLabel('Report')
        .setStyle(ButtonStyle.Danger)
    );

    const message = await channel.send({
      content: `📩 **Confession #${confessionId}**\n👤 User #${randomID}\n\n${content}`,
      components: [buttonRow]
    });

    data.confessions[confessionId] = { userId: interaction.user.id, content, replies: [] };

    dmAdmin(`👀 CONFESSION #${confessionId}\nFrom: ${interaction.user.tag}\nContent: ${content}`);

    await interaction.reply({ content: `✅ Your confession #${confessionId} has been sent`, ephemeral: true });
  }

  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_');
    const confessionId = parseInt(id);

    const conf = data.confessions[confessionId];
    if (!conf) return interaction.reply({ content: '❌ Confession not found', ephemeral: true });

    if (action === 'reply') {
      const modal = new ModalBuilder()
        .setCustomId(`reply_modal_${confessionId}`)
        .setTitle(`Reply to Confession #${confessionId}`);

      const input = new TextInputBuilder()
        .setCustomId('reply_input')
        .setLabel('Your reply')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'report') {
      dmAdmin(`⚠️ Confession #${confessionId} was reported by ${interaction.user.tag}`);
      return interaction.reply({ content: '✅ Report sent', ephemeral: true });
    }
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('reply_modal_')) {
    const confessionId = parseInt(interaction.customId.split('_')[2]);
    const conf = data.confessions[confessionId];
    if (!conf) return interaction.reply({ content: '❌ Confession not found', ephemeral: true });

    const replyMsg = interaction.fields.getTextInputValue('reply_input');
    conf.replies.push({ userId: interaction.user.id, content: replyMsg });

    const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
    const threadName = `Confession #${confessionId}`;
    let thread = channel.threads.cache.find(t => t.name === threadName);
    if (!thread) thread = await channel.threads.create({ name: threadName, autoArchiveDuration: 1440 });

    await thread.send(`💬 Reply to #${confessionId}\n${replyMsg}`);
    dmAdmin(`👀 Reply to #${confessionId}\nFrom: ${interaction.user.tag}\nContent: ${replyMsg}`);

    await interaction.reply({ content: '✅ Reply sent anonymously', ephemeral: true });
  }
});

// --- Bot Ready ---
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// --- Start ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
