require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');
const { isMaintenanceMode, isAdmin, maintenanceMiddleware, setMaintenance } = require('./maintenance');
// Modules personnalisés
const config = require('./config');
const { ensureUser, updateUser, updateMissionProgress, db, getSpecialBalance, updateSpecialBalance } = require('./database');
const { random, now, getXpMultiplier, scheduleMidnightReset, calculateLevel, getLevelInfo } = require('./utils');
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
  getTicTacToeLeaderboard,
  handleTicTacToeLeaderboard,
  resetTicTacToeStats,
  handleHighLow,
  handleSpecialHighLow,
  handleHighLowAction,
  handleHighLowDecision
} = require('./games');
const { 
  startCrashGame, 
  handleButtonInteraction: handleCrashButton,
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
  
  // Afficher les commandes chargées
  console.log('Commandes disponibles:', client.commands?.map(cmd => cmd.name).join(', ') || 'Aucune commande chargée');
  console.log('Commandes à enregistrer depuis commands.js:', commands.map(cmd => cmd.name).join(', '));
  
  // Vérifier la commande /profil
  const profilCmd = commands.find(cmd => cmd.name === 'profil');
  console.log('Commande /profil trouvée:', profilCmd ? 'Oui' : 'Non');
  
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
  
  // Démarrer le reset des missions et des limites quotidiennes à minuit
  scheduleMidnightReset(() => {
    console.log('🔄 Reset des missions et limites quotidiennes à minuit');
    const { generateDailyMissions } = require('./database');
    const missions = generateDailyMissions();
    const users = db.prepare('SELECT user_id FROM users').all();
    const currentTime = Math.floor(Date.now() / 1000);
    
    for (const user of users) {
      // Réinitialiser les missions quotidiennes
      updateUser(user.user_id, {
        daily_missions: JSON.stringify(missions),
        daily_messages: 0,
        last_mission_reset: currentTime,
        // Réinitialiser le compteur de dons quotidiens
        daily_given: 0,
        last_give_reset: currentTime
      });
    }
  });
});

