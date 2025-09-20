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
  handleHighLowDecision,
  handleMinesCommand
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
  
  // Démarrer le reset des missions, des limites quotidiennes et des récompenses BDG à minuit
  scheduleMidnightReset(async () => {
    console.log('🔄 Reset des missions, limites quotidiennes et récompenses BDG à minuit');
    const { generateDailyMissions } = require('./database');
    const missions = generateDailyMissions();
    const users = db.prepare('SELECT user_id FROM users').all();
    const currentTime = Math.floor(Date.now() / 1000);
    
    // Récupérer tous les membres du serveur pour éviter les appels répétés
    const guild = client.guilds.cache.first();
    if (guild) {
      await guild.members.fetch(); // S'assurer que tous les membres sont en cache
    }
    
    for (const user of users) {
      // Réinitialiser les missions quotidiennes et les récompenses BDG
      updateUser(user.user_id, {
        daily_missions: JSON.stringify(missions),
        daily_messages: 0,
        last_mission_reset: currentTime,
        // Réinitialiser le compteur de dons quotidiens
        daily_given: 0,
        last_give_reset: currentTime,
        // Réinitialiser la récompense BDG quotidienne
        last_bdg_claim: 0
      });
      
      // Vérifier si l'utilisateur a un rôle BDG et lui envoyer un message
      const member = client.guilds.cache.first()?.members.cache.get(user.user_id);
      if (member) {
        const bdgRoles = [
          config.shop.bdgBaby.role,
          config.shop.bdgPetit.role,
          config.shop.bdgGros.role,
          config.shop.bdgUltime.role
        ];
        
        const memberRoles = member.roles.cache.map(role => role.name);
        const hasBdgRole = bdgRoles.some(role => memberRoles.includes(role));
        
        if (hasBdgRole) {
          try {
            await member.send({
              content: '🎉 **Nouvelle récompense BDG disponible !**\nUtilise la commande `/dailybdg` pour réclamer ta récompense quotidienne ! 🐚'
            });
          } catch (error) {
            console.error(`Impossible d'envoyer un message à ${member.user.tag}:`, error);
          }
        }
      }
    }
  });
});

