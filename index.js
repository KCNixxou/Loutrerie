require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');
const { isMaintenanceMode, isAdmin, maintenanceMiddleware, setMaintenance } = require('./maintenance');

// Modules personnalisés
const config = require('./config');
const { ensureUser, updateUser, updateMissionProgress, db } = require('./database');
const { random, now, calculateLevel, getXpMultiplier, scheduleMidnightReset } = require('./utils');
const commands = require('./commands');
const { 
  activeBlackjackGames, 
  activeCoinflipGames,
  activeTicTacToeGames,
  handleBlackjackStart,
  resolveBlackjack,
  handleRouletteStart,
  handleRouletteChoice,
  handleSlots,
  handleCoinflipSolo,
  handleCoinflipMulti,
  handleConnectFour,
  handleShop,
  handlePurchase,
  handleTicTacToe,
  handleTicTacToeMove,
  handleConnectFourMove,
  getTicTacToeLeaderboard
} = require('./games');
const { 
  startCrashGame, 
  handleCashout, 
  handleNextMultiplier, 
  activeGames 
} = require('./crash');
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
  console.log('Commandes disponibles:', client.commands?.map(cmd => cmd.name).join(', ') || 'Aucune commande chargée');
  
  // Enregistrer les commandes
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('🔄 Enregistrement des commandes...');
    console.log('Commandes à enregistrer:', commands.map(cmd => cmd.name).join(', '));
    
    // Enregistrement global des commandes
    const result = await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Commandes enregistrées avec succès:', result.map(cmd => cmd.name).join(', '));
    
    // Enregistrement pour chaque serveur (en cas de mise en cache)
    for (const guild of client.guilds.cache.values()) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: commands }
        );
      } catch (error) {
        console.error(`Erreur lors de l'enregistrement des commandes pour le serveur ${guild.name}:`, error);
      }
    }
    
    console.log('✅ Commandes enregistrées !');
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
  }
  
  // Démarrer le reset des missions à minuit
  scheduleMidnightReset(() => {
    console.log('🔄 Reset des missions journalières à minuit');
    const { generateDailyMissions } = require('./database');
    const missions = generateDailyMissions();
    const users = db.prepare('SELECT user_id FROM users').all();
    for (const user of users) {
      updateUser(user.user_id, {
        daily_missions: JSON.stringify(missions),
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
    // Vérifier le mode maintenance pour toutes les interactions
    if (isMaintenanceMode() && interaction.user.id !== '314458846754111499') {
      return interaction.reply({ 
        content: '⚠️ Le bot est actuellement en maintenance. Veuillez réessayer plus tard.',
        flags: 'Ephemeral'
      });
    }

    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('coinflip_multi_')) {
        await handleCoinflipMulti(interaction);
      } else if (interaction.customId.startsWith('roulette_')) {
        await handleRouletteChoice(interaction);
      } else if (interaction.customId.startsWith('ttt_')) {
        await handleTicTacToeMove(interaction);
      } else if (interaction.customId.startsWith('cf_')) {
        await handleConnectFourMove(interaction);
      } else if (interaction.customId === 'cashout' || interaction.customId === 'next_multiplier') {
        const { handleButtonInteraction: handleCrashButton } = require('./crash');
        await handleCrashButton(interaction);
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
        flags: 'Ephemeral'
      });
    }
  }
});

