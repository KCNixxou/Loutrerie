require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');

// Modules personnalisés
const config = require('./config');
const { ensureUser, updateUser, updateMissionProgress, db } = require('./database');
const { random, now, calculateLevel, getXpMultiplier, scheduleMidnightReset } = require('./utils');
const commands = require('./commands');
const { 
  activeBlackjackGames, 
  activeCoinflipGames,
  handleBlackjackStart,
  resolveBlackjack,
  handleRouletteStart,
  handleRouletteChoice,
  handleSlots,
  handleCoinflipSolo,
  handleCoinflipMulti,
  handleShop,
  handlePurchase
} = require('./games');
const { handleButtonInteraction, handleSelectMenuInteraction } = require('./handlers');

// Client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Événement ready
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} est connecté !`);
  
  // Enregistrer les commandes
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('🔄 Enregistrement des commandes...');
    
    for (const guild of client.guilds.cache.values()) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: commands }
      );
    }
    
    console.log('✅ Commandes enregistrées !');
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
  }
  
  // Démarrer le reset des missions à minuit
  scheduleMidnightReset(() => {
    console.log('🔄 Reset des missions journalières à minuit');
    const users = db.prepare('SELECT user_id FROM users').all();
    for (const user of users) {
      updateUser(user.user_id, {
        daily_missions: JSON.stringify(require('./database').generateDailyMissions()),
        daily_messages: 0,
        last_mission_reset: now()
      });
    }
  });
});

// Gain d'XP sur les messages
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  
  const user = ensureUser(message.author.id);
  const currentTime = now();
  
  // Vérifier le cooldown XP
  if (currentTime - user.last_xp_gain < config.xp.cooldown) return;
  
  // Calculer gain XP avec multiplicateur VIP
  let xpGain = random(config.xp.minPerMessage, config.xp.maxPerMessage);
  const multiplier = getXpMultiplier(message.member);
  xpGain = Math.floor(xpGain * multiplier);
  
  const newXp = user.xp + xpGain;
  const newLevel = calculateLevel(newXp);
  const levelUp = newLevel > user.level;
  
  // Mettre à jour les messages quotidiens et missions
  const newDailyMessages = user.daily_messages + 1;
  const missionReward = updateMissionProgress(message.author.id, 'messages_30', 1) + 
                       updateMissionProgress(message.author.id, 'messages_50', 1);
  
  updateUser(message.author.id, {
    xp: newXp,
    level: newLevel,
    last_xp_gain: currentTime,
    daily_messages: newDailyMessages,
    balance: user.balance + (levelUp ? 50 : 0) + missionReward
  });
  
  if (levelUp) {
    const embed = new EmbedBuilder()
      .setTitle('🎉 Niveau supérieur !')
      .setDescription(`Félicitations <@${message.author.id}> ! Tu es maintenant niveau **${newLevel}** !\n+50 ${config.currency.emoji} de bonus !`)
      .setColor(0x00ff00);
    
    message.channel.send({ embeds: [embed] });
  }
});

// Gestion des interactions
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
  }
});

async function handleSlashCommand(interaction) {
  const userId = interaction.user.id;
  const user = ensureUser(userId);
  
  switch (interaction.commandName) {
    case 'profil':
      const embed = new EmbedBuilder()
        .setTitle(`Profil de ${interaction.user.username}`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: 'Niveau', value: `${user.level}`, inline: true },
          { name: 'XP', value: `${user.xp}`, inline: true },
          { name: `${config.currency.emoji} Coquillages`, value: `${user.balance}`, inline: true }
        )
        .setColor(0x0099ff);
      
      await interaction.reply({ embeds: [embed] });
      break;

    case 'daily':
      const lastClaim = user.last_daily_claim;
      const currentTime = now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      if (currentTime - lastClaim < oneDayMs) {
        const timeLeft = oneDayMs - (currentTime - lastClaim);
        const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
        await interaction.reply({ 
          content: `⏰ Tu as déjà récupéré ta récompense aujourd'hui ! Reviens dans ${hoursLeft}h.`,
          ephemeral: true 
        });
        return;
      }
      
      updateUser(userId, {
        balance: user.balance + config.currency.dailyReward,
        last_daily_claim: currentTime
      });
      
      await interaction.reply({
        content: `🎁 Tu as reçu ta récompense journalière de **${config.currency.dailyReward}** ${config.currency.emoji} !`
      });
      break;

    case 'missions':
      const missions = JSON.parse(user.daily_missions || '[]');
      let missionText = '';
      
      missions.forEach(mission => {
        const status = mission.completed ? '✅' : `${mission.progress}/${mission.goal}`;
        const emoji = mission.completed ? '✅' : '📋';
        missionText += `${emoji} **${mission.description}**\n`;
        missionText += `   Progression: ${status} → Récompense: ${mission.reward} ${config.currency.emoji}\n\n`;
      });
      
      const missionEmbed = new EmbedBuilder()
        .setTitle('📝 Missions Journalières')
        .setDescription(missionText || 'Aucune mission disponible')
        .setColor(0xffaa00);
      
      await interaction.reply({ embeds: [missionEmbed] });
      break;

    case 'classement':
      const type = interaction.options.getString('type');
      const orderBy = type === 'xp' ? 'xp DESC' : 'balance DESC';
      const topUsers = db.prepare(`SELECT * FROM users ORDER BY ${orderBy} LIMIT 10`).all();
      
      let leaderboardText = '';
      topUsers.forEach((user, index) => {
        const value = type === 'xp' ? `${user.xp} XP` : `${user.balance} ${config.currency.emoji}`;
        leaderboardText += `**${index + 1}.** <@${user.user_id}> - ${value}\n`;
      });
      
      const leaderboardEmbed = new EmbedBuilder()
        .setTitle(`🏆 Classement ${type.toUpperCase()}`)
        .setDescription(leaderboardText || 'Aucun utilisateur trouvé')
        .setColor(0xffd700);
      
      await interaction.reply({ embeds: [leaderboardEmbed] });
      break;

    case 'blackjack':
      await handleBlackjackStart(interaction);
      break;

    case 'roulette':
      await handleRouletteStart(interaction);
      break;

    case 'slots':
      await handleSlots(interaction);
      break;

    case 'pileface':
      await handleCoinflipSolo(interaction);
      break;

    case 'pileface-multi':
      await handleCoinflipMulti(interaction);
      break;

    case 'shop':
      await handleShop(interaction);
      break;

    case 'acheter':
      await handlePurchase(interaction);
      break;
  }
}

// Serveur web pour uptime
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🐚 Bot Loutrerie en ligne !');
});

app.listen(PORT, () => {
  console.log(`🌐 Serveur web démarré sur le port ${PORT}`);
});

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);