// Gain d'XP sur les messages
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  
  // Vérifier si le salon est dans la liste des exclus
  if (config.xp.excludedChannels.includes(message.channelId)) {
    console.log(`[XP] Message ignoré - Salon exclu: ${message.channel.name} (${message.channelId})`);
    return;
  }
  
  const user = ensureUser(message.author.id);
  const currentTime = now();
  const timeSinceLastXp = currentTime - (user.last_xp_gain || 0);
  
  console.log(`[XP DEBUG] Message de ${message.author.tag} (${message.author.id}) dans #${message.channel.name}`);
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
      } else if (interaction.customId.startsWith('mines_') || interaction.customId === 'mines_cashout' || interaction.customId === 'mines_flag') {
        // Gérer les actions du jeu des mines
        const { handleMinesButtonInteraction } = require('./games/mines');
        await handleMinesButtonInteraction(interaction);
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
  
  try {
    switch (interaction.commandName) {
      case 'de':
        const diceResult = Math.floor(Math.random() * 6) + 1;
        await interaction.reply(`🎲 Le dé affiche : **${diceResult}**`);
        break;
      
      case 'profil':
        try {
          console.log('[DEBUG] Commande /profil déclenchée');
          console.log('[DEBUG] Options:', interaction.options.data);
          console.log('[DEBUG] Utilisateur:', interaction.user.tag, `(${interaction.user.id})`);
          
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
      try {
        await handleTicTacToe(interaction);
      } catch (error) {
        console.error('[ERREUR] Erreur dans la commande /morpion:', error);
        await interaction.reply({
          content: '❌ Une erreur est survenue lors du démarrage du jeu. Veuillez réessayer plus tard.',
          ephemeral: true
        });
      }
      break;
      
    case 'crash':
      await startCrashGame(interaction);
      break;
      
    case 'dailybdg':
      await handleDailyBdg(interaction);
      break;
      
    case 'reset-dailybdg':
      await handleResetDailyBdg(interaction);
      break;
      
    case 'tas':
      try {
        console.log(`[Lottery] Command /tas received from ${interaction.user.id}`);
        
        if (!isAdmin(interaction.user.id)) {
          console.log(`[Lottery] Access denied for user ${interaction.user.id}`);
          return interaction.reply({ 
            content: '❌ Seuls les administrateurs peuvent utiliser cette commande.', 
            ephemeral: true 
          });
        }
        
        const lotterySubcommand = interaction.options.getSubcommand();
        console.log(`[Lottery] Subcommand: ${lotterySubcommand}`);
        
        const { getCurrentPot, drawLotteryWinner, getLotteryParticipants } = require('./database');
        
        if (lotterySubcommand === 'tirer') {
          console.log('[Lottery] Drawing a winner...');
          const winner = drawLotteryWinner();
          
          if (!winner) {
            console.log('[Lottery] No winner could be determined');
            return interaction.reply({
              content: '❌ Aucun participant dans le pot commun pour le moment ou erreur lors du tirage.',
              ephemeral: true
            });
          }
          
          console.log(`[Lottery] Winner found: ${JSON.stringify(winner)}`);
          
          // Update winner's balance
          console.log(`[Lottery] Updating balance for winner ${winner.userId}`);
          const user = ensureUser(winner.userId);
          updateUser(winner.userId, { balance: user.balance + winner.amount });
          
          // Get the winner's username
          let winnerName;
          try {
            console.log(`[Lottery] Fetching user info for ${winner.userId}`);
            const winnerMember = await interaction.guild.members.fetch(winner.userId);
            winnerName = winnerMember.user.tag;
            console.log(`[Lottery] Winner username: ${winnerName}`);
          } catch (e) {
            console.warn(`[Lottery] Could not fetch user info for ${winner.userId}:`, e);
            winnerName = `Utilisateur (${winner.userId})`;
          }
          
          const winMessage = `🎉 **TIRAGE AU SORT** 🎉\n` +
                          `Le gagnant du pot commun est **${winnerName}** !\n` +
                          `Il remporte **${winner.amount}** ${config.currency.emoji} !`;
          
          console.log(`[Lottery] Sending win message: ${winMessage}`);
          
          await interaction.reply({
            content: winMessage,
            allowedMentions: { users: [winner.userId] }
          });
          
        } else if (lotterySubcommand === 'statut') {
          console.log('[Lottery] Getting pot status...');
          const potAmount = getCurrentPot();
          const participants = getLotteryParticipants();
          
          console.log(`[Lottery] Pot amount: ${potAmount}, Participants: ${participants.length}`);
          
          const embed = new EmbedBuilder()
            .setTitle('💰 Pot Commun de la Loterie')
            .setDescription(
              `Montant actuel du pot : **${potAmount}** ${config.currency.emoji}\n` +
              `Nombre de participants : **${participants.length}**`
            )
            .setColor(0x00ff00)
            .setFooter({ text: '1% de chaque mise est ajouté au pot commun' });
          
          if (participants.length > 0) {
            // Afficher le top 5 des contributeurs
            const topContributors = [...participants]
              .sort((a, b) => b.amount_contributed - a.amount_contributed)
              .slice(0, 5);
            
            embed.addFields({
              name: 'Top contributeurs',
              value: topContributors
                .map((p, i) => 
                  `${i + 1}. <@${p.user_id}>: ${p.amount_contributed} ${config.currency.emoji}`
                )
                .join('\n') || 'Aucun participant',
              inline: true
            });
          }
          
          console.log('[Lottery] Sending status embed');
          await interaction.reply({ embeds: [embed] });
        }
      } catch (error) {
        console.error('[Lottery] Error in /tas command:', error);
        await interaction.reply({
          content: '❌ Une erreur est survenue lors du traitement de la commande.',
          ephemeral: true
        });
      }
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
      
      const isAdminOrSpecialUser = specialHighLow.isAdmin(interaction.user.id) || 
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
      if (!configHighLow.isAdmin(interaction.user.id)) {
        console.log(`[Security] Tentative d'accès non autorisée à /admin-solde-special par ${interaction.user.id}`);
        return interaction.reply({
          content: '❌ Cette commande est réservée aux administrateurs.',
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
      
    case 'dailybdg':
      const bdgUserId = interaction.user.id;
      const bdgUser = ensureUser(bdgUserId);
      const bdgNow = new Date();
      let lastBdgClaim = bdgUser.last_bdg_claim || 0;
      const bdgToday = new Date(bdgNow);
      bdgToday.setHours(0, 0, 0, 0);
      
      // Vérifier si l'utilisateur a un rôle BDG
      const member = await interaction.guild.members.fetch(bdgUserId);
      const bdgRoles = [
        config.shop.bdgBaby.role,
        config.shop.bdgPetit.role,
        config.shop.bdgGros.role,
        config.shop.bdgUltime.role
      ];
      
      const hasBdgRole = member.roles.cache.some(role => bdgRoles.includes(role.name));
      
      if (!hasBdgRole) {
        await interaction.reply({
          content: '❌ Vous devez avoir un rôle BDG (Bébé BDG, Petit BDG, Gros BDG ou BDG Ultime) pour utiliser cette commande !',
          ephemeral: true
        });
        return;
      }
      
      // Vérifier si le timestamp est valide (entre 2000 et 2100)
      const lastBdgClaimDate = new Date(lastBdgClaim * 1000);
      
      if (lastBdgClaimDate.getFullYear() < 2000 || lastBdgClaimDate.getFullYear() > 2100) {
        // Timestamp invalide, on le réinitialise
        console.log('Timestamp BDG invalide détecté, réinitialisation...');
        lastBdgClaim = 0;
      }
      
      const lastBdgClaimTimestamp = lastBdgClaim * 1000;
      const bdgTodayTimestamp = bdgToday.getTime();
      
      if (lastBdgClaim > 0 && lastBdgClaimTimestamp >= bdgTodayTimestamp) {
        // Calculer le temps jusqu'à minuit prochain
        const nextDay = new Date(bdgToday);
        nextDay.setDate(nextDay.getDate() + 1);
        const timeUntilReset = nextDay - bdgNow;
        const hours = Math.floor(timeUntilReset / (1000 * 60 * 60));
        const minutes = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));
        
        await interaction.reply({
          content: `⏳ Tu as déjà récupéré ta récompense BDG aujourd'hui ! Reviens dans ${hours}h${minutes}m.`,
          ephemeral: true
        });
        return;
      }
      
      // Déterminer le montant de la récompense en fonction du rôle le plus élevé
      let reward = 0;
      let roleName = '';
      
      if (member.roles.cache.some(r => r.name === config.shop.bdgUltime.role)) {
        reward = config.shop.bdgUltime.dailyReward;
        roleName = config.shop.bdgUltime.role;
      } else if (member.roles.cache.some(r => r.name === config.shop.bdgGros.role)) {
        reward = config.shop.bdgGros.dailyReward;
        roleName = config.shop.bdgGros.role;
      } else if (member.roles.cache.some(r => r.name === config.shop.bdgPetit.role)) {
        reward = config.shop.bdgPetit.dailyReward;
        roleName = config.shop.bdgPetit.role;
      } else if (member.roles.cache.some(r => r.name === config.shop.bdgBaby.role)) {
        reward = config.shop.bdgBaby.dailyReward;
        roleName = config.shop.bdgBaby.role;
      }
      
      // Mettre à jour le solde de l'utilisateur
      const newBdgBalance = (bdgUser.balance || 0) + reward;
      
      updateUser(bdgUserId, {
        balance: newBdgBalance,
        last_bdg_claim: Math.floor(bdgNow.getTime() / 1000)
      });
      
      // Envoyer la réponse
      const bdgEmbed = new EmbedBuilder()
        .setTitle('🎉 Récompense BDG journalière')
        .setDescription(`Félicitations ! En tant que **${roleName}**, tu as reçu ta récompense quotidienne de **${reward.toLocaleString()}** ${config.currency.emoji} !`)
        .addFields(
          { name: 'Nouveau solde', value: `${newBdgBalance.toLocaleString()} ${config.currency.emoji}`, inline: true },
          { name: 'Prochaine récompense', value: 'Demain à minuit', inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();
      
      await interaction.reply({ embeds: [bdgEmbed] });
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
      
    case 'mines':
      const { handleMinesCommand } = require('./games/mines');
      await handleMinesCommand(interaction);
      break;
  }
} catch (error) {
  console.error('Erreur dans la commande slash:', error);
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ 
      content: '❌ Une erreur est survenue lors du traitement de la commande.', 
      ephemeral: true 
    }).catch(console.error);
  } else {
    await interaction.followUp({ 
      content: '❌ Une erreur est survenue lors du traitement de la commande.', 
      ephemeral: true 
    }).catch(console.error);
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

// Fonction pour réinitialiser la récompense BDG d'un utilisateur
async function handleResetDailyBdg(interaction) {
  try {
    // Vérifier les permissions d'administration
    if (!isAdmin(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
        ephemeral: true
      });
    }
    
    const targetUser = interaction.options.getUser('utilisateur');
    if (!targetUser) {
      return interaction.reply({
        content: '❌ Utilisateur non trouvé.',
        ephemeral: true
      });
    }
    
    // Réinitialiser la dernière réclamation BDG
    updateUser(targetUser.id, {
      last_bdg_claim: 0
    });
    
    await interaction.reply({
      content: `✅ La récompense BDG quotidienne de <@${targetUser.id}> a été réinitialisée.`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Erreur dans handleResetDailyBdg:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors de la réinitialisation de la récompense BDG.',
        ephemeral: true
      });
    }
  }
}

// Fonction pour gérer la récompense quotidienne BDG
async function handleDailyBdg(interaction) {
  try {
    const userId = interaction.user.id;
    const member = interaction.member;
    const currentTime = Math.floor(Date.now() / 1000);
    const oneDayInSeconds = 24 * 60 * 60;
    
    // Vérifier si l'utilisateur a déjà réclamé sa récompense aujourd'hui
    const user = ensureUser(userId);
    const lastClaim = user.last_bdg_claim || 0;
    
    if (currentTime - lastClaim < oneDayInSeconds) {
      const nextClaim = lastClaim + oneDayInSeconds;
      const timeLeft = nextClaim - currentTime;
      const hours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      
      return interaction.reply({
        content: `⏳ Tu as déjà réclamé ta récompense BDG aujourd'hui. Tu pourras à nouveau réclamer dans ${hours}h${minutes}m.`,
        ephemeral: true
      });
    }
    
    // Vérifier si l'utilisateur a un rôle BDG
    const bdgRoles = [
      config.shop.bdgBaby.role,
      config.shop.bdgPetit.role,
      config.shop.bdgGros.role,
      config.shop.bdgUltime.role
    ];
    
    const memberRoles = member.roles.cache.map(role => role.name);
    const hasBdgRole = bdgRoles.some(role => memberRoles.includes(role));
    
    if (!hasBdgRole) {
      return interaction.reply({
        content: '❌ Tu dois avoir un rôle BDG pour réclamer cette récompense !',
        ephemeral: true
      });
    }
    
    // Déterminer la récompense en fonction du rôle BDG
    let reward = 0;
    let roleName = '';
    
    if (memberRoles.includes(config.shop.bdgUltime.role)) {
      reward = config.shop.bdgUltime.dailyReward;
      roleName = config.shop.bdgUltime.name;
    } else if (memberRoles.includes(config.shop.bdgGros.role)) {
      reward = config.shop.bdgGros.dailyReward;
      roleName = config.shop.bdgGros.name;
    } else if (memberRoles.includes(config.shop.bdgPetit.role)) {
      reward = config.shop.bdgPetit.dailyReward;
      roleName = config.shop.bdgPetit.name;
    } else if (memberRoles.includes(config.shop.bdgBaby.role)) {
      reward = config.shop.bdgBaby.dailyReward;
      roleName = config.shop.bdgBaby.name;
    }
    
    // Mettre à jour le solde de l'utilisateur
    const newBalance = (user.balance || 0) + reward;
    updateUser(userId, {
      balance: newBalance,
      last_bdg_claim: currentTime
    });
    
    // Envoyer un message de confirmation
    const embed = new EmbedBuilder()
      .setTitle('🎉 Récompense BDG quotidienne')
      .setDescription(`Tu as reçu ta récompense quotidienne en tant que **${roleName}** !`)
      .addFields(
        { name: 'Récompense', value: `+${reward} ${config.currency.emoji}`, inline: true },
        { name: 'Nouveau solde', value: `${newBalance} ${config.currency.emoji}`, inline: true }
      )
      .setColor(0x00ff00)
      .setFooter({ text: 'Reviens demain pour une nouvelle récompense !' });
    
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur dans handleDailyBdg:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du traitement de ta demande.',
        ephemeral: true
      });
    }
  }
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
    const dailyGiveLimit = 500;  // Limite de 500 coquillages par jour
    const newDailyGiven = dailyGiven + amount;
    
    if (newDailyGiven > dailyGiveLimit) {
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
    
    // Mise à jour du donneur avec le nouveau montant quotidien
    updateUser(giverId, { 
      balance: giverBalance - amount,
      daily_given: newDailyGiven,
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

// Importation des fonctions de giveaway depuis la base de données
const { 
  saveGiveaway, 
  getActiveGiveaway, 
  getAllActiveGiveaways, 
  setGiveawayWinner, 
  removeGiveaway 
} = require('./database');

// Liste des IDs des administrateurs
const ADMIN_IDS = new Set([
  '314458846754111499', // Votre ID Discord
  '678264841617670145'  // Nouvel administrateur
]);
const GIVEAWAY_CHANNEL_ID = '1410687939947532401'; // ID du salon où les giveaways seront envoyés
const MIN_HOUR = 12; // Heure minimale pour un giveaway (12h)
const MAX_HOUR = 22; // Heure maximale pour un giveaway (22h)
const GIVEAWAY_PRIZES = [500, 750, 1000, 1500, 2000]; // Valeurs possibles des prix
const GIVEAWAY_DURATION = 60 * 60 * 1000; // Durée du giveaway en millisecondes (1 heure)

// Cache en mémoire des giveaways actifs
const activeGiveaways = new Map();

// Fonction pour démarrer un giveaway
async function startGiveaway(channel, isAuto = false) {
  try {
    // Vérifier s'il y a déjà un giveaway en cours dans la base de données
    const existingGiveaway = getActiveGiveaway(channel.id);
    if (existingGiveaway) {
      console.log(`[Giveaway] Un giveaway est déjà en cours dans le salon ${channel.id}`);
      return;
    }

    // Choisir un prix aléatoire
    const prize = GIVEAWAY_PRIZES[Math.floor(Math.random() * GIVEAWAY_PRIZES.length)];
    const startTime = Date.now();
    const endTime = startTime + GIVEAWAY_DURATION;
    
    // Créer l'embed du giveaway
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY AUTOMATIQUE LOUTRE 🎉')
      .setDescription(`Réagissez avec 🦦 pour gagner **${prize.toLocaleString()} 🐚** !`)
      .setColor('#ffd700')
      .setFooter({ text: 'Seul le premier à réagir gagne !' });

    // Envoyer le message de giveaway
    const message = await channel.send({ embeds: [embed] });
    await message.react('🦦');

    // Sauvegarder le giveaway dans la base de données
    saveGiveaway(channel.id, message.id, prize, startTime, endTime);
    
    // Mettre à jour le cache en mémoire
    activeGiveaways.set(channel.id, {
      messageId: message.id,
      channelId: channel.id,
      prize: prize,
      endTime: endTime,
      hasWinner: false,
      isAuto: isAuto
    });

    console.log(`[Giveaway] Nouveau giveaway démarré dans #${channel.name} pour ${prize} 🐚`);

    // Planifier la fin du giveaway
    const timeLeft = endTime - Date.now();
    if (timeLeft > 0) {
      setTimeout(() => endGiveaway(channel.id), timeLeft);
    }

  } catch (error) {
    console.error('Erreur dans startGiveaway:', error);
  }
}

// Fonction pour terminer un giveaway
async function endGiveaway(channelId) {
  try {
    let giveaway = activeGiveaways.get(channelId);
    if (!giveaway) {
      // Vérifier dans la base de données si le giveaway existe toujours
      const dbGiveaway = getActiveGiveaway(channelId);
      if (!dbGiveaway) return;
      
      // Créer un objet giveaway à partir des données de la base de données
      giveaway = {
        messageId: dbGiveaway.message_id,
        channelId: dbGiveaway.channel_id,
        prize: dbGiveaway.prize,
        endTime: dbGiveaway.end_time,
        hasWinner: dbGiveaway.has_winner,
        isAuto: true
      };
    }

    // Si personne n'a gagné
    if (!giveaway.hasWinner) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          // Essayer de récupérer le message original
          try {
            const message = await channel.messages.fetch(giveaway.messageId);
            const embed = new EmbedBuilder()
              .setTitle('🎉 GIVEAWAY TERMINÉ ! 🎉')
              .setDescription('Personne n\'a gagné cette fois-ci !')
              .setColor('#ff0000')
              .setFooter({ text: 'Giveaway terminé' });
            
            await message.edit({ embeds: [embed] });
            await message.reactions.removeAll();
          } catch (error) {
            // Si le message n'existe plus, envoyer un nouveau message
            await channel.send('🎉 Le giveaway est terminé ! Personne n\'a gagné cette fois-ci.');
          }
        }
      } catch (error) {
        console.error(`[Giveaway] Erreur lors de la fin du giveaway dans le salon ${channelId}:`, error);
      }
    }

    // Nettoyer le giveaway
    activeGiveaways.delete(channelId);
    removeGiveaway(channelId);
    
    console.log(`[Giveaway] Giveaway terminé dans le salon ${channelId}`);
    
  } catch (error) {
    console.error('Erreur dans endGiveaway:', error);
  }
}

