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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;

// --- DATA ---
const data = {
  confessions: {}, // id -> { userId, fakeId, message, threadId, reports }
  count: 0,
  totalReports: 0
};

// --- ADMIN DM ---
async function dmAdmin(msg) {
  try {
    const admin = await client.users.fetch(ADMIN_ID);
    await admin.send(msg);
  } catch {}
}

// --- COMMANDS ---
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('confess').setDescription('Send anonymous confession'),
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('Reveal confession author')
      .addIntegerOption(o => o.setName('id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('deleteconfession')
      .setDescription('Delete confession')
      .addIntegerOption(o => o.setName('id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('lockthread')
      .setDescription('Lock thread')
      .addIntegerOption(o => o.setName('id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unlockthread')
      .setDescription('Unlock thread')
      .addIntegerOption(o => o.setName('id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('inspect')
      .setDescription('Inspect confession')
      .addIntegerOption(o => o.setName('id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('View confession stats')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// --- INTERACTIONS ---
client.on('interactionCreate', async interaction => {

  // --- CONFESS MODAL ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'confess') {
    const modal = new ModalBuilder()
      .setCustomId('confess_modal')
      .setTitle('Anonymous Confession');

    const input = new TextInputBuilder()
      .setCustomId('confession_input')
      .setLabel('Type your confession')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // --- MODAL SUBMIT ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'confess_modal') {
    const msg = interaction.fields.getTextInputValue('confession_input');

    data.count++;
    const id = data.count;
    const fakeId = Math.floor(1000 + Math.random() * 9000);

    const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`reply_${id}`)
        .setLabel('Reply')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`report_${id}`)
        .setLabel('Report')
        .setStyle(ButtonStyle.Danger)
    );

    const message = await channel.send({
      content: `📩 Confession #${id}\n👤 Anonymous #${fakeId}\n\n${msg}`,
      components: [row]
    });

    const thread = await message.startThread({
      name: `Confession #${id}`,
      autoArchiveDuration: 1440
    });

    data.confessions[id] = {
      userId: interaction.user.id,
      fakeId,
      message: msg,
      threadId: thread.id,
      reports: 0
    };

    // --- DM ADMIN ---
    await dmAdmin(
      `📩 NEW CONFESSION #${id}\n` +
      `From: ${interaction.user.tag} (${interaction.user.id})\n\n${msg}`
    );

    return interaction.reply({ content: '✅ Confession sent!', ephemeral: true });
  }

  // --- REPLY BUTTON ---
  if (interaction.isButton() && interaction.customId.startsWith('reply_')) {
    const id = interaction.customId.split('_')[1];

    const modal = new ModalBuilder()
      .setCustomId(`reply_modal_${id}`)
      .setTitle(`Reply to Confession #${id}`);

    const input = new TextInputBuilder()
      .setCustomId('reply_input')
      .setLabel('Your reply')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // --- REPORT BUTTON ---
  if (interaction.isButton() && interaction.customId.startsWith('report_')) {
    const id = parseInt(interaction.customId.split('_')[1]);
    const conf = data.confessions[id];

    if (!conf) {
      return interaction.reply({ content: '❌ Not found', ephemeral: true });
    }

    conf.reports++;
    data.totalReports++;

    await dmAdmin(
      `🚨 CONFESSION REPORTED\n\n` +
      `Confession #${id}\n` +
      `Reported by: ${interaction.user.tag} (${interaction.user.id})\n\n` +
      `Sender: ${conf.userId}\n\n` +
      `Message:\n${conf.message}`
    );

    return interaction.reply({ content: '🚨 Report sent!', ephemeral: true });
  }

  // --- REPLY MODAL ---
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('reply_modal_')) {
    const id = parseInt(interaction.customId.split('_')[2]);
    const reply = interaction.fields.getTextInputValue('reply_input');

    const conf = data.confessions[id];
    if (!conf) return interaction.reply({ content: '❌ Not found', ephemeral: true });

    const thread = await client.channels.fetch(conf.threadId);
    const fakeId = Math.floor(1000 + Math.random() * 9000);

    await thread.send(`💬 Anonymous #${fakeId}\n${reply}`);

    return interaction.reply({ content: '✅ Reply sent!', ephemeral: true });
  }

  // --- ADMIN COMMANDS ---
  if (interaction.isChatInputCommand()) {
    if (interaction.user.id !== ADMIN_ID) {
      return interaction.reply({ content: '❌ Admin only', ephemeral: true });
    }

    if (interaction.commandName === 'stats') {
      return interaction.reply({
        content:
          `📊 Stats\n` +
          `Total Confessions: ${data.count}\n` +
          `Total Reports: ${data.totalReports}`,
        ephemeral: true
      });
    }

    const id = interaction.options.getInteger('id');
    const conf = data.confessions[id];
    if (!conf) return interaction.reply({ content: '❌ Not found', ephemeral: true });

    const thread = await client.channels.fetch(conf.threadId);

    if (interaction.commandName === 'reveal') {
      const user = await client.users.fetch(conf.userId);
      return interaction.reply({ content: `👤 ${user.tag} (${user.id})`, ephemeral: true });
    }

    if (interaction.commandName === 'deleteconfession') {
      await thread.delete().catch(() => {});
      delete data.confessions[id];
      return interaction.reply({ content: '✅ Deleted', ephemeral: true });
    }

    if (interaction.commandName === 'lockthread') {
      await thread.setLocked(true);
      return interaction.reply({ content: '🔒 Locked', ephemeral: true });
    }

    if (interaction.commandName === 'unlockthread') {
      await thread.setLocked(false);
      return interaction.reply({ content: '🔓 Unlocked', ephemeral: true });
    }

    if (interaction.commandName === 'inspect') {
      return interaction.reply({
        content:
          `Confession #${id}\n` +
          `User: ${conf.userId}\n` +
          `Reports: ${conf.reports}\n` +
          `Message:\n${conf.message}`,
        ephemeral: true
      });
    }
  }
});

// --- READY ---
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// --- START ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