// Gain d'XP sur les messages
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  
  const user = ensureUser(message.author.id);
  const currentTime = now();
  const timeSinceLastXp = currentTime - (user.last_xp_gain || 0);
  
  console.log(`[XP DEBUG] Message de ${message.author.tag} (${message.author.id})`);
  console.log(`[XP DEBUG] Dernier gain d'XP: ${new Date(user.last_xp_gain).toISOString()} (${timeSinceLastXp}ms ago)`);
  console.log(`[XP DEBUG] XP actuel: ${user.xp}, Niveau: ${user.level}`);
  
  // Vérifier le cooldown XP
  if (timeSinceLastXp < config.xp.cooldown) {
    console.log(`[XP DEBUG] Cooldown non atteint: ${timeSinceLastXp}ms < ${config.xp.cooldown}ms`);
    return;
  }
  
  // Calculer gain XP avec multiplicateur VIP
  let xpGain = random(config.xp.minPerMessage, config.xp.maxPerMessage);
  const multiplier = getXpMultiplier(message.member);
  xpGain = Math.floor(xpGain * multiplier);
  
  const newXp = (user.xp || 0) + xpGain;
  const newLevel = calculateLevel(newXp);
  const levelUp = newLevel > (user.level || 1);
  const levelInfo = getLevelInfo(newXp);
  
  console.log(`[XP DEBUG] Gain d'XP: +${xpGain} (x${multiplier} multiplicateur)`);
  console.log(`[XP DEBUG] Nouvel XP: ${newXp}, Nouveau niveau: ${newLevel} (${levelUp ? 'NIVEAU SUPÉRIEUR!' : 'Pas de changement de niveau'})`);
  
  // Mettre à jour les messages quotidiens et missions
  const newDailyMessages = (user.daily_messages || 0) + 1;
  const missionReward = updateMissionProgress(message.author.id, 'messages_30', 1) ||
                       updateMissionProgress(message.author.id, 'messages_50', 1);
  
  const updateData = {
    xp: newXp,
    level: newLevel,  // Déjà une valeur numérique
    last_xp_gain: currentTime,
    daily_messages: newDailyMessages,
    balance: (user.balance || 0) + (levelUp ? 100 : 0) + (missionReward || 0)  // Augmenté de 50 à 100
  };
  
  console.log('[XP DEBUG] Mise à jour de la base de données:', JSON.stringify(updateData, null, 2));
  
  updateUser(message.author.id, updateData);
  
  if (levelUp) {
    console.log(`[XP DEBUG] Félicitations! ${message.author.tag} est maintenant niveau ${newLevel}!`);
  }
  
  if (levelUp) {
    const levelInfo = getLevelInfo(newXp);
    const embed = new EmbedBuilder()
      .setTitle('🎉 Niveau supérieur !')
      .setDescription(`Félicitations <@${message.author.id}> ! Tu es maintenant niveau **${newLevel}** !\n+100 ${config.currency.emoji} de bonus !\nProgression: ${levelInfo.currentXp}/${levelInfo.xpForNextLevel} XP (${levelInfo.progress.toFixed(1)}%)`)
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
        await handleCrashButton(interaction);
      } else if (interaction.customId.startsWith('highlow_')) {
        // Gérer les actions du High Low normal
        if (interaction.customId.startsWith('highlow_continue_') || interaction.customId.startsWith('highlow_stop_')) {
          await handleHighLowDecision(interaction);
        } else {
          await handleHighLowAction(interaction);
        }
      } else if (interaction.customId.startsWith('special_highlow_')) {
        // Gérer les actions du High Low spécial
        if (interaction.customId.startsWith('special_highlow_continue_') || interaction.customId.startsWith('special_highlow_stop_')) {
          await handleHighLowDecision(interaction);
        } else {
          await handleHighLowAction(interaction);
        }
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
  console.log(`[COMMANDE] Commande reçue: ${interaction.commandName}`);
  console.log(`[COMMANDE] Options:`, interaction.options.data);
  
  const { commandName } = interaction;
  
  // Vérifier si la commande existe
  const command = commands.find(cmd => cmd.name === commandName);
  if (!command) {
    console.error(`[ERREUR] Commande inconnue: ${commandName}`);
    return interaction.reply({
      content: '❌ Cette commande est inconnue ou n\'est pas encore implémentée.',
      ephemeral: true
    });
  }
  
  switch (commandName) {
    case 'de':
      const diceResult = Math.floor(Math.random() * 6) + 1;
      await interaction.reply(`🎲 Le dé affiche : **${diceResult}**`);
      break;
      
    case 'profil':
      console.log('[DEBUG] Commande /profil déclenchée');
      console.log('[DEBUG] Options:', interaction.options.data);
      console.log('[DEBUG] Utilisateur:', interaction.user.tag, `(${interaction.user.id})`);
      
      try {
        console.log('[DEBUG] Récupération de l\'utilisateur cible...');
        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
        const isSelf = targetUser.id === interaction.user.id;
        
        console.log(`[DEBUG] Cible: ${targetUser.tag} (${targetUser.id}) - ${isSelf ? 'soi-même' : 'autre utilisateur'}`);
        
        console.log('[DEBUG] Vérification et récupération des données utilisateur...');
        const user = ensureUser(targetUser.id);
        console.log('[DEBUG] Données utilisateur récupérées:', JSON.stringify(user, null, 2));
        
        const xp = user.xp || 0;
        console.log(`[DEBUG] XP de l'utilisateur: ${xp}`);
        
        console.log('[DEBUG] Calcul du niveau...');
        const levelInfo = getLevelInfo(xp);
        console.log('[DEBUG] Niveau calculé:', levelInfo);
        
        console.log('[DEBUG] Création de l\'embed...');
        const embed = new EmbedBuilder()
          .setTitle(`📊 Profil de ${targetUser.username}`)
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
          .setColor(0x00bfff)
          .addFields(
            { name: 'Niveau', value: `Niveau **${levelInfo.level}**`, inline: true },
            { name: 'XP', value: `${levelInfo.currentXp}/${levelInfo.xpForNextLevel} XP`, inline: true },
            { name: 'Progression', value: `${levelInfo.progress.toFixed(1)}%`, inline: true },
            { name: 'Solde', value: `**${user.balance || 0}** ${config.currency.emoji}`, inline: true },
            { name: 'Inscrit le', value: `<t:${Math.floor((user.joined_at || Date.now()) / 1000)}:D>`, inline: true }
          )
          .setFooter({ 
            text: isSelf ? 'Votre profil' : `Profil de ${targetUser.username}`,
            iconURL: interaction.user.displayAvatarURL()
          })
          .setTimestamp();
        
        // Ajouter un champ supplémentaire si c'est le profil de l'utilisateur
        if (isSelf) {
          const xpNeeded = levelInfo.xpForNextLevel - levelInfo.currentXp;
          console.log(`[DEBUG] XP nécessaire pour le prochain niveau: ${xpNeeded}`);
          
          embed.addFields({
            name: 'Prochain niveau',
            value: `Encore **${xpNeeded} XP** pour le niveau ${levelInfo.level + 1}`,
            inline: false
          });
        }
        
        console.log('[DEBUG] Envoi de la réponse...');
        const replyOptions = { 
          embeds: [embed],
          ephemeral: isSelf // Le message est éphémère uniquement si c'est le profil de l'utilisateur
        };
        console.log('[DEBUG] Options de réponse:', JSON.stringify(replyOptions, null, 2));
        
        await interaction.reply(replyOptions);
        console.log('[DEBUG] Réponse envoyée avec succès');
        
      } catch (error) {
        console.error('[ERREUR] Erreur dans la commande /profil:', error);
        console.error(error.stack);
        
        try {
          const errorMessage = '❌ Une erreur est survenue lors de la récupération du profil. Veuillez réessayer plus tard.';
          console.log(`[DEBUG] Tentative d'envoi d'un message d'erreur: "${errorMessage}"`);
          
          await interaction.reply({
            content: errorMessage,
            ephemeral: true
          });
          
          console.log('[DEBUG] Message d\'erreur envoyé avec succès');
        } catch (replyError) {
          console.error('[ERREUR CRITIQUE] Échec de l\'envoi du message d\'erreur:', replyError);
          console.error(replyError.stack);
        }
      }
      break;
      
    // Commandes de jeux
    case 'morpion':
      await handleTicTacToe(interaction);
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
      
    case 'reset-morpion-stats':
      if (interaction.user.id !== '314458846754111499') {
        return interaction.reply({ 
          content: '❌ Cette commande est réservée à l\'administrateur.', 
          ephemeral: true 
        });
      }
      
      try {
        const targetUser = interaction.options.getUser('utilisateur');
        
        if (targetUser) {
          // Réinitialiser pour un utilisateur spécifique
          resetTicTacToeStats(targetUser.id);
          await interaction.reply({ 
            content: `✅ Les statistiques du morpion de ${targetUser.tag} ont été réinitialisées avec succès !`, 
            ephemeral: true 
          });
        } else {
          // Réinitialiser pour tous les utilisateurs
          resetTicTacToeStats();
          await interaction.reply({ 
            content: '✅ Toutes les statistiques du morpion ont été réinitialisées avec succès !', 
            ephemerant: true 
          });
        }
      } catch (error) {
        console.error('Erreur lors de la réinitialisation des statistiques du morpion:', error);
        await interaction.reply({ 
          content: '❌ Une erreur est survenue lors de la réinitialisation des statistiques.', 
          ephemeral: true 
        });
      }
      break;
      
    case 'highlow':
      await handleHighLow(interaction);
      break;
      
    case 'highlow-special':
      await handleSpecialHighLow(interaction);
      break;
      
    case 'solde-special':
      const { specialHighLow } = require('./config');
      
      const isAdminOrSpecialUser = interaction.user.id === specialHighLow.adminId || 
                                interaction.user.id === specialHighLow.specialUserId;
      
      // Vérification stricte : l'utilisateur doit être autorisé ET être dans le bon salon
      if (!isAdminOrSpecialUser || interaction.channelId !== specialHighLow.channelId) {
        console.log(`[Security] Tentative d'accès non autorisée à /solde-special par ${interaction.user.id} dans le salon ${interaction.channelId}`);
        return interaction.reply({
          content: '❌ Cette commande est réservée au salon spécial et aux utilisateurs autorisés.',
          ephemeral: true
        });
      }
      
      const specialBalance = getSpecialBalance(interaction.user.id);
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Solde Spécial High Low')
        .setDescription(`Votre solde spécial est de **${specialBalance}** ${config.currency.emoji}`)
        .setColor(0x9b59b6);
        
      if (isAdminOrSpecialUser) {
        embed.addFields(
          { name: 'Statut', value: '🔹 Utilisateur spécial', inline: true }
        );
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
      
    case 'admin-solde-special':
      // Vérifier si l'utilisateur est admin
      const { specialHighLow: configHighLow } = require('./config');
      if (interaction.user.id !== configHighLow.adminId) {
        console.log(`[Security] Tentative d'accès non autorisée à /admin-solde-special par ${interaction.user.id}`);
        return interaction.reply({
          content: '❌ Cette commande est réservée à l\'administrateur.',
          ephemeral: true
        });
      }
      
      // Vérifier que la commande est utilisée dans le bon salon
      if (interaction.channelId !== configHighLow.channelId) {
        console.log(`[Security] Tentative d'utilisation de /admin-solde-special dans le mauvais salon par ${interaction.user.id}`);
        return interaction.reply({
          content: `❌ Cette commande ne peut être utilisée que dans le salon dédié.`,
          ephemeral: true
        });
      }
      
      const subcommand = interaction.options.getSubcommand();
      const adminTargetUser = interaction.options.getUser('utilisateur');
      
      try {
        switch (subcommand) {
          case 'ajouter': {
            const amount = interaction.options.getInteger('montant');
            if (amount <= 0) {
              return interaction.reply({
                content: '❌ Le montant doit être supérieur à zéro.',
                ephemeral: true
              });
            }
            
            const newBalance = updateSpecialBalance(adminTargetUser.id, amount);
            await interaction.reply({
              content: `✅ **${amount}** ${config.currency.emoji} ont été ajoutés au solde spécial de ${adminTargetUser.tag}.\nNouveau solde: **${newBalance}** ${config.currency.emoji}`,
              ephemeral: true
            });
            break;
          }
          
          case 'definir': {
            const amount = interaction.options.getInteger('montant');
            if (amount < 0) {
              return interaction.reply({
                content: '❌ Le montant ne peut pas être négatif.',
                ephemeral: true
              });
            }
            
            // Pour définir un solde spécifique, on utilise updateSpecialBalance avec la différence
            const currentBalance = getSpecialBalance(adminTargetUser.id);
            const difference = amount - currentBalance;
            const newBalance = updateSpecialBalance(adminTargetUser.id, difference);
            
            await interaction.reply({
              content: `✅ Le solde spécial de ${adminTargetUser.tag} a été défini à **${newBalance}** ${config.currency.emoji}`,
              ephemeral: true
            });
            break;
          }
          
          case 'voir': {
            const balance = getSpecialBalance(adminTargetUser.id);
            const embed = new EmbedBuilder()
              .setTitle(`💰 Solde Spécial de ${adminTargetUser.username}`)
              .setDescription(`**${balance}** ${config.currency.emoji}`)
              .setColor(0x9b59b6)
              .setThumbnail(adminTargetUser.displayAvatarURL())
              .setFooter({ text: `Demandé par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
              .setTimestamp();
              
            await interaction.reply({ embeds: [embed], ephemeral: true });
            break;
          }
        }
      } catch (error) {
        console.error('Erreur lors de la gestion de la commande admin-solde-special:', error);
        await interaction.reply({
          content: '❌ Une erreur est survenue lors du traitement de la commande.',
          ephemeral: true
        });
      }
      break;
      
    // Commandes d'administration
    case 'maintenance':
      const currentState = isMaintenanceMode();
      const result = setMaintenance(!currentState, interaction.user.id);
      
      await interaction.reply({
        content: result.message,
        flags: 'Ephemeral'
      });
      break;
      
    case 'reset-daily':
      if (interaction.user.id !== '314458846754111499') {
        return interaction.reply({
          content: '❌ Cette commande est réservée à l\'administrateur.',
          flags: 'Ephemeral'
        });
      }
      
      const targetUserId = interaction.options.getUser('utilisateur').id;
      updateUser(targetUserId, { last_daily_claim: 0 });
      
      await interaction.reply({
        content: `✅ Date de dernière récupération réinitialisée pour <@${targetUserId}>`,
        flags: 'Ephemeral'
      });
      break;
      
    case 'daily':
      const dailyUserId = interaction.user.id;
      const dailyUser = ensureUser(dailyUserId);
      const now = new Date();
      let lastClaim = dailyUser.last_daily_claim || 0;
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      
      // Vérifier si le timestamp est valide (entre 2000 et 2100)
      const lastClaimDate = new Date(lastClaim * 1000);
      const currentYear = now.getFullYear();
      
      if (lastClaimDate.getFullYear() < 2000 || lastClaimDate.getFullYear() > 2100) {
        // Timestamp invalide, on le réinitialise
        console.log('Timestamp invalide détecté, réinitialisation...');
        lastClaim = 0;
      }
      
      const lastClaimTimestamp = lastClaim * 1000;
      const todayTimestamp = today.getTime();
      
      if (lastClaim > 0 && lastClaimTimestamp >= todayTimestamp) {
        // Log pour débogage
        console.log('Dernière récupération aujourd\'hui, calcul du temps restant...');
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

    case 'set-balance':
      if (interaction.user.id !== '314458846754111499') {
        return interaction.reply({ content: '❌ Cette commande est réservée à l\'administrateur.', ephemeral: true });
      }
      
      const targetUser = interaction.options.getUser('utilisateur');
      const amount = interaction.options.getInteger('montant');
      
      // Vérifier que l'utilisateur existe dans la base de données et mettre à jour le solde
      ensureUser(targetUser.id);
      updateUser(targetUser.id, { balance: amount });
      
      await interaction.reply({
        content: `✅ Le solde de ${targetUser.tag} a été défini à **${amount}** ${config.currency.emoji}`,
        ephemeral: true
      });
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
    const dailyGiveLimit = 500;  // Augmenté de 200 à 500
    if (dailyGiven + amount > dailyGiveLimit) {
      const remaining = dailyGiveLimit - dailyGiven;
      await interaction.reply({ 
        content: `❌ Tu ne peux donner que ${remaining} ${config.currency.emoji} de plus aujourd'hui ! (Limite: ${dailyGiveLimit}/jour)`, 
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
          value: `${dailyGiven + amount}/500 ${config.currency.emoji}`, 
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
const ADMIN_ID = '314458846754111499'; // Votre ID Discord
const GIVEAWAY_CHANNEL_ID = 'YOUR_CHANNEL_ID'; // ID du salon où les giveaways seront envoyés
const MIN_HOUR = 12; // Heure minimale pour un giveaway (12h)
const MAX_HOUR = 22; // Heure maximale pour un giveaway (22h)
const GIVEAWAY_PRIZES = [500, 750, 1000, 1500, 2000]; // Valeurs possibles des prix

// Fonction pour démarrer un giveaway
async function startGiveaway(channel, isAuto = false) {
  try {
    // Vérifier s'il y a déjà un giveaway en cours
    if (activeGiveaways.has(channel.id)) {
      console.log('[Giveaway] Un giveaway est déjà en cours dans ce salon');
      return;
    }

    // Choisir un prix aléatoire
    const prize = GIVEAWAY_PRIZES[Math.floor(Math.random() * GIVEAWAY_PRIZES.length)];
    
    // Créer l'embed du giveaway
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY AUTOMATIQUE LOUTRE 🎉')
      .setDescription(`Réagissez avec 🦦 pour gagner **${prize.toLocaleString()} 🐚** !`)
      .setColor('#ffd700')
      .setFooter({ text: 'Seul le premier à réagir gagne !' });

    // Envoyer le message de giveaway
    const message = await channel.send({ embeds: [embed] });
    await message.react('🦦');

    // Stocker le giveaway
    activeGiveaways.set(channel.id, {
      messageId: message.id,
      channelId: channel.id,
      prize: prize,
      hasWinner: false,
      isAuto: isAuto
    });

    console.log(`[Giveaway] Nouveau giveaway démarré pour ${prize} 🐚`);

    // Supprimer le giveaway après 1 heure
    setTimeout(() => {
      if (activeGiveaways.has(channel.id)) {
        const giveaway = activeGiveaways.get(channel.id);
        if (!giveaway.hasWinner) {
          channel.send('🎉 Le giveaway est terminé ! Personne n\'a gagné cette fois-ci.');
        }
        activeGiveaways.delete(channel.id);
      }
    }, 3600000); // 1 heure

  } catch (error) {
    console.error('Erreur dans startGiveaway:', error);
  }
}

// Planifier le prochain giveaway
function scheduleNextGiveaway() {
  // Heure aléatoire entre MIN_HOUR et MAX_HOUR
  const hours = Math.floor(Math.random() * (MAX_HOUR - MIN_HOUR + 1)) + MIN_HOUR;
  const minutes = Math.floor(Math.random() * 60);
  
  const now = new Date();
  let targetTime = new Date();
  targetTime.setHours(hours, minutes, 0, 0);
  
  // Si l'heure est déjà passée aujourd'hui, programmer pour demain
  if (targetTime <= now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  const timeUntil = targetTime - now;
  
  console.log(`[Giveaway] Prochain giveaway programmé pour ${targetTime.toLocaleString('fr-FR')}`);
  
  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(GIVEAWAY_CHANNEL_ID);
      if (channel) {
        await startGiveaway(channel, true);
      }
    } catch (error) {
      console.error('Erreur lors du démarrage du giveaway automatique:', error);
    }
    
    // Programmer le prochain giveaway
    scheduleNextGiveaway();
  }, timeUntil);
}

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

    // Démarrer un giveaway manuel
    await startGiveaway(interaction.channel, false);
    
    // Répondre à l'interaction
    await interaction.reply({
      content: '✅ Giveaway lancé avec succès !',
      ephemeral: true
    });

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
    
    // Envoyer un message de félicitations
    const channel = reaction.message.channel;
    await channel.send(`🎉 Félicitations <@${user.id}> ! Tu as gagné **${giveaway.prize.toLocaleString()} 🐚** dans le giveaway !`);

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

// Démarrer la planification des giveaways automatiques au démarrage du bot
client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  // Démarrer la planification des giveaways
  scheduleNextGiveaway();
});

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);