// Table pour stocker l'horaire des giveaways
db.exec(`
  CREATE TABLE IF NOT EXISTS giveaway_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    next_giveaway_time INTEGER NOT NULL
  )
`);

// Fonction pour gérer la commande /givea (admin)
async function handleGiveAdmin(interaction) {
  try {
    // Vérifier si l'utilisateur est un administrateur
    const ADMIN_IDS = ['314458846754111499', '678264841617670145'];
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Tu n\'as pas la permission d\'utiliser cette commande !',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('utilisateur');
    const amount = interaction.options.getInteger('montant');

    // Vérifications de base
    if (!targetUser || amount === null) {
      return interaction.reply({ 
        content: '❌ Paramètres invalides. Utilisation: `/givea @utilisateur montant`', 
        ephemeral: true 
      });
    }

    if (targetUser.bot) {
      return interaction.reply({ 
        content: '❌ Tu ne peux pas donner de coquillages à un bot !', 
        ephemeral: true 
      });
    }

    if (amount <= 0) {
      return interaction.reply({ 
        content: '❌ Le montant doit être supérieur à 0 !', 
        ephemeral: true 
      });
    }

    // Récupérer les informations du receveur
    const receiver = ensureUser(targetUser.id);
    const receiverBalance = receiver.balance || 0;
    
    // Mise à jour du solde du receveur
    updateUser(targetUser.id, { 
      balance: receiverBalance + amount 
    });

    // Créer et envoyer l'embed de confirmation
    const embed = new EmbedBuilder()
      .setTitle('🎁 Don de coquillages (Admin)')
      .setDescription(`L'administrateur <@${interaction.user.id}> a donné **${amount}** ${config.currency.emoji} à <@${targetUser.id}> !`)
      .addFields(
        { 
          name: 'Receveur', 
          value: `Nouveau solde: **${receiverBalance + amount}** ${config.currency.emoji}`, 
          inline: true 
        }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur dans la commande /givea:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du traitement de la commande.',
        ephemeral: true
      });
    }
  }
}