async function handleSlashCommand(interaction) {
  const { commandName } = interaction;
  
  switch (commandName) {
    case 'morpion':
      await handleTicTacToe(interaction);
      break;
      
    case 'puissance4':
      const opponent = interaction.options.getUser('adversaire');
      const bet = interaction.options.getInteger('mise') || 0;
      await handleConnectFour(interaction, opponent, bet);
      break;
      
    case 'crash':
      await startCrashGame(interaction);
      break;
      
    case 'cashout':
      await handleCashout(interaction);
      break;
      
    case 'next':
      await handleNextMultiplier(interaction);
      break;
      
    case 'loutre-giveaway':
      await handleLoutreGiveaway(interaction);
      break;
      
    case 'classement-morpion':
      await handleTicTacToeLeaderboard(interaction);
      break;
      
    case 'maintenance':
      // Utiliser la fonction setMaintenance du module maintenance.js
      const currentState = isMaintenanceMode();
      const result = setMaintenance(!currentState, interaction.user.id);
      
      await interaction.reply({
        content: result.message,
        flags: 'Ephemeral'
      });
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
      const now = new Date();
      const lastClaim = dailyUser.last_daily_claim || 0;
      const lastClaimDate = new Date(lastClaim * 1000);
      
      // Vérifier si l'utilisateur a déjà récupéré sa récompense aujourd'hui
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (lastClaimDate >= today) {
        // Calculer le temps jusqu'à minuit prochain
        const nextMidnight = new Date(today);
        nextMidnight.setDate(nextMidnight.getDate() + 1);
        const timeLeftMs = nextMidnight - now;
        
        const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutes = Math.ceil((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
        
        let timeLeftText = '';
        if (hours > 0) {
          timeLeftText += `${hours} heure${hours > 1 ? 's' : ''} `;
        }
        timeLeftText += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        
        await interaction.reply({ 
          content: `⏰ Tu as déjà récupéré ta récompense aujourd'hui ! La prochaine récompense sera disponible à minuit dans ${timeLeftText}.`,
          ephemeral: true
        });
        return;
      }
      
      const newBalance = (dailyUser.balance || 0) + config.currency.dailyReward;
      
{{ ... }}
      updateUser(dailyUserId, {
        balance: newBalance,
        last_daily_claim: Math.floor(now.getTime() / 1000)
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

// Variables pour le giveaway
const activeGiveaways = new Map();
const ADMIN_ID = '314458846754111499'; // Remplacez par votre ID Discord

// Gestion de la commande loutre-giveaway
async function handleLoutreGiveaway(interaction) {
  try {
    // Vérifier si l'utilisateur est l'admin
    if (interaction.user.id !== ADMIN_ID) {
      await interaction.reply({
        content: '❌ Cette commande est réservée à l\'administrateur !',
        ephemeral: true
      });
      return;
    }

    // Vérifier s'il y a déjà un giveaway en cours
    if (activeGiveaways.has(interaction.channelId)) {
      await interaction.reply({
        content: '❌ Il y a déjà un giveaway en cours dans ce salon !',
        ephemeral: true
      });
      return;
    }

    // Créer l'embed du giveaway
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY LOUTRE 🎉')
      .setDescription('Réagissez avec 🦦 pour gagner **500 🐚** !')
      .setColor('#ffd700')
      .setFooter({ text: 'Seul le premier à réagir gagne !' });

    // Envoyer le message de giveaway
    const message = await interaction.channel.send({ embeds: [embed] });
    await message.react('🦦');

    // Stocker le giveaway
    activeGiveaways.set(interaction.channelId, {
      messageId: message.id,
      channelId: interaction.channelId,
      prize: 500,
      hasWinner: false
    });

    // Répondre à l'interaction
    await interaction.reply({
      content: '✅ Giveaway lancé avec succès !',
      ephemeral: true
    });

    // Supprimer le giveaway après 1 heure
    setTimeout(() => {
      if (activeGiveaways.has(interaction.channelId)) {
        activeGiveaways.delete(interaction.channelId);
      }
    }, 3600000); // 1 heure

  } catch (error) {
    console.error('Erreur dans handleLoutreGiveaway:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du lancement du giveaway.',
        ephemeral: true
      });
    }
  }
}

// Gestion des réactions
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // Ignorer les réactions du bot
    if (user.bot) return;

    // Vérifier si c'est une réaction à un message de giveaway
    const giveaway = Array.from(activeGiveaways.values())
      .find(g => g.messageId === reaction.message.id);

    if (!giveaway || giveaway.hasWinner || reaction.emoji.name !== '🦦') return;

    // Marquer qu'il y a un gagnant
    giveaway.hasWinner = true;
    activeGiveaways.set(giveaway.channelId, giveaway);

    // Mettre à jour la base de données
    const userData = ensureUser(user.id);
    updateUser(user.id, { balance: userData.balance + giveaway.prize });

    // Mettre à jour le message
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY TERMINÉ ! 🎉')
      .setDescription(`Félicitations <@${user.id}> ! Tu as gagné **${giveaway.prize} 🐚** !`)
      .setColor('#00ff00')
      .setFooter({ text: 'Giveaway terminé' });

    await reaction.message.edit({ embeds: [embed] });
    await reaction.message.reactions.removeAll();

    // Supprimer le giveaway
    activeGiveaways.delete(giveaway.channelId);

  } catch (error) {
    console.error('Erreur dans la gestion des réactions:', error);
  }
});

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);
