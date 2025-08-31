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
const { startCrashGame, handleCashout, activeGames } = require('./crash');
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
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      // Vérifier si c'est un bouton du jeu Crash
      if (interaction.customId === 'cashout' || interaction.customId === 'next_multiplier') {
        const { handleButtonInteraction } = require('./crash');
        await handleButtonInteraction(interaction);
      } else {
        await handleButtonInteraction(interaction);
      }
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction);
    }
  } catch (error) {
    console.error('Erreur lors du traitement de l\'interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Une erreur est survenue lors du traitement de votre demande.',
        ephemeral: true
      });
    }
  }
});

async function handleSlashCommand(interaction) {
  const { commandName } = interaction;
  switch (commandName) {
    case 'crash':
      await startCrashGame(interaction);
      break;
    case 'profil':
      const userId = interaction.user.id;
      const user = ensureUser(userId);
      const embed = new EmbedBuilder()
        .setTitle(`👥 Profil de ${interaction.user.username}`)
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
      const dailyUserId = interaction.user.id;
      const dailyUser = ensureUser(dailyUserId);
      const lastClaim = dailyUser.last_daily_claim || 0;
      const currentTime = Math.floor(Date.now() / 1000); // Timestamp en secondes
      const oneDayInSeconds = 24 * 60 * 60;
      
      if (currentTime - lastClaim < oneDayInSeconds) {
        const timeLeft = oneDayInSeconds - (currentTime - lastClaim);
        const hoursLeft = Math.ceil(timeLeft / 3600);
        await interaction.reply({ 
          content: `⏰ Tu as déjà récupéré ta récompense aujourd'hui ! Reviens dans ${hoursLeft}h.`,
          ephemeral: true 
        });
        return;
      }
      
      const newBalance = (dailyUser.balance || 0) + config.currency.dailyReward;
      
      updateUser(dailyUserId, {
        balance: newBalance,
        last_daily_claim: currentTime
      });
      
      await interaction.reply({
        content: `🎁 Tu as reçu ta récompense journalière de **${config.currency.dailyReward}** ${config.currency.emoji} !\nNouveau solde: **${newBalance}** ${config.currency.emoji}`
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

    case 'givea':
      await handleGiveAdmin(interaction);
      break;

    case 'give':
      await handleGive(interaction);
      break;
  }
}

// Serveur web pour uptime
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('🐚 Bot Loutrerie en ligne !');
});

app.listen(PORT, () => {
  console.log(`🌐 Serveur web démarré sur le port ${PORT}`);
});

// Fonctions pour les commandes give
async function handleGiveAdmin(interaction) {
  // Vérifier si l'utilisateur est l'admin autorisé
  if (interaction.user.id !== '314458846754111499') {
    await interaction.reply({ content: '❌ Cette commande est réservée aux administrateurs.', ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('utilisateur');
  const amount = interaction.options.getInteger('montant');

  if (targetUser.bot) {
    await interaction.reply({ content: '❌ Tu ne peux pas donner de coquillages à un bot !', ephemeral: true });
    return;
  }

  const user = ensureUser(targetUser.id);
  updateUser(targetUser.id, { balance: user.balance + amount });

  const embed = new EmbedBuilder()
    .setTitle('🐚 Don administrateur')
    .setDescription(`<@${targetUser.id}> a reçu **${amount}** ${config.currency.emoji} de la part de l'administrateur !`)
    .setColor(0x00ff00);

  await interaction.reply({ embeds: [embed] });
}

async function handleGive(interaction) {
  try {
    const targetUser = interaction.options.getUser('utilisateur');
    const amount = interaction.options.getInteger('montant');
    const giverId = interaction.user.id;

    // Vérifications de base
    if (!targetUser || !amount) {
      await interaction.reply({ 
        content: '❌ Paramètres invalides. Utilisation: `/give @utilisateur montant`', 
        ephemeral: true 
      });
      return;
    }

    if (targetUser.bot) {
      await interaction.reply({ 
        content: '❌ Tu ne peux pas donner de coquillages à un bot !', 
        ephemeral: true 
      });
      return;
    }

    if (targetUser.id === giverId) {
      await interaction.reply({ 
        content: '❌ Tu ne peux pas te donner des coquillages à toi-même !', 
        ephemeral: true 
      });
      return;
    }

    if (amount <= 0) {
      await interaction.reply({ 
        content: '❌ Le montant doit être supérieur à 0 !', 
        ephemeral: true 
      });
      return;
    }

    // Récupérer les informations des utilisateurs
    const giver = ensureUser(giverId);
    const currentTime = Math.floor(Date.now() / 1000); // timestamp en secondes
    const oneDayInSeconds = 24 * 60 * 60;

    // Vérifier et réinitialiser le compteur quotidien si nécessaire
    const lastReset = giver.last_give_reset || 0;
    let dailyGiven = giver.daily_given || 0;

    if (currentTime - lastReset >= oneDayInSeconds) {
      dailyGiven = 0;
      updateUser(giverId, {
        daily_given: 0,
        last_give_reset: currentTime
      });
    }

    // Vérifier la limite quotidienne
    if (dailyGiven + amount > 200) {
      const remaining = 200 - dailyGiven;
      await interaction.reply({ 
        content: `❌ Tu ne peux donner que ${remaining} ${config.currency.emoji} de plus aujourd'hui ! (Limite: 200/jour)`, 
        ephemeral: true 
      });
      return;
    }

    // Vérifier le solde du donneur
    const giverBalance = giver.balance || 0;
    if (giverBalance < amount) {
      await interaction.reply({ 
        content: `❌ Tu n'as pas assez de coquillages ! Tu as ${giverBalance} ${config.currency.emoji}`, 
        ephemeral: true 
      });
      return;
    }

    // Effectuer le transfert
    const receiver = ensureUser(targetUser.id);
    const receiverBalance = receiver.balance || 0;
    
    // Mise à jour du donneur
    updateUser(giverId, { 
      balance: giverBalance - amount,
      daily_given: dailyGiven + amount,
      last_give_reset: currentTime
    });
    
    // Mise à jour du receveur
    updateUser(targetUser.id, { 
      balance: receiverBalance + amount 
    });

    // Créer et envoyer l'embed de confirmation
    const embed = new EmbedBuilder()
      .setTitle('🎁 Don de coquillages')
      .setDescription(`<@${giverId}> a donné **${amount}** ${config.currency.emoji} à <@${targetUser.id}> !`)
      .addFields(
        { 
          name: 'Donneur', 
          value: `Solde: ${giverBalance - amount} ${config.currency.emoji}`, 
          inline: true 
        },
        { 
          name: 'Receveur', 
          value: `Solde: ${receiverBalance + amount} ${config.currency.emoji}`, 
          inline: true 
        },
        { 
          name: 'Limite quotidienne', 
          value: `${dailyGiven + amount}/200 ${config.currency.emoji}`, 
          inline: true 
        }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur dans la commande /give:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du traitement de ta commande.',
        ephemeral: true
      });
    }
  }
}

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);