// Fonction pour obtenir l'heure du prochain giveaway
function getNextScheduledGiveawayTime() {
  const result = db.prepare('SELECT next_giveaway_time FROM giveaway_schedule WHERE id = 1').get();
  return result ? result.next_giveaway_time : null;
}

// Fonction pour mettre à jour l'heure du prochain giveaway
function updateNextScheduledGiveawayTime(timestamp) {
  if (!timestamp) {
    console.error('Erreur: timestamp manquant pour updateNextScheduledGiveawayTime');
    return;
  }
  
  try {
    db.prepare(`
      INSERT OR REPLACE INTO giveaway_schedule (id, next_giveaway_time)
      VALUES (1, ?)
    `).run(timestamp);
  } catch (error) {
    console.error('Erreur lors de la mise à jour du prochain giveaway:', error);
  }
}

// Planifier le prochain giveaway
function scheduleNextGiveaway() {
  try {
    // Vérifier s'il y a déjà une heure planifiée
    const nextScheduledTime = getNextScheduledGiveawayTime();
    let targetTime;
    
    if (nextScheduledTime) {
      targetTime = new Date(nextScheduledTime);
      // Si l'heure planifiée est dans le passé ou invalide, en générer une nouvelle
      if (isNaN(targetTime.getTime()) || targetTime <= new Date()) {
        targetTime = generateNextGiveawayTime();
        if (targetTime) {
          updateNextScheduledGiveawayTime(targetTime.getTime());
        } else {
          console.error('Erreur: Impossible de générer une heure de giveaway valide');
          // Réessayer dans 1 heure
          return setTimeout(scheduleNextGiveaway, 60 * 60 * 1000);
        }
      }
    } else {
      // Aucune heure planifiée, en générer une nouvelle
      targetTime = generateNextGiveawayTime();
      if (targetTime) {
        updateNextScheduledGiveawayTime(targetTime.getTime());
      } else {
        console.error('Erreur: Impossible de générer une heure de giveaway valide');
        // Réessayer dans 1 heure
        return setTimeout(scheduleNextGiveaway, 60 * 60 * 1000);
      }
    }
    
    const timeUntil = Math.max(0, targetTime - Date.now());
    
    if (timeUntil > 0) {
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
    } else {
      // Si le temps est déjà dépassé, programmer immédiatement
      console.log('[Giveaway] Démarrage immédiat du giveaway');
      (async () => {
        try {
          const channel = await client.channels.fetch(GIVEAWAY_CHANNEL_ID);
          if (channel) {
            await startGiveaway(channel, true);
          }
        } catch (error) {
          console.error('Erreur lors du démarrage du giveaway automatique:', error);
        }
        scheduleNextGiveaway();
      })();
    }
  } catch (error) {
    console.error('Erreur critique dans scheduleNextGiveaway:', error);
    // Réessayer dans 1 heure en cas d'erreur
    setTimeout(scheduleNextGiveaway, 60 * 60 * 1000);
  }
}

