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
  InteractionType,
  EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;
const EXPOSE_CHANNEL_ID = '1490140096517767268';
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
  confessions: {}, // confessionId -> {userId, content, replies: []}
  confessionCount: 0,
  blacklist: new Set(),
  perms: new Set()
};

// --- Helpers ---
function randomID() {
  return Math.floor(1000 + Math.random() * 9000);
}

function dmAdmin(msg) {
  client.users.fetch(ADMIN_ID).then(u => u.send(msg)).catch(() => {});
}

function getConfessionEmbed(confNum, conf) {
  const embed = new EmbedBuilder()
    .setTitle(`Confession #${confNum}`)
    .setDescription(conf.content)
    .addFields({ name: 'Replies', value: conf.replies.map(r => `💬 #${r.id} ${r.userTag} → ${r.parentId ? `Reply #${r.parentId}` : 'Original'}`.trim()).join('\n') || 'No replies yet' })
    .setColor(0x00ff00)
    .setFooter({ text: `Random ID: ${conf.randomID}` });
  return embed;
}

// --- Slash commands ---
async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) process.exit(1);

  const commands = [
    new SlashCommandBuilder()
      .setName('confess')
      .setDescription('Send a confession (opens modal)'),
    new SlashCommandBuilder()
      .setName('reply')
      .setDescription('Reply to a confession')
      .addIntegerOption(opt => opt.setName('confession').setDescription('Confession #').setRequired(true))
      .addIntegerOption(opt => opt.setName('parent').setDescription('Reply # to reply to').setRequired(false)),
    new SlashCommandBuilder()
      .setName('report')
      .setDescription('Report a confession')
      .addIntegerOption(opt => opt.setName('confession').setDescription('Confession #').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show confession stats'),
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Blacklist a user')
      .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unblacklist')
      .setDescription('Unblacklist a user')
      .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('perms')
      .setDescription('Grant confession view perms')
      .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('removepr')
      .setDescription('Remove perms')
      .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('listperms')
      .setDescription('List users with perms')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered slash commands.');
}

// --- Interactions ---
client.on('interactionCreate', async interaction => {
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  try {
    // --- CONFESS ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'confess') {
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

    // --- MODAL SUBMIT ---
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'confess_modal') {
      const msg = interaction.fields.getTextInputValue('confess_input');
      if (data.blacklist.has(interaction.user.id)) return interaction.reply({ content: '❌ You are blacklisted.', ephemeral: true });

      data.confessionCount++;
      const confNum = data.confessionCount;
      const randomId = randomID();
      data.confessions[confNum] = {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        content: msg,
        replies: [],
        randomID: randomId
      };

      const replyBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reply_${confNum}_0`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`report_${confNum}`).setLabel('Report').setStyle(ButtonStyle.Danger)
      );

      await channel.send({ embeds: [getConfessionEmbed(confNum, data.confessions[confNum])], components: [replyBtn] });
      dmAdmin(`📩 Confession #${confNum} by ${interaction.user.tag} (${interaction.user.id})\n\n${msg}`);
      await interaction.reply({ content: `✅ Sent Confession #${confNum}`, ephemeral: true });
    }

    // --- REPLY BUTTON ---
    if (interaction.isButton() && interaction.customId.startsWith('reply_')) {
      const [_, confNum, parentId] = interaction.customId.split('_');
      const modal = new ModalBuilder().setCustomId(`reply_modal_${confNum}_${parentId}`).setTitle(`Reply to Confession #${confNum}`);

      const input = new TextInputBuilder().setCustomId('reply_input').setLabel('Your reply').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // --- REPLY MODAL SUBMIT ---
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('reply_modal_')) {
      const [_, confNum, parentId] = interaction.customId.split('_');
      const replyMsg = interaction.fields.getTextInputValue('reply_input');
      const conf = data.confessions[confNum];
      if (!conf) return interaction.reply({ content: '❌ Confession not found.', ephemeral: true });

      const replyId = conf.replies.length + 1;
      conf.replies.push({ id: replyId, userId: interaction.user.id, userTag: interaction.user.tag, msg: replyMsg, parentId: parseInt(parentId) });

      const replyBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reply_${confNum}_${replyId}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`report_${confNum}`).setLabel('Report').setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ embeds: [getConfessionEmbed(confNum, conf)], components: [replyBtn] });
      dmAdmin(`💬 Reply to Confession #${confNum} from ${interaction.user.tag} (${interaction.user.id}):\n${replyMsg}`);
    }

    // --- REPORT ---
    if (interaction.isButton() && interaction.customId.startsWith('report_')) {
      const confNum = interaction.customId.split('_')[1];
      const conf = data.confessions[confNum];
      if (!conf) return interaction.reply({ content: '❌ Confession not found.', ephemeral: true });

      data.blacklist.add(conf.userId);

      const exposeChannel = await client.channels.fetch(EXPOSE_CHANNEL_ID);
      exposeChannel.send(`😎 **Anonymous Expose**\nUser <@${conf.userId}> sent Confession #${confNum} and got exposed!`).catch(() => {});

      interaction.reply({ content: `✅ Confession #${confNum} reported and user blacklisted.`, ephemeral: true });
    }

    // --- STATS ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'stats') {
      return interaction.reply({
        content: `📊 Total Confessions: ${data.confessionCount}\nReplies: ${Object.values(data.confessions).reduce((acc, c) => acc + c.replies.length, 0)}\nBlacklisted: ${data.blacklist.size}`,
        ephemeral: true
      });
    }

    // --- BLACKLIST/UNBLACKLIST ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'blacklist') {
      const uid = interaction.options.getString('userid');
      data.blacklist.add(uid);
      return interaction.reply({ content: `✅ User ${uid} blacklisted.`, ephemeral: true });
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'unblacklist') {
      const uid = interaction.options.getString('userid');
      data.blacklist.delete(uid);
      return interaction.reply({ content: `✅ User ${uid} unblacklisted.`, ephemeral: true });
    }

    // --- PERMS ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'perms') {
      const uid = interaction.options.getString('userid');
      data.perms.add(uid);
      return interaction.reply({ content: `✅ User ${uid} can now see confessions.`, ephemeral: true });
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'removepr') {
      const uid = interaction.options.getString('userid');
      data.perms.delete(uid);
      return interaction.reply({ content: `✅ User ${uid} perms removed.`, ephemeral: true });
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'listperms') {
      return interaction.reply({ content: `👥 Users with perms:\n${[...data.perms].join('\n') || 'None'}`, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
  }
});

// --- Ready ---
client.on('clientReady', () => console.log(`✅ Logged in as ${client.user.tag}`));

// --- Start bot ---
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