// Générer une heure aléatoire pour le prochain giveaway
function generateNextGiveawayTime() {
  try {
    // Vérifier que MIN_HOUR et MAX_HOUR sont valides
    if (typeof MIN_HOUR !== 'number' || typeof MAX_HOUR !== 'number' || 
        MIN_HOUR < 0 || MIN_HOUR > 23 || 
        MAX_HOUR < 0 || MAX_HOUR > 23 ||
        MIN_HOUR > MAX_HOUR) {
      console.error('Configuration des heures de giveaway invalide. Utilisation des valeurs par défaut (12h-22h)');
      const defaultMin = 12;
      const defaultMax = 22;
      
      // Créer une date dans le fuseau horaire de Paris
      const now = new Date();
      const parisTime = new Date(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
      
      // Heure aléatoire entre les valeurs par défaut
      const hours = Math.floor(Math.random() * (defaultMax - defaultMin + 1)) + defaultMin;
      const minutes = Math.floor(Math.random() * 60);
      
      // Créer la date cible dans le fuseau horaire de Paris
      const targetTime = new Date(parisTime);
      targetTime.setHours(hours, minutes, 0, 0);
      
      // Si l'heure est déjà passée aujourd'hui, programmer pour demain
      if (targetTime <= parisTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
      
      return targetTime;
    }
    
    // Créer une date dans le fuseau horaire de Paris
    const now = new Date();
    const parisTime = new Date(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
    
    // Heure aléatoire entre MIN_HOUR et MAX_HOUR
    const hours = Math.floor(Math.random() * (MAX_HOUR - MIN_HOUR + 1)) + MIN_HOUR;
    const minutes = Math.floor(Math.random() * 60);
    
    // Créer la date cible dans le fuseau horaire de Paris
    const targetTime = new Date(parisTime);
    targetTime.setHours(hours, minutes, 0, 0);
    
    // Si l'heure est déjà passée aujourd'hui, programmer pour demain
    if (targetTime <= parisTime) {
      targetTime.setDate(targetTime.getDate() + 1);
    }
    
    // Vérifier que la date générée est valide
    if (isNaN(targetTime.getTime())) {
      console.error('Erreur: Date de giveaway invalide générée');
      return null;
    }
    
    return targetTime;
  } catch (error) {
    console.error('Erreur dans generateNextGiveawayTime:', error);
    return null;
  }
}

// Gestion de la commande loutre-giveaway
async function handleLoutreGiveaway(interaction) {
  // Vérifier les permissions admin pour toutes les sous-commandes
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ 
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.', 
      ephemeral: true 
    });
  }

  const subcommand = interaction.options?.getSubcommand();
  
  if (subcommand === 'next') {
    // Afficher l'heure du prochain giveaway
    const nextTime = getNextScheduledGiveawayTime();
    if (!nextTime) {
      return interaction.reply({
        content: '❌ Aucun giveaway n\'est actuellement programmé.',
        ephemeral: true
      });
    }
    
    const nextDate = new Date(parseInt(nextTime));
    const now = new Date();
    const timeDiff = nextDate - now;
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    return interaction.reply({
      content: `🎉 **Prochain giveaway** prévu à ${nextDate.toLocaleTimeString('fr-FR')} le ${nextDate.toLocaleDateString('fr-FR')} (dans environ ${hours}h${minutes}m)`,
      ephemeral: true
    });
  }
  
  // Vérifier les permissions admin pour les autres sous-commandes
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ 
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.', 
      ephemeral: true 
    });
  }

  const channel = interaction.channel;
  const now = new Date();
  
  // Vérifier si un giveaway est déjà en cours
  const activeGiveaway = db.prepare('SELECT * FROM active_giveaways WHERE channel_id = ?').get(channel.id);
  if (activeGiveaway) {
    return interaction.reply({
      content: '❌ Un giveaway est déjà en cours dans ce salon !',
      ephemeral: true
    });
  }

  try {
    await startGiveaway(channel);
    
    // Planifier le prochain giveaway
    await scheduleNextGiveaway();
    
    await interaction.reply({
      content: '✅ Le giveaway a été lancé avec succès !',
      ephemeral: true
    });
  } catch (error) {
    console.error('Erreur lors du lancement du giveaway:', error);
    await interaction.reply({
      content: '❌ Une erreur est survenue lors du lancement du giveaway.',
      ephemeral: true
    });
  }
}

// Gestion des réactions aux messages de giveaway
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // Ignorer les réactions du bot
    if (user.bot) return;

    // Vérifier si c'est une réaction à un message de giveaway
    const giveaway = Array.from(activeGiveaways.values())
      .find(g => g.messageId === reaction.message.id);

    // Si pas trouvé dans le cache, vérifier dans la base de données
    let dbGiveaway = null;
    if (!giveaway) {
      dbGiveaway = getActiveGiveaway(reaction.message.channelId);
      if (dbGiveaway && dbGiveaway.message_id === reaction.message.id) {
        // Ajouter au cache
        activeGiveaways.set(dbGiveaway.channel_id, {
          messageId: dbGiveaway.message_id,
          channelId: dbGiveaway.channel_id,
          prize: dbGiveaway.prize,
          endTime: dbGiveaway.end_time,
          hasWinner: dbGiveaway.has_winner,
          isAuto: true
        });
      }
    }

    const currentGiveaway = giveaway || (dbGiveaway ? {
      messageId: dbGiveaway.message_id,
      channelId: dbGiveaway.channel_id,
      prize: dbGiveaway.prize,
      endTime: dbGiveaway.end_time,
      hasWinner: dbGiveaway.has_winner,
      isAuto: true
    } : null);

    if (!currentGiveaway || currentGiveaway.hasWinner || reaction.emoji.name !== '🦦') return;

    // Marquer qu'il y a un gagnant dans le cache
    currentGiveaway.hasWinner = true;
    activeGiveaways.set(currentGiveaway.channelId, currentGiveaway);

    // Mettre à jour la base de données
    setGiveawayWinner(currentGiveaway.channelId, user.id);
    
    // Mettre à jour le solde de l'utilisateur
    const userData = ensureUser(user.id);
    updateUser(user.id, { balance: userData.balance + currentGiveaway.prize });
    
    // Envoyer un message de félicitations
    const channel = reaction.message.channel;
    await channel.send(`🎉 Félicitations <@${user.id}> ! Tu as gagné **${currentGiveaway.prize.toLocaleString()} 🐚** dans le giveaway !`);

    // Mettre à jour le message
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY TERMINÉ ! 🎉')
      .setDescription(`Félicitations <@${user.id}> ! Tu as gagné **${currentGiveaway.prize} 🐚** !`)
      .setColor('#00ff00')
      .setFooter({ text: 'Giveaway terminé' });

    await reaction.message.edit({ embeds: [embed] });
    await reaction.message.reactions.removeAll();

    // Supprimer le giveaway (sera nettoyé par la fonction endGiveaway)
    
  } catch (error) {
    console.error('Erreur dans la gestion des réactions:', error);
  }
});

// Fonction pour restaurer les giveaways actifs au démarrage
async function restoreActiveGiveaways() {
  try {
    const activeGiveawaysList = getAllActiveGiveaways();
    console.log(`[Giveaway] Restauration de ${activeGiveawaysList.length} giveaways actifs...`);
    
    for (const giveaway of activeGiveawaysList) {
      try {
        const channel = await client.channels.fetch(giveaway.channel_id);
        if (!channel) {
          console.log(`[Giveaway] Salon ${giveaway.channel_id} introuvable, suppression du giveaway`);
          removeGiveaway(giveaway.channel_id);
          continue;
        }
        
        // Vérifier si le message existe toujours
        let message;
        try {
          message = await channel.messages.fetch(giveaway.message_id);
        } catch (error) {
          console.log(`[Giveaway] Message ${giveaway.message_id} introuvable, création d'un nouveau message`);
          // Si le message a été supprimé, en créer un nouveau
          const embed = new EmbedBuilder()
            .setTitle('🎉 GIVEAWAY AUTOMATIQUE LOUTRE 🎉')
            .setDescription(`Réagissez avec 🦦 pour gagner **${giveaway.prize.toLocaleString()} 🐚** !`)
            .setColor('#ffd700')
            .setFooter({ text: 'Seul le premier à réagir gagne !' });
          
          message = await channel.send({ embeds: [embed] });
          await message.react('🦦');
          
          // Mettre à jour l'ID du message dans la base de données
          saveGiveaway(channel.id, message.id, giveaway.prize, giveaway.start_time, giveaway.end_time);
        }
        
        // Ajouter au cache
        activeGiveaways.set(channel.id, {
          messageId: message.id,
          channelId: channel.id,
          prize: giveaway.prize,
          endTime: giveaway.end_time,
          hasWinner: giveaway.has_winner,
          isAuto: true
        });
        
        // Planifier la fin du giveaway
        const timeLeft = giveaway.end_time - Date.now();
        if (timeLeft > 0) {
          console.log(`[Giveaway] Giveaway restauré dans #${channel.name}, se termine dans ${Math.ceil(timeLeft / 1000 / 60)} minutes`);
          setTimeout(() => endGiveaway(channel.id), timeLeft);
        } else {
          // Le giveaway est déjà terminé, le nettoyer
          console.log(`[Giveaway] Giveaway expiré dans #${channel.name}, nettoyage...`);
          removeGiveaway(channel.id);
        }
        
      } catch (error) {
        console.error(`[Giveaway] Erreur lors de la restauration du giveaway:`, error);
      }
    }
    
  } catch (error) {
    console.error('[Giveaway] Erreur lors de la restauration des giveaways:', error);
  }
}

// Démarrer le serveur web pour uptime
app.listen(PORT, () => {
  console.log(`Serveur web démarré sur le port ${PORT}`);
});

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);
