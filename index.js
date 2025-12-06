require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isMaintenanceMode, isAdmin, maintenanceMiddleware, setMaintenance } = require('./maintenance');

// Modules personnalisés
const config = require('./config');
const { ensureUser, updateUser, updateMissionProgress, db, getSpecialBalance, updateSpecialBalance } = require('./database');
const { random, now, getXpMultiplier, scheduleMidnightReset, scheduleDailyReset, calculateLevel, getLevelInfo } = require('./utils');
const commands = require('./commands');

// Vérifier la commande /achat
const acheterCommand = commands.find(cmd => cmd.name === 'achat');
if (!acheterCommand) {
  console.error('❌ Commande /achat introuvable dans les commandes chargées!');
}

// Importer les fonctions de gestion des interactions
const { handleButtonInteraction, handleSelectMenuInteraction } = require('./handlers');

// Importer les fonctions utilitaires des jeux
const gameUtils = require('./game-utils');

// Importer les fonctions de jeux
const gameFunctions = require('./games');

// Configuration du logging
const DEBUG = false;
const log = {
  debug: (...args) => DEBUG && console.log('[App]', ...args),
  info: (...args) => console.log('[App]', ...args),
  error: (...args) => console.error('[App]', ...args)
};

log.info('Initialisation de l\'application...');

// Importer les fonctions spécifiques au crash
const { 
  startCrashGame, 
  handleButtonInteraction: handleCrashButton,
  handleNextMultiplier, 
  activeGames 
} = require('./crash');

// Vérification des fonctions de jeux importées
if (DEBUG) {
  log.debug('Fonctions de jeux chargées:', Object.keys(gameFunctions));
  log.debug('handleHighLow disponible:', 'handleHighLow' in gameFunctions);
}

// Initialisation du serveur web pour uptime
const app = express();
const PORT = process.env.PORT || 8080;

// Route de base pour vérifier que le serveur est en ligne
app.get('/', (req, res) => {
  res.send('🦦 Bot Loutrerie en ligne !');
});

// Démarrer le serveur web
app.listen(PORT, () => {
  log.info(`Serveur web démarré sur le port ${PORT}`);
});

// Client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Ajouter la configuration au client
client.getConfig = (guildId) => guildId ? config.getConfig(guildId) : config;

// Ajouter les fonctions de base de données au client si elles ne sont pas déjà définies
if (!client.database) {
  const { 
    ensureUser, 
    updateUser, 
    updateMissionProgress, 
    getSpecialBalance, 
    updateSpecialBalance,
    db
  } = require('./database');

  client.database = {
    ensureUser,
    updateUser,
    updateMissionProgress,
    getSpecialBalance,
    updateSpecialBalance,
    db
  };
}

// Événement ready
client.once('ready', async () => {
  log.info(`✅ ${client.user.tag} est connecté !`);
  
  // Configuration du client REST avec timeout
  const rest = new REST({ 
    version: '10',
    timeout: 10000, // 10 secondes de timeout
    retries: 1,     // Une seule tentative
    rejectRateLimitedCalls: true // Rejeter immédiatement si rate limité
  }).setToken(process.env.DISCORD_TOKEN);
  
  // Fonction pour mettre à jour les commandes avec timeout
  async function updateGuildCommands(guildId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 secondes max
    
    try {
      const result = await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { 
          body: commands,
          signal: controller.signal
        }
      );
      clearTimeout(timeout);
      return result;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
  
  try {
    log.info('Vérification des commandes...');
    
    // Vérifier si les commandes existent déjà
    let needUpdate = false;
    const existingCommands = [];
    
    for (const guild of client.guilds.cache.values()) {
      try {
        const existing = await rest.get(
          Routes.applicationGuildCommands(client.user.id, guild.id)
        );
        existingCommands[guild.id] = existing;
        
        // Vérifier si le nombre de commandes a changé
        if (existing.length !== commands.length) {
          log.info(`Mise à jour nécessaire sur ${guild.name} (${existing.length} → ${commands.length} commandes)`);
          needUpdate = true;
        }
      } catch (error) {
        log.error(`Impossible de récupérer les commandes pour ${guild.name}:`, error.message);
        needUpdate = true;
      }
    }
    
    // Si aucune mise à jour n'est nécessaire, on sort
    if (!needUpdate) {
      log.info('Les commandes sont à jour sur tous les serveurs');
      return;
    }
    
    log.info('Mise à jour des commandes...');
    
    // Si on arrive ici, c'est qu'une mise à jour est nécessaire
    try {
      // Mettre à jour sur chaque serveur avec un délai
      const guilds = Array.from(client.guilds.cache.values());
      const startTime = Date.now();
      
      log.info(`Mise à jour des commandes sur ${guilds.length} serveurs...`);
      
      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        const guildStartTime = Date.now();
        const progress = `[${i+1}/${guilds.length}]`;
        
        log.debug(`${progress} Traitement de "${guild.name}" (${guild.id})...`);
        
        try {
          // Mettre à jour les commandes pour cette guilde avec timeout
          log.debug(`   Synchronisation de ${commands.length} commandes...`);
          await updateGuildCommands(guild.id);
          
          const guildTime = ((Date.now() - guildStartTime) / 1000).toFixed(2);
          log.info(`   ${progress} ${guild.name} synchronisé en ${guildTime}s`);
          
          // Ajouter un délai entre chaque guilde pour éviter le rate limiting
          if (i < guilds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          
        } catch (guildError) {
          const errorTime = ((Date.now() - guildStartTime) / 1000).toFixed(2);
          log.error(`   ❌ Échec après ${errorTime}s:`, guildError.message);
          if (guildError.requestBody) {
            log.error(`Erreur sur ${guild.name}:`, guildError.message);
        
        // En cas d'erreur 429 (Too Many Requests), attendre le temps indiqué
        if (guildError.code === 429) {
          const retryAfter = guildError.requestBody?.json?.retry_after || 5;
          log.warn(`Trop de requêtes, attente de ${retryAfter} secondes...`);
          await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
          log.debug('Reprise après délai...');
          }
          // Continuer avec la guilde suivante même en cas d'erreur
          continue;
        }
      }
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      log.info(`\n✅ Synchronisation terminée en ${totalTime} secondes`);
      log.info(`   • ${guilds.length} serveurs traités`);
      log.info(`   • ${commands.length} commandes synchronisées`);
    } catch (putError) {
      log.error('Erreur lors de la mise à jour des commandes:', putError);
    }
    
  } catch (error) {
    log.error('Erreur lors de l\'enregistrement des commandes:', error);
  }
  
  // Planifier le reset quotidien
  scheduleMidnightReset(async () => {
    console.log('🔄 Reset des missions, limites quotidiennes et récompenses BDG/BDH à minuit');
    const { generateDailyMissions } = require('./database');
    const missions = generateDailyMissions();
    const users = db.prepare('SELECT user_id FROM users').all();
    const currentTime = Math.floor(Date.now() / 1000);
    
    const guild = client.guilds.cache.first();
    if (guild) {
      await guild.members.fetch();
    }
    
    // Liste des rôles BDG et BDH pour la notification
    const bdgRoles = [
      config.shop.bdgBaby.role,
      config.shop.bdgPetit.role,
      config.shop.bdgGros.role,
      config.shop.bdgUltime.role
    ];
    
    const bdhRoles = [
      config.shop.bdhBaby.role,
      config.shop.bdhPetit.role,
      config.shop.bdhGros.role,
      config.shop.bdhUltime.role
    ];
    
    // Ensemble pour suivre les membres à notifier (éviter les doublons)
    const membersToNotify = new Set();
    
    // 1. Mise à jour de tous les utilisateurs dans la base de données
    for (const user of users) {
      updateUser(user.user_id, {
        daily_missions: JSON.stringify(missions),
        daily_messages: 0,
        last_mission_reset: currentTime,
        daily_given: 0,
        last_give_reset: currentTime,
        last_bdg_claim: 0,
        last_bdh_claim: 0  // Ajout de la réinitialisation BDH
      });
      
      // Ajouter les membres avec rôles BDG/BDH à la liste de notification
      const member = guild?.members.cache.get(user.user_id);
      if (member) {
        const hasBdgRole = member.roles.cache.some(role => bdgRoles.includes(role.name));
        const hasBdhRole = member.roles.cache.some(role => bdhRoles.includes(role.name));
        
        if (hasBdgRole || hasBdhRole) {
          membersToNotify.add(member);
        }
      }
    }
    
    // 2. Envoyer des notifications à tous les membres concernés
    for (const member of membersToNotify) {
      try {
        const hasBdgRole = member.roles.cache.some(role => bdgRoles.includes(role.name));
        const hasBdhRole = member.roles.cache.some(role => bdhRoles.includes(role.name));
        
        let messageContent = '🎉 **Nouvelles récompenses quotidiennes disponibles !**\n';
        
        if (hasBdgRole) {
          messageContent += '• Utilise la commande `/dailybdg` pour réclamer ta récompense BDG !\n';
        }
        
        if (hasBdhRole) {
          messageContent += '• Utilise la commande `/dailybdh` pour réclamer ta récompense BDH !\n';
        }
        
        messageContent += '\n🎁 N\'oublie pas de réclamer tes récompenses chaque jour !';
        
        await member.send({
          content: messageContent
        });
      } catch (error) {
        console.error(`Impossible d'envoyer un message à ${member.user.tag}:`, error);
      }
    }
    
    // 3. Envoyer une notification dans le salon général si possible
    if (guild) {
      const generalChannel = guild.channels.cache.find(
        channel => channel.type === 'text' && channel.permissionsFor(guild.me).has('SEND_MESSAGES')
      );
      
      if (generalChannel) {
        try {
          await generalChannel.send('🔄 Les récompenses quotidiennes BDG et BDH ont été réinitialisées ! ' +
                                 'Utilisez `/dailybdg` et `/dailybdh` pour les réclamer !');
        } catch (error) {
          console.error('Impossible d\'envoyer la notification dans le salon général:', error);
        }
      }
    }
  });
});

// (Système d'XP désactivé)

// Gestion des interactions
client.on('interactionCreate', async (interaction) => {
  try {
    // Vérifier le mode maintenance pour toutes les interactions
    if (isMaintenanceMode() && interaction.user.id !== '314458846754111499') {
      return interaction.reply({ 
        content: '🛠️ Le bot est actuellement en maintenance. Veuillez réessayer plus tard.',
        flags: 'Ephemeral'
      });
    }

    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('coinflip_multi_')) {
        await gameFunctions.handleCoinflipMulti(interaction);
      } else if (interaction.customId.startsWith('roulette_')) {
        await gameFunctions.handleRouletteChoice(interaction);
      } else if (interaction.customId.startsWith('ttt_')) {
        await gameFunctions.handleTicTacToeMove(interaction);
      } else if (interaction.customId.startsWith('cf_')) {
        await gameFunctions.handleConnectFourMove(interaction);
      } else if (interaction.customId === 'cashout' || interaction.customId === 'next_multiplier') {
        await handleCrashButton(interaction);
      } else if (interaction.customId.startsWith('highlow_')) {
        // Gérer les actions du High Low normal
        if (interaction.customId.startsWith('highlow_continue_') || interaction.customId.startsWith('highlow_stop_')) {
          await gameFunctions.handleHighLowDecision(interaction);
        } else {
          await gameFunctions.handleHighLowAction(interaction);
        }
      } else if (interaction.customId.startsWith('special_highlow_')) {
        // Gérer les actions du High Low spécial
        if (interaction.customId.startsWith('special_highlow_continue_') || interaction.customId.startsWith('special_highlow_stop_')) {
          await gameFunctions.handleHighLowDecision(interaction);
        } else {
          await gameFunctions.handleHighLowAction(interaction);
        }
      } else if (interaction.customId.startsWith('blackjack_')) {
        if (isMaintenanceMode() && !isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '⛔ Le bot est en maintenance. Veuillez réessayer plus tard.', ephemeral: true });
        }
        await gameFunctions.handleBlackjackAction(interaction);
      } else if (interaction.customId.startsWith('mines_multi_')) {
        if (isMaintenanceMode() && !isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '⛔ Le bot est en maintenance. Veuillez réessayer plus tard.', ephemeral: true });
        }
        await gameFunctions.handleMinesMultiInteraction(interaction);
      } else if (interaction.customId.startsWith('mines_')) {
        if (isMaintenanceMode() && !isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '⛔ Le bot est en maintenance. Veuillez réessayer plus tard.', ephemeral: true });
        }
        await gameFunctions.handleMinesButtonInteraction(interaction);
      } else if (interaction.customId.startsWith('special_mines_')) {
        if (isMaintenanceMode() && !isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '⛔ Le bot est en maintenance. Veuillez réessayer plus tard.', ephemeral: true });
        }
        
        // Vérifier si l'utilisateur est dans le bon salon et a les permissions
        const { specialHighLow: specialConfig } = require('./config');
        const isSpecialMinesUser = specialConfig.isAdmin(interaction.user.id) || 
                                 interaction.user.id === specialConfig.specialUserId;
        
        if (!isSpecialMinesUser || interaction.channelId !== specialConfig.channelId) {
          console.log(`[Security] Tentative d'accès non autorisé au jeu des mines spécial par ${interaction.user.id} dans le salon ${interaction.channelId}`);
          return interaction.reply({
            content: ' Cette fonctionnalité est réservée au salon spécial et aux utilisateurs autorisés.',
            ephemeral: true
          });
        }
        
        await gameFunctions.handleSpecialMinesInteraction(interaction);
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
        content: ' Une erreur est survenue lors du traitement de votre demande.',
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
          const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
          const isSelf = targetUser.id === interaction.user.id;

          const user = ensureUser(targetUser.id);

          const embed = new EmbedBuilder()
            .setTitle(`👤 Profil de ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
            .setColor(0x00bfff)
            .addFields(
              { name: 'Solde', value: `**${user.balance || 0}** ${config.currency.emoji}`, inline: true },
              { name: 'Inscrit le', value: `<t:${Math.floor((user.joined_at || Date.now()) / 1000)}:D>`, inline: true }
            )
            .setFooter({ 
              text: isSelf ? 'Votre profil' : `Profil de ${targetUser.username}`,
              iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

          await interaction.reply({
            embeds: [embed],
            ephemeral: isSelf
          });
        } catch (error) {
          console.error('[ERREUR] Erreur dans la commande /profil:', error);
          if (!interaction.replied) {
            await interaction.reply({
              content: ' Une erreur est survenue lors de la récupération du profil. Veuillez réessayer plus tard.',
              ephemeral: true
            });
          }
        }
        break;
      
    // Commandes de jeux
    case 'morpion':
      try {
        await gameFunctions.handleTicTacToe(interaction);
      } catch (error) {
        console.error('[ERREUR] Erreur dans la commande /morpion:', error);
        await interaction.reply({
          content: ' Une erreur est survenue lors du démarrage du jeu. Veuillez réessayer plus tard.',
          ephemeral: true
        });
      }
      break;
      
    case 'crash':
      await startCrashGame(interaction);
      break;
      
    case 'daily':
      await handleDaily(interaction);
      break;
      
    case 'tas':
      try {
        console.log(`[Lottery] Command /tas received from ${interaction.user.id}`);
        
        if (!isAdmin(interaction.user.id)) {
          console.log(`[Lottery] Access denied for user ${interaction.user.id}`);
          return interaction.reply({ 
            content: ' Seuls les administrateurs peuvent utiliser cette commande.', 
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
              content: ' Aucun participant dans le pot commun pour le moment ou erreur lors du tirage.',
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
          
          const winMessage = ` **TIRAGE AU SORT** \n` +
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
            .setTitle(' Pot Commun de la Loterie')
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
          content: ' Une erreur est survenue lors du traitement de la commande.',
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
      
    case 'shop':
      const { handleShop } = require('./games/shop');
      await handleShop(interaction);
      break;
      
    case 'effets':
      const { getUserEffects } = require('./database');
      const effectsTargetUser = interaction.options.getUser('utilisateur') || interaction.user;
      const isSelf = effectsTargetUser.id === interaction.user.id;
      const effectsGuildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
      
      try {
        const userEffects = getUserEffects(effectsTargetUser.id, effectsGuildId);
        const activeEffects = userEffects.filter(effect => 
          (effect.expires_at && effect.expires_at > Date.now()) || 
          (!effect.expires_at && effect.uses > 0)
        );
        
        if (activeEffects.length === 0) {
          await interaction.reply({
            content: isSelf ? '💊 Vous n\'avez aucun effet temporaire actif.' : `💊 ${effectsTargetUser.username} n\'a aucun effet temporaire actif.`,
            ephemeral: true
          });
          return;
        }
        
        const embed = new EmbedBuilder()
          .setTitle(`💊 Effets temporaires de ${effectsTargetUser.username}`)
          .setDescription('Voici vos effets temporaires actuellement actifs :')
          .setColor(0x9b59b6)
          .setThumbnail(effectsTargetUser.displayAvatarURL());
        
        activeEffects.forEach(effect => {
          const timeLeft = effect.expires_at ? Math.floor((effect.expires_at - Date.now()) / 1000 / 60) : null;
          const timeText = timeLeft ? ` (${timeLeft} min restantes)` : '';
          const usesText = effect.uses > 0 ? ` | ${effect.uses} utilisation(s) restante(s)` : '';
          
          embed.addFields({
            name: `🔮 ${effect.description || effect.effect}`,
            value: `**Effet:** ${effect.effect}${timeText}${usesText}`,
            inline: false
          });
        });
        
        embed.setFooter({ 
          text: isSelf ? 'Vos effets temporaires' : `Effets de ${effectsTargetUser.username}`,
          iconURL: interaction.user.displayAvatarURL()
        });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        
      } catch (error) {
        console.error('Erreur lors de l\'affichage des effets:', error);
        await interaction.reply({
          content: '❌ Une erreur est survenue lors de l\'affichage des effets.',
          ephemeral: true
        });
      }
      break;
      
    case 'highlow':
      await gameFunctions.handleHighLow(interaction);
      break;
      
    case 'highlow-special':
      await gameFunctions.handleSpecialHighLow(interaction);
      break;
      
    case 'solde-special':
      const { specialHighLow } = require('./config');
      
      const isAdminOrSpecialUser = specialHighLow.isAdmin(interaction.user.id) || 
                                interaction.user.id === specialHighLow.specialUserId;
      
      // Vérification stricte : l'utilisateur doit être autorisé ET être dans le bon salon
      if (!isAdminOrSpecialUser || interaction.channelId !== specialHighLow.channelId) {
        console.log(`[Security] Tentative d'accès non autorisé à /solde-special par ${interaction.user.id} dans le salon ${interaction.channelId}`);
        return interaction.reply({
          content: ' Cette commande est réservée au salon spécial et aux utilisateurs autorisés.',
          ephemeral: true
        });
      }
      
      const specialBalance = getSpecialBalance(interaction.user.id);
      
      const embed = new EmbedBuilder()
        .setTitle(' Solde Spécial High Low')
        .setDescription(`Votre solde spécial est de **${specialBalance}** ${config.currency.emoji}`)
        .setColor(0x9b59b6);
        
      if (isAdminOrSpecialUser) {
        embed.addFields(
          { name: 'Statut', value: ' Utilisateur spécial', inline: true }
        );
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
      
    case 'admin-solde-special':
      // Vérifier si l'utilisateur est admin
      const { specialHighLow: configHighLow } = require('./config');
      if (!configHighLow.isAdmin(interaction.user.id)) {
        console.log(`[Security] Tentative d'accès non autorisé à /admin-solde-special par ${interaction.user.id}`);
        return interaction.reply({
          content: ' Cette commande est réservée aux administrateurs.',
          ephemeral: true
        });
      }
      
      // Vérifier que la commande est utilisée dans le bon salon
      if (interaction.channelId !== configHighLow.channelId) {
        console.log(`[Security] Tentative d'utilisation de /admin-solde-special dans le mauvais salon par ${interaction.user.id}`);
        return interaction.reply({
          content: ` Cette commande ne peut être utilisée que dans le salon dédié.`,
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
                content: ' Le montant doit être supérieur à zéro.',
                ephemeral: true
              });
            }
            
            const newBalance = updateSpecialBalance(adminTargetUser.id, amount);
            await interaction.reply({
              content: ` **${amount}** ${config.currency.emoji} ont été ajoutés au solde spécial de ${adminTargetUser.tag}.\nNouveau solde: **${newBalance}** ${config.currency.emoji}`,
              ephemeral: true
            });
            break;
          }
          
          case 'definir': {
            const amount = interaction.options.getInteger('montant');
            if (amount < 0) {
              return interaction.reply({
                content: ' Le montant ne peut pas être négatif.',
                ephemeral: true
              });
            }
            
            // Pour définir un solde spécifique, on utilise updateSpecialBalance avec la différence
            const currentBalance = getSpecialBalance(adminTargetUser.id);
            const difference = amount - currentBalance;
            const newBalance = updateSpecialBalance(adminTargetUser.id, difference);
            
            await interaction.reply({
              content: ` Le solde spécial de ${adminTargetUser.tag} a été défini à **${newBalance}** ${config.currency.emoji}`,
              ephemeral: true
            });
            break;
          }
          
          case 'voir': {
            const balance = getSpecialBalance(adminTargetUser.id);
            const embed = new EmbedBuilder()
              .setTitle(` Solde Spécial de ${adminTargetUser.username}`)
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
          content: ' Une erreur est survenue lors du traitement de la commande.',
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
      await handleResetDaily(interaction);
      break;
      
    case 'daily':
      const dailyUserId = interaction.user.id;
      const dailyGuildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
      
      // Vérifier si la commande est utilisée dans un serveur
      if (!dailyGuildId) {
        return interaction.reply({
          content: '❌ Cette commande ne peut être utilisée que dans un serveur.',
          flags: 'Ephemeral'
        });
      }
      
      const dailyUser = ensureUser(dailyUserId, dailyGuildId);
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
        console.log('Dernière réclamation aujourd\'hui, calcul du temps restant...');
        // Calculer le temps jusqu\'à minuit prochain
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
          content: ` Tu as déjà réclamé ta récompense aujourd'hui ! La prochaine récompense sera disponible à minuit dans ${timeLeftText}.`,
          ephemeral: true
        });
        return;
      }
      
      const newBalance = (dailyUser.balance || 0) + config.currency.dailyReward;
      
      updateUser(dailyUserId, dailyGuildId, {
  balance: newBalance,
  last_daily_claim: Math.floor(now.getTime() / 1000)
});
      
      await interaction.reply({
        content: ` Tu as reçu ta récompense journalière de **${config.currency.dailyReward}** ${config.currency.emoji} !\nNouveau solde: **${newBalance}** ${config.currency.emoji}`
      });
      break;
      
    case 'dailybdg':
      await handleDailyBdg(interaction);
      break;

    case 'missions':
      try {
        console.log('[MISSIONS] Récupération des données utilisateur...');
        const user = ensureUser(interaction.user.id, interaction.guildId);
        const config = require('./config');
        
        // Log de débogage pour voir la structure de l'utilisateur
        console.log('[MISSIONS] Données utilisateur brutes:', JSON.stringify(user, null, 2));
        
        // Vérifier si l'utilisateur a des missions dans daily_missions ou missions
        if (user.daily_missions) {
          console.log('[MISSIONS] Ancien format de missions détecté (daily_missions), migration...');
          try {
            // Convertir les anciennes missions au nouveau format
            const oldMissions = JSON.parse(user.daily_missions);
            user.missions = {
              daily: {},
              weekly: {},
              lifetime: {},
              lastDailyReset: user.last_mission_reset || 0,
              lastWeeklyReset: 0
            };
            
            // Convertir les anciennes missions en format quotidien
            if (Array.isArray(oldMissions)) {
              oldMissions.forEach(mission => {
                if (mission && mission.id) {
                  user.missions.daily[mission.id] = {
                    progress: mission.progress || 0,
                    completed: mission.completed || false,
                    claimed: mission.claimed || false,
                    lastUpdated: Date.now()
                  };
                }
              });
            }
            
            // Mettre à jour l'utilisateur avec le nouveau format
            await updateUser(interaction.user.id, interaction.guildId, { 
              missions: JSON.stringify(user.missions),
              daily_missions: null // Supprimer l'ancien champ
            });
            
            console.log('[MISSIONS] Migration des missions terminée');
          } catch (e) {
            console.error('[MISSIONS] Erreur lors de la migration des missions:', e);
            user.missions = { 
              daily: {}, 
              weekly: {},
              lifetime: {},
              lastDailyReset: 0,
              lastWeeklyReset: 0
            };
          }
        } else if (!user.missions || typeof user.missions === 'string') {
          // Gérer le cas où missions est une chaîne ou n'existe pas
          if (user.missions && typeof user.missions === 'string') {
            try {
              user.missions = JSON.parse(user.missions);
            } catch (e) {
              console.error('[MISSIONS] Erreur lors de la conversion des missions:', e);
              user.missions = { 
                daily: {}, 
                weekly: {},
                lifetime: {},
                lastDailyReset: 0,
                lastWeeklyReset: 0
              };
            }
          } else {
            // Aucune mission, initialiser
            console.log('[MISSIONS] Aucune mission trouvée, initialisation...');
            user.missions = { 
              daily: {}, 
              weekly: {},
              lifetime: {},
              lastDailyReset: 0,
              lastWeeklyReset: 0
            };
          }
          // Mettre à jour l'utilisateur avec la nouvelle structure
          await updateUser(interaction.user.id, interaction.guildId, { 
            missions: JSON.stringify(user.missions) 
          });
        }
        
        // Fonction pour formater une mission
        const formatMission = (mission, missionDef) => {
          const progress = mission?.progress || 0;
          const goal = missionDef?.goal || 1;
          const completed = mission?.completed || false;
          const claimed = mission?.claimed || false;
          const emoji = completed ? (claimed ? '✅' : '🎁') : '🔄';
          const status = completed 
            ? (claimed ? 'Terminée' : 'Récompense à réclamer')
            : `${progress}/${goal}`;
          
          return `${emoji} **${missionDef.description}**
          Progression: ${status} • Récompense: ${missionDef.reward} ${config.currency.emoji}${completed && !claimed ? '\n          *Cliquez sur le bouton pour réclamer*' : ''}\n`;
        };
        
        // S'assurer que les catégories de missions sont bien des objets
        if (!user.missions.daily || typeof user.missions.daily !== 'object') {
          console.log('[MISSIONS] Initialisation de la catégorie daily');
          user.missions.daily = {};
        }
        if (!user.missions.weekly || typeof user.missions.weekly !== 'object') {
          console.log('[MISSIONS] Initialisation de la catégorie weekly');
          user.missions.weekly = {};
        }
        if (!user.missions.lifetime || typeof user.missions.lifetime !== 'object') {
          console.log('[MISSIONS] Initialisation de la catégorie lifetime');
          user.missions.lifetime = {};
        }
        
        // Log des données de mission avant traitement
        console.log('[MISSIONS] Données de mission avant traitement:', JSON.stringify({
          daily: user.missions.daily,
          weekly: user.missions.weekly,
          lifetime: user.missions.lifetime
        }, null, 2));
        
        // Créer les champs pour chaque catégorie de missions avec vérification
        const dailyMissions = (config.missions.daily || []).map(mission => {
          if (!mission || !mission.id) {
            console.error('[MISSIONS] Mission invalide dans daily:', mission);
            return '';
          }
          const missionData = user.missions.daily[mission.id] || { progress: 0 };
          return formatMission(missionData, mission);
        }).filter(Boolean).join('\n\n');
        
        const weeklyMissions = (config.missions.weekly || []).map(mission => {
          if (!mission || !mission.id) {
            console.error('[MISSIONS] Mission invalide dans weekly:', mission);
            return '';
          }
          const missionData = user.missions.weekly[mission.id] || { progress: 0 };
          return formatMission(missionData, mission);
        }).filter(Boolean).join('\n\n');
        
        const lifetimeMissions = (config.missions.lifetime || []).map(mission => {
          if (!mission || !mission.id) {
            console.error('[MISSIONS] Mission invalide dans lifetime:', mission);
            return '';
          }
          const missionData = user.missions.lifetime[mission.id] || { progress: 0 };
          return formatMission(missionData, mission);
        }).filter(Boolean).join('\n\n');
        
        // Créer l'embed avec les onglets
        const missionEmbed = new EmbedBuilder()
          .setTitle('🎯 Missions')
          .setColor(0x00ff00)
          .addFields(
            { name: '📅 Journalières', value: dailyMissions || 'Aucune mission disponible', inline: false },
            { name: '📅 Hebdomadaires', value: weeklyMissions || 'Aucune mission disponible', inline: false },
            { name: '🏆 Permanentes', value: lifetimeMissions || 'Aucune mission disponible', inline: false }
          )
          .setFooter({ text: 'Les missions se réinitialisent automatiquement à minuit (journalières) et le lundi (hebdomadaires)' });
        
        // Créer les boutons pour les onglets
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('missions_daily')
              .setLabel('Journalières')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('missions_weekly')
              .setLabel('Hebdomadaires')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('missions_lifetime')
              .setLabel('Permanentes')
              .setStyle(ButtonStyle.Primary)
          );
        
        return interaction.reply({ 
          embeds: [missionEmbed],
          components: [row],
          ephemeral: true
        });
      } catch (error) {
        console.error('Erreur lors de l\'affichage des missions:', error);
        return interaction.reply({
          content: '❌ Une erreur est survenue lors de la récupération des missions. Veuillez réessayer plus tard.',
          ephemeral: true
        });
      }
      break;

    case 'classement':
      try {
        const type = 'balance';
        const classementGuildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;

        const topUsers = db.prepare(
          'SELECT * FROM users WHERE guild_id = ? ORDER BY balance DESC LIMIT 10'
        ).all(classementGuildId);
        
        let leaderboardText = '';
        topUsers.forEach((user, index) => {
          const value = `${user.balance} ${config.currency.emoji}`;
          leaderboardText += `**${index + 1}.** <@${user.user_id}> - ${value}\n`;
        });
        
        const leaderboardEmbed = new EmbedBuilder()
          .setTitle('🏆 Classement COQUILLAGES')
          .setDescription(leaderboardText || 'Aucun utilisateur trouvé')
          .setColor(0xffd700);
        
        await interaction.reply({ embeds: [leaderboardEmbed] });
      } catch (error) {
        console.error('Erreur dans la commande /classement:', error);
        if (!interaction.replied) {
          await interaction.reply({
            content: '❌ Une erreur est survenue lors de la récupération du classement.',
            ephemeral: true
          });
        }
      }
      break;

    case 'pileface':
      await gameFunctions.handleCoinflipSolo(interaction);
      break;

    case 'pileface-multi':
      await gameFunctions.handleCoinflipMulti(interaction);
      break;

    case 'blackjack':
      await gameFunctions.handleBlackjackStart(interaction);
      break;

    case 'slots':
      await gameFunctions.handleSlots(interaction);
      break;

    case 'shop':
      await gameFunctions.handleShop(interaction);
      break;

    case 'achat':
      await gameFunctions.handlePurchase(interaction);
      break;

    case 'givea':
      await handleGiveAdmin(interaction);
      break;

    case 'set-balance':
      if (interaction.user.id !== '314458846754111499') {
        return interaction.reply({ content: ' Cette commande est réservée à l\'administrateur.', ephemeral: true });
      }
      
      const giveTargetUser = interaction.options.getUser('utilisateur');
      const amount = interaction.options.getInteger('montant');
      const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
      
      // Vérifier que l'utilisateur existe dans la base de données et mettre à jour le solde
      ensureUser(giveTargetUser.id, guildId);
      updateUser(giveTargetUser.id, guildId, { balance: amount });
      
      await interaction.reply({
        content: ` Le solde de ${giveTargetUser.tag} a été défini à **${amount}** ${config.currency.emoji}`,
        ephemeral: true
      });
      break;
      
    case 'give':
      await handleGive(interaction);
      break;
      
    case 'mines':
      await gameFunctions.handleMinesCommand(interaction);
      break;
      
    case 'mines-multi':
      await gameFunctions.handleMinesMultiCommand(interaction);
      break;
      
    case 'special-mines':
      if (isMaintenanceMode() && !isAdmin(interaction.user.id)) {
        return interaction.reply({ content: '⛔ Le bot est en maintenance. Veuillez réessayer plus tard.', ephemeral: true });
      }
      
      // Vérifier si l'utilisateur est dans le bon salon et a les permissions
      const { specialHighLow: specialConfig } = require('./config');
      const isSpecialMinesUser = specialConfig.isAdmin(interaction.user.id) || 
                               interaction.user.id === specialConfig.specialUserId;
      
      if (!isSpecialMinesUser || interaction.channelId !== specialConfig.channelId) {
        console.log(`[Security] Tentative d'accès non autorisé à /special-mines par ${interaction.user.id} dans le salon ${interaction.channelId}`);
        return interaction.reply({
          content: ' Cette commande est réservée au salon spécial et aux utilisateurs autorisés.',
          ephemeral: true
        });
      }
      
      await gameFunctions.handleSpecialMinesCommand(interaction);
      break;
      
    case 'bdg':
      await handleDailyBdg(interaction);
      break;

    default:
      console.log(`[COMMANDE] Commande inconnue: ${interaction.commandName}`);
      await interaction.reply({ content: 'Commande inconnue', ephemeral: true });
      break;
    }
  } catch (error) {
    console.error(`Erreur lors de l'exécution de la commande ${interaction.commandName}:`, error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        content: 'Une erreur est survenue lors de l\'exécution de cette commande.', 
        ephemeral: true 
      });
    } else if (interaction.deferred) {
      await interaction.editReply({
        content: 'Une erreur est survenue lors de l\'exécution de cette commande.',
        ephemeral: true
      });
    }
  }
}

// Fonction pour gérer la récompense quotidienne
// Fonction pour réinitialiser les récompenses quotidiennes
async function handleResetDaily(interaction) {
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
    
    const type = interaction.options?.getString('type') || 'all';
    const updates = {};
    
    // Mettre à jour les champs en fonction du type de réinitialisation
    if (type === 'all' || type === 'standard') {
      updates.last_daily_claim = 0;
    }
    if (type === 'all' || type === 'bdg') {
      updates.last_bdg_claim = 0;
    }
    if (type === 'all' || type === 'bdh') {
      updates.last_bdh_claim = 0;
    }
    
    // Mettre à jour l'utilisateur
    updateUser(targetUser.id, interaction.guild.id, updates);
    
    await interaction.reply({
      content: `✅ Les récompenses quotidiennes de <@${targetUser.id}> ont été réinitialisées (type: ${type}).`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Erreur dans handleResetDaily:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors de la réinitialisation des récompenses.',
        ephemeral: true
      });
    }
  }
}

async function handleDaily(interaction) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const member = interaction.member;
    const user = ensureUser(userId, guildId);
    const type = interaction.options?.getString('type') || 'standard';
    
    // Vérifier le type de récompense
    if (type === 'bdg') {
      // Vérifier si l'utilisateur a un rôle BDG
      const bdgRoleNames = [
        config.shop.bdgBaby.role,
        config.shop.bdgPetit.role,
        config.shop.bdgGros.role,
        config.shop.bdgUltime.role
      ];
      
      const hasBdgRole = member.roles.cache.some(role => bdgRoleNames.includes(role.name));
      
      if (!hasBdgRole) {
        return interaction.reply({
          content: `❌ Tu dois avoir un rôle BDG (${bdgRoleNames.join(', ')}) pour utiliser cette option.`,
          ephemeral: true
        });
      }
      
      // Vérifier si l'utilisateur a déjà réclamé sa récompense BDG aujourd'hui
      if (user.last_bdg_claim) {
        const lastClaim = new Date(user.last_bdg_claim * 1000);
        const now = new Date();
        
        if (lastClaim.getDate() === now.getDate() && 
            lastClaim.getMonth() === now.getMonth() && 
            lastClaim.getFullYear() === now.getFullYear()) {
          
          return interaction.reply({
            content: `❌ Tu as déjà réclamé ta récompense BDG aujourd'hui. Tu pourras à nouveau réclamer demain à 00h01.`,
            ephemeral: true
          });
        }
      }
      
      // Définir le montant de la récompense en fonction du rôle BDG
      let rewardAmount = 0;
      if (member.roles.cache.some(role => role.name === config.shop.bdgBaby.role)) {
        rewardAmount = config.shop.bdgBaby.dailyReward;
      } else if (member.roles.cache.some(role => role.name === config.shop.bdgPetit.role)) {
        rewardAmount = config.shop.bdgPetit.dailyReward;
      } else if (member.roles.cache.some(role => role.name === config.shop.bdgGros.role)) {
        rewardAmount = config.shop.bdgGros.dailyReward;
      } else if (member.roles.cache.some(role => role.name === config.shop.bdgUltime.role)) {
        rewardAmount = config.shop.bdgUltime.dailyReward;
      }
      
      // Mettre à jour le solde de l'utilisateur avec le timestamp actuel
      const newBalance = (user.balance || 0) + rewardAmount;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      updateUser(userId, guildId, {
        balance: newBalance,
        last_bdg_claim: currentTimestamp
      });
      
      // Créer l'embed de confirmation
      const embed = new EmbedBuilder()
        .setTitle('🎉 Récompense BDG quotidienne')
        .setDescription(`Tu as reçu ta récompense BDG quotidienne de **${rewardAmount}** ${config.currency.emoji} !`)
        .addFields(
          { name: 'Nouveau solde', value: `${newBalance} ${config.currency.emoji}`, inline: true },
          { name: 'Prochaine récompense', value: 'Demain à 00h01', inline: true }
        )
        .setColor(0x00ff00)
        .setFooter({ text: 'Reviens demain pour une nouvelle récompense !' });
      
      return interaction.reply({ 
        embeds: [embed],
        ephemeral: false
      });
      
    } else if (type === 'bdh') {
      // Vérifier si l'utilisateur a un rôle BDH
      const bdhRoleNames = [
        config.shop.bdhBaby.role,
        config.shop.bdhPetit.role,
        config.shop.bdhGros.role,
        config.shop.bdhUltime.role
      ];
      
      const hasBdhRole = member.roles.cache.some(role => bdhRoleNames.includes(role.name));
      
      if (!hasBdhRole) {
        return interaction.reply({
          content: `❌ Tu dois avoir un rôle BDH (${bdhRoleNames.join(', ')}) pour utiliser cette option.`,
          ephemeral: true
        });
      }
      
      // Vérifier si l'utilisateur a déjà réclamé sa récompense BDH aujourd'hui
      if (user.last_bdh_claim) {
        const lastClaim = new Date(user.last_bdh_claim * 1000);
        const now = new Date();
        
        if (lastClaim.getDate() === now.getDate() && 
            lastClaim.getMonth() === now.getMonth() && 
            lastClaim.getFullYear() === now.getFullYear()) {
          
          return interaction.reply({
            content: `❌ Tu as déjà réclamé ta récompense BDH aujourd'hui. Tu pourras à nouveau réclamer demain à 00h01.`,
            ephemeral: true
          });
        }
      }
      
      // Définir le montant de la récompense en fonction du rôle BDH
      let rewardAmount = 0;
      if (member.roles.cache.some(role => role.name === config.shop.bdhBaby.role)) {
        rewardAmount = config.shop.bdhBaby.dailyReward;
      } else if (member.roles.cache.some(role => role.name === config.shop.bdhPetit.role)) {
        rewardAmount = config.shop.bdhPetit.dailyReward;
      } else if (member.roles.cache.some(role => role.name === config.shop.bdhGros.role)) {
        rewardAmount = config.shop.bdhGros.dailyReward;
      } else if (member.roles.cache.some(role => role.name === config.shop.bdhUltime.role)) {
        rewardAmount = config.shop.bdhUltime.dailyReward;
      }
      
      // Mettre à jour le solde de l'utilisateur avec le timestamp actuel
      const newBalance = (user.balance || 0) + rewardAmount;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      updateUser(userId, guildId, {
        balance: newBalance,
        last_bdh_claim: currentTimestamp
      });
      
      // Créer l'embed de confirmation
      const embed = new EmbedBuilder()
        .setTitle('🎉 Récompense BDH quotidienne')
        .setDescription(`Tu as reçu ta récompense BDH quotidienne de **${rewardAmount}** ${config.currency.emoji} !`)
        .addFields(
          { name: 'Nouveau solde', value: `${newBalance} ${config.currency.emoji}`, inline: true },
          { name: 'Prochaine récompense', value: 'Demain à 00h01', inline: true }
        )
        .setColor(0x00ff00)
        .setFooter({ text: 'Reviens demain pour une nouvelle récompense !' });
      
      return interaction.reply({ 
        embeds: [embed],
        ephemeral: false
      });
      
    } else {
      // Récompense standard
      // Vérifier si l'utilisateur a déjà réclamé sa récompense aujourd'hui
      if (user.last_daily_claim) {
        const lastClaim = new Date(user.last_daily_claim * 1000);
        const now = new Date();
        
        if (lastClaim.getDate() === now.getDate() && 
            lastClaim.getMonth() === now.getMonth() && 
            lastClaim.getFullYear() === now.getFullYear()) {
          
          return interaction.reply({
            content: `❌ Tu as déjà réclamé ta récompense quotidienne aujourd'hui. Tu pourras à nouveau réclamer demain à 00h01.`,
            ephemeral: true
          });
        }
      }
      
      // Montant de la récompense standard
      const rewardAmount = 100; // 100 coquillages par défaut
      
      // Mettre à jour le solde de l'utilisateur avec le timestamp actuel
      const newBalance = (user.balance || 0) + rewardAmount;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      updateUser(userId, guildId, {
        balance: newBalance,
        last_daily_claim: currentTimestamp
      });
      
      // Créer l'embed de confirmation
      const embed = new EmbedBuilder()
        .setTitle('🎉 Récompense quotidienne')
        .setDescription(`Tu as reçu ta récompense quotidienne de **${rewardAmount}** ${config.currency.emoji} !`)
        .addFields(
          { name: 'Nouveau solde', value: `${newBalance} ${config.currency.emoji}`, inline: true },
          { name: 'Prochaine récompense', value: 'Demain à 00h01', inline: true }
        )
        .setColor(0x00ff00)
        .setFooter({ text: 'Reviens demain pour une nouvelle récompense !' });
      
      return interaction.reply({ 
        embeds: [embed],
        ephemeral: false
      });
    }
    
  } catch (error) {
    console.error('Erreur dans handleDaily:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du traitement de ta demande. Réessaye plus tard ou contacte un administrateur.',
        ephemeral: true
      });
    }
  }
}

async function handleGive(interaction) {
  try {
    const targetUser = interaction.options.getUser('utilisateur');
    const guildId = interaction.guild.id;
    const amount = interaction.options.getInteger('montant');
    const giverId = interaction.user.id;

    // V�rifications de base
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

    // R�cup�rer les informations des utilisateurs
    const giver = ensureUser(giverId, guildId);
    const currentTime = Math.floor(Date.now() / 1000); // timestamp en secondes
    const oneDayInSeconds = 24 * 60 * 60;

    // V�rifier et r�initialiser le compteur quotidien si n�cessaire
    const lastReset = giver.last_give_reset || 0;
    let dailyGiven = giver.daily_given || 0;

    if (currentTime - lastReset >= oneDayInSeconds) {
      dailyGiven = 0;
      updateUser(giverId, guildId, {
        daily_given: 0,
        last_give_reset: currentTime
      });
    }

    // V�rifier la limite quotidienne
    const dailyGiveLimit = 1000;  // Limite de 1000 coquillages par jour
    const newDailyGiven = dailyGiven + amount;
    
    if (newDailyGiven > dailyGiveLimit) {
      const remaining = dailyGiveLimit - dailyGiven;
      await interaction.reply({ 
        content: `? Tu ne peux donner que ${remaining} ${config.currency.emoji} de plus aujourd'hui ! (Limite: ${dailyGiveLimit}/jour)`, 
        ephemeral: true 
      });
      return;
    }

    // V�rifier le solde du donneur
    const giverBalance = giver.balance || 0;
    if (giverBalance < amount) {
      await interaction.reply({ 
        content: `? Tu n'as pas assez de coquillages ! Tu as ${giverBalance} ${config.currency.emoji}`, 
        ephemeral: true 
      });
      return;
    }

    // Effectuer le transfert
    const receiver = ensureUser(targetUser.id, guildId);
    const receiverBalance = receiver.balance || 0;
    
    // Mise � jour du donneur avec le nouveau montant quotidien
    updateUser(giverId, guildId, { 
      balance: giverBalance - amount,
      daily_given: newDailyGiven,
      last_give_reset: currentTime
    });
    
    // Mise à jour du receveur
    updateUser(targetUser.id, guildId, { 
      balance: receiverBalance + amount 
    });

    // Mettre à jour les missions liées aux dons
    const { handleCoinGift } = require('./utils/missionUtils');
    handleCoinGift(giverId, amount, guildId);

    // Créer et envoyer l'embed de confirmation
    const embed = new EmbedBuilder()
      .setTitle('?? Don de coquillages')
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
          value: `${dailyGiven + amount}/1000 ${config.currency.emoji}`, 
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
        content: '? Une erreur est survenue lors du traitement de ta commande.',
        ephemeral: true
      });
    }
  }
}

// Importation des fonctions de giveaway depuis la base de donn�es
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
const GIVEAWAY_CHANNEL_ID = '1410687939947532401'; // ID du salon o� les giveaways seront envoy�s
const MIN_HOUR = 12; // Heure minimale pour un giveaway (12h)
const MAX_HOUR = 22; // Heure maximale pour un giveaway (22h)
const GIVEAWAY_PRIZES = [500, 750, 1000, 1500, 2000]; // Jeux
const activeGiveaway = new Map(); // Stocke les giveaways en cours

async function startGiveaway(channel, isAuto = false) {
  try {
    // V�rifier s'il y a d�j� un giveaway en cours dans la base de donn�es
    const existingGiveaway = getActiveGiveaway(channel.id);
    if (existingGiveaway) {
      console.log(`[Giveaway] Un giveaway est d�j� en cours dans le salon ${channel.id}`);
      return;
    }

    // Choisir un prix al�atoire
    const prize = GIVEAWAY_PRIZES[Math.floor(Math.random() * GIVEAWAY_PRIZES.length)];
    const startTime = Date.now();
    const endTime = startTime + GIVEAWAY_DURATION;
    
    // Cr�er l'embed du giveaway
    const embed = new EmbedBuilder()
      .setTitle('?? GIVEAWAY AUTOMATIQUE LOUTRE ??')
      .setDescription(`R�agissez avec ?? pour gagner **${prize.toLocaleString()} ??** !`)
      .setColor('#ffd700')
      .setFooter({ text: 'Seul le premier � r�agir gagne !' });

    // Envoyer le message de giveaway
    const message = await channel.send({ embeds: [embed] });
    await message.react('??');

    // Sauvegarder le giveaway dans la base de donn�es
    saveGiveaway(channel.id, message.id, prize, startTime, endTime);
    
    // Mettre � jour le cache en m�moire
    activeGiveaways.set(channel.id, {
      messageId: message.id,
      channelId: channel.id,
      prize: prize,
      endTime: endTime,
      hasWinner: false,
      isAuto: isAuto
    });

    console.log(`[Giveaway] Nouveau giveaway d�marr� dans #${channel.name} pour ${prize} ??`);

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
      // V�rifier dans la base de donn�es si le giveaway existe toujours
      const dbGiveaway = getActiveGiveaway(channelId);
      if (!dbGiveaway) return;
      
      // Cr�er un objet giveaway � partir des donn�es de la base de donn�es
      giveaway = {
        messageId: dbGiveaway.message_id,
        channelId: dbGiveaway.channel_id,
        prize: dbGiveaway.prize,
        endTime: dbGiveaway.end_time,
        hasWinner: dbGiveaway.has_winner,
        isAuto: true
      };
    }

    // Si personne n'a gagn�
    if (!giveaway.hasWinner) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          // Essayer de r�cup�rer le message original
          try {
            const message = await channel.messages.fetch(giveaway.messageId);
            const embed = new EmbedBuilder()
              .setTitle('?? GIVEAWAY TERMIN� ! ??')
              .setDescription('Personne n\'a gagn� cette fois-ci !')
              .setColor('#ff0000')
              .setFooter({ text: 'Giveaway termin�' });
            
            await message.edit({ embeds: [embed] });
            await message.reactions.removeAll();
          } catch (error) {
            // Si le message n'existe plus, envoyer un nouveau message
            await channel.send('?? Le giveaway est termin� ! Personne n\'a gagn� cette fois-ci.');
          }
        }
      } catch (error) {
        console.error(`[Giveaway] Erreur lors de la fin du giveaway dans le salon ${channelId}:`, error);
      }
    }

    // Nettoyer le giveaway
    activeGiveaways.delete(channelId);
    removeGiveaway(channelId);
    
    console.log(`[Giveaway] Giveaway termin� dans le salon ${channelId}`);
    
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

// Fonction pour g�rer la commande /givea (admin)
async function handleGiveAdmin(interaction) {
  try {
    // V�rifier si l'utilisateur est un administrateur
    const ADMIN_IDS = ['314458846754111499', '678264841617670145'];
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.reply({
        content: '? Tu n\'as pas la permission d\'utiliser cette commande !',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('utilisateur');
    const amount = interaction.options.getInteger('montant');
    const guildId = interaction.guildId;

    // V�rifications de base
    if (!targetUser || amount === null) {
      return interaction.reply({ 
        content: '? Param�tres invalides. Utilisation: `/givea @utilisateur montant`', 
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

    // R�cup�rer les informations du receveur
    const receiver = ensureUser(targetUser.id, guildId);
    const receiverBalance = receiver.balance || 0;
    
    // Mise � jour du solde du receveur
    updateUser(targetUser.id, guildId, { 
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

// Fonction pour mettre � jour l'heure du prochain giveaway
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
    console.error('Erreur lors de la mise � jour du prochain giveaway:', error);
  }
}

// Planifier le prochain giveaway
function scheduleNextGiveaway() {
  try {
    // V�rifier s'il y a d�j� une heure planifi�e
    const nextScheduledTime = getNextScheduledGiveawayTime();
    let targetTime;
    
    if (nextScheduledTime) {
      targetTime = new Date(nextScheduledTime);
      // Si l'heure planifi�e est dans le pass� ou invalide, en g�n�rer une nouvelle
      if (isNaN(targetTime.getTime()) || targetTime <= new Date()) {
        targetTime = generateNextGiveawayTime();
        if (targetTime) {
          updateNextScheduledGiveawayTime(targetTime.getTime());
        } else {
          console.error('Erreur: Impossible de g�n�rer une heure de giveaway valide');
          // R�essayer dans 1 heure
          return setTimeout(scheduleNextGiveaway, 60 * 60 * 1000);
        }
      }
    } else {
      // Aucune heure planifi�e, en g�n�rer une nouvelle
      targetTime = generateNextGiveawayTime();
      if (targetTime) {
        updateNextScheduledGiveawayTime(targetTime.getTime());
      } else {
        console.error('Erreur: Impossible de g�n�rer une heure de giveaway valide');
        // R�essayer dans 1 heure
        return setTimeout(scheduleNextGiveaway, 60 * 60 * 1000);
      }
    }
    
    const timeUntil = Math.max(0, targetTime - Date.now());
    
    if (timeUntil > 0) {
      console.log(`[Giveaway] Prochain giveaway programm� pour ${targetTime.toLocaleString('fr-FR')}`);
      
      setTimeout(async () => {
        try {
          const channel = await client.channels.fetch(GIVEAWAY_CHANNEL_ID);
          if (channel) {
            await startGiveaway(channel, true);
          }
        } catch (error) {
          console.error('Erreur lors du d�marrage du giveaway automatique:', error);
        }
        
        // Programmer le prochain giveaway
        scheduleNextGiveaway();
      }, timeUntil);
    } else {
      // Si le temps est d�j� d�pass�, programmer imm�diatement
      console.log('[Giveaway] D�marrage imm�diat du giveaway');
      (async () => {
        try {
          const channel = await client.channels.fetch(GIVEAWAY_CHANNEL_ID);
          if (channel) {
            await startGiveaway(channel, true);
          }
        } catch (error) {
          console.error('Erreur lors du d�marrage du giveaway automatique:', error);
        }
        scheduleNextGiveaway();
      })();
    }
  } catch (error) {
    console.error('Erreur critique dans scheduleNextGiveaway:', error);
    // R�essayer dans 1 heure en cas d'erreur
    setTimeout(scheduleNextGiveaway, 60 * 60 * 1000);
  }
}

// G�n�rer une heure al�atoire pour le prochain giveaway
function generateNextGiveawayTime() {
  try {
    // V�rifier que MIN_HOUR et MAX_HOUR sont valides
    if (typeof MIN_HOUR !== 'number' || typeof MAX_HOUR !== 'number' || 
        MIN_HOUR < 0 || MIN_HOUR > 23 || 
        MAX_HOUR < 0 || MAX_HOUR > 23 ||
        MIN_HOUR > MAX_HOUR) {
      console.error('Configuration des heures de giveaway invalide. Utilisation des valeurs par d�faut (12h-22h)');
      const defaultMin = 12;
      const defaultMax = 22;
      
      // Cr�er une date dans le fuseau horaire de Paris
      const now = new Date();
      const parisTime = new Date(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
      
      // Heure al�atoire entre les valeurs par d�faut
      const hours = Math.floor(Math.random() * (defaultMax - defaultMin + 1)) + defaultMin;
      const minutes = Math.floor(Math.random() * 60);
      
      // Cr�er la date cible dans le fuseau horaire de Paris
      const targetTime = new Date(parisTime);
      targetTime.setHours(hours, minutes, 0, 0);
      
      // Si l'heure est d�j� pass�e aujourd'hui, programmer pour demain
      if (targetTime <= parisTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
      
      return targetTime;
    }
    
    // Cr�er une date dans le fuseau horaire de Paris
    const now = new Date();
    const parisTime = new Date(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
    
    // Heure al�atoire entre MIN_HOUR et MAX_HOUR
    const hours = Math.floor(Math.random() * (MAX_HOUR - MIN_HOUR + 1)) + MIN_HOUR;
    const minutes = Math.floor(Math.random() * 60);
    
    // Cr�er la date cible dans le fuseau horaire de Paris
    const targetTime = new Date(parisTime);
    targetTime.setHours(hours, minutes, 0, 0);
    
    // Si l'heure est d�j� pass�e aujourd'hui, programmer pour demain
    if (targetTime <= parisTime) {
      targetTime.setDate(targetTime.getDate() + 1);
    }
    
    // V�rifier que la date g�n�r�e est valide
    if (isNaN(targetTime.getTime())) {
      console.error('Erreur: Date de giveaway invalide g�n�r�e');
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
  // V�rifier les permissions admin pour toutes les sous-commandes
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ 
      content: '🔒 Vous n\'avez pas la permission d\'utiliser cette commande.', 
      ephemeral: true 
    });
  }

  const subcommand = interaction.options?.getSubcommand();
  
  if (subcommand === 'next') {
    // Afficher l'heure du prochain giveaway
    const nextTime = getNextScheduledGiveawayTime();
    if (!nextTime) {
      return interaction.reply({
        content: '? Aucun giveaway n\'est actuellement programm�.',
        ephemeral: true
      });
    }
    
    const nextDate = new Date(parseInt(nextTime));
    const now = new Date();
    const timeDiff = nextDate - now;
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    return interaction.reply({
      content: `?? **Prochain giveaway** pr�vu � ${nextDate.toLocaleTimeString('fr-FR')} le ${nextDate.toLocaleDateString('fr-FR')} (dans environ ${hours}h${minutes}m)`,
      ephemeral: true
    });
  }
  
  // V�rifier les permissions admin pour les autres sous-commandes
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ 
      content: '🔒 Vous n\'avez pas la permission d\'utiliser cette commande.', 
      ephemeral: true 
    });
  }

  const channel = interaction.channel;
  const now = new Date();
  
  // V�rifier si un giveaway est d�j� en cours
  const activeGiveaway = db.prepare('SELECT * FROM active_giveaways WHERE channel_id = ?').get(channel.id);
  if (activeGiveaway) {
    return interaction.reply({
      content: '? Un giveaway est d�j� en cours dans ce salon !',
      ephemeral: true
    });
  }

  // Fonctionnalité de giveaway désactivée
  console.log('Fonctionnalité de giveaway désactivée');
  await interaction.reply({
    content: '? La fonctionnalité de giveaway est actuellement désactivée.',
    ephemeral: true
  });
}

// Fonction pour restaurer les giveaways actifs au d�marrage
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
        
        // V�rifier si le message existe toujours
        let message;
        try {
          message = await channel.messages.fetch(giveaway.message_id);
          
          // Vérifier si le giveaway est toujours actif
          if (giveaway.end_time > Date.now()) {
            console.log(`[Giveaway] Giveaway trouvé dans #${channel.name}, se termine dans ${Math.ceil((giveaway.end_time - Date.now()) / 1000 / 60)} minutes`);
            setTimeout(() => endGiveaway(channel.id), giveaway.end_time - Date.now());
          } else {
            // Le giveaway est déjà terminé, le nettoyer
            console.log(`[Giveaway] Giveaway expiré dans #${channel.name}, nettoyage...`);
            removeGiveaway(channel.id);
          }
        } catch (error) {
          console.log(`[Giveaway] Message ${giveaway.message_id} introuvable, création d'un nouveau message`);
          const embed = new EmbedBuilder()
            .setTitle('?? GIVEAWAY AUTOMATIQUE LOUTRE ??')
            .setDescription(`Réagissez avec ?? pour gagner **${giveaway.prize.toLocaleString()} ??** !`)
            .setColor('#ffd700')
            .setFooter({ text: 'Seul le premier à réagir gagne !' });

          message = await channel.send({ embeds: [embed] });
          await message.react('??');

          // Mettre à jour l'ID du message dans la base de données
          saveGiveaway(channel.id, message.id, giveaway.prize, giveaway.end_time, false);

          console.log(`[Giveaway] Giveaway restauré dans #${channel.name}, se termine dans ${Math.ceil((giveaway.end_time - Date.now()) / 1000 / 60)} minutes`);
          setTimeout(() => endGiveaway(channel.id), giveaway.end_time - Date.now());
        }
        
      } catch (err) {
        console.error(`[Giveaway] Erreur lors de la restauration du giveaway:`, err);
      }
    }
  } catch (error) {
    console.error('[Giveaway] Erreur lors de la restauration des giveaways:', error);
  }
}

// Désactivé: Restaurer les giveaways actifs au démarrage
// restoreActiveGiveaways();

// Fonction pour réinitialiser les limites de dons quotidiens
function resetDailyGives() {
  console.log('🔄 Réinitialisation des limites de dons quotidiens à 00h01');
  
  db.prepare(`
    UPDATE users 
    SET daily_given = 0 
    WHERE daily_given > 0
  `).run();
  
  console.log('✅ Limites de dons quotidiens réinitialisées');
}

// Fonction pour vérifier si c'est un nouveau jour (après minuit)
function isNewDay(lastClaimTimestamp) {
  if (!lastClaimTimestamp) return true;
  
  const lastClaim = new Date(lastClaimTimestamp * 1000);
  const now = new Date();
  
  return (
    lastClaim.getDate() !== now.getDate() ||
    lastClaim.getMonth() !== now.getMonth() ||
    lastClaim.getFullYear() !== now.getFullYear()
  );
}

// Fonction pour réinitialiser les réclamations quotidiennes (daily, BDG, BDH)
function resetDailyClaims() {
  console.log('🔄 Vérification des réinitialisations quotidiennes à 00h01');
  
  // Obtenir le timestamp de minuit (00:00:00) du jour actuel
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const midnightTimestamp = Math.floor(midnight.getTime() / 1000);
  
  // Mettre à jour uniquement les utilisateurs qui n'ont pas encore réclamé aujourd'hui
  db.prepare(`
    UPDATE users 
    SET last_daily_claim = CASE WHEN last_daily_claim < ? THEN last_daily_claim ELSE ? END,
        last_bdg_claim = CASE WHEN last_bdg_claim < ? THEN last_bdg_claim ELSE ? END,
        last_bdh_claim = CASE WHEN last_bdh_claim < ? THEN last_bdh_claim ELSE ? END
    WHERE last_daily_claim < ?
       OR last_bdg_claim < ?
       OR last_bdh_claim < ?
  `).run(
    midnightTimestamp, 0,  // Pour last_daily_claim
    midnightTimestamp, 0,  // Pour last_bdg_claim
    midnightTimestamp, 0,  // Pour last_bdh_claim
    midnightTimestamp,     // WHERE conditions
    midnightTimestamp,
    midnightTimestamp
  );
  
  console.log(`✅ Vérification des récompenses quotidiennes effectuée (${now.toLocaleTimeString()})`);
}

// Planifier les réinitialisations quotidiennes à 00h01
function scheduleDailyResets() {
  // Réinitialisation des dons quotidiens
  resetDailyGives();
  
  // Réinitialisation des réclamations quotidiennes
  resetDailyClaims();
  
  // Planifier les prochaines réinitialisations
  setInterval(resetDailyGives, 24 * 60 * 60 * 1000);
  setInterval(resetDailyClaims, 24 * 60 * 60 * 1000);
}

// Démarrer les réinitialisations quotidiennes
scheduleDailyReset(scheduleDailyResets);
console.log('⏰ Réinitialisations quotidiennes programmées à 00h01 chaque jour');

// Gestion des interactions de boutons pour les missions
const handleMissionButton = async (interaction) => {
  if (!interaction.isButton()) return;
  
  // Gestion des boutons de mission
  if (interaction.customId.startsWith('missions_')) {
    try {
      await interaction.deferUpdate();
      
      const userId = interaction.user.id;
      const guildId = interaction.guildId;
      const category = interaction.customId.split('_')[1]; // daily, weekly ou lifetime
      
      if (!['daily', 'weekly', 'lifetime'].includes(category)) {
        return interaction.followUp({
          content: '❌ Catégorie de mission non valide.',
          ephemeral: true
        });
      }
      
      const user = ensureUser(userId, guildId);
      const config = require('./config');
      
      // Vérifier si l'utilisateur a des missions, sinon les initialiser
      if (!user.missions) {
        user.missions = { 
          daily: {}, 
          weekly: {},
          lifetime: {},
          lastDailyReset: 0,
          lastWeeklyReset: 0
        };
        updateUser(userId, guildId, { missions: user.missions });
      }
      
      // Fonction pour formater une mission
      const formatMission = (mission, missionDef) => {
        const progress = mission?.progress || 0;
        const goal = missionDef?.goal || 1;
        const completed = mission?.completed || false;
        const claimed = mission?.claimed || false;
        const emoji = completed ? (claimed ? '✅' : '🎁') : '🔄';
        const status = completed 
          ? (claimed ? 'Terminée' : 'Récompense à réclamer')
          : `${progress}/${goal}`;
        
        return `${emoji} **${missionDef.description}**
        Progression: ${status} • Récompense: ${missionDef.reward} ${config.currency.emoji}${completed && !claimed ? '\n        *Cliquez sur le bouton pour réclamer*' : ''}\n`;
      };
      
      // Filtrer les missions par catégorie sélectionnée
      const missions = config.missions[category].map(mission => {
        const missionData = user.missions[category][mission.id] || { progress: 0 };
        return formatMission(missionData, mission);
      }).join('\n\n');
      
      // Mettre à jour l'embed avec la catégorie sélectionnée
      const missionEmbed = new EmbedBuilder()
        .setTitle(`🎯 Missions ${getCategoryName(category)}`)
        .setDescription(missions || 'Aucune mission disponible pour cette catégorie')
        .setColor(0x00ff00)
        .setFooter({ 
          text: category === 'daily' 
            ? 'Réinitialisation quotidienne à minuit' 
            : category === 'weekly' 
              ? 'Réinitialisation hebdomadaire le lundi' 
              : 'Missions permanentes' 
        });
      
      // Vérifier s'il y a des récompenses à réclamer
      const hasUnclaimedRewards = config.missions[category].some(mission => {
        const missionData = user.missions[category]?.[mission.id] || {};
        return missionData.completed && !missionData.claimed;
      });

      // Créer la rangée des boutons de navigation
      const navigationRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('missions_daily')
          .setLabel('Journalières')
          .setStyle(category === 'daily' ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('missions_weekly')
          .setLabel('Hebdomadaires')
          .setStyle(category === 'weekly' ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('missions_lifetime')
          .setLabel('Permanentes')
          .setStyle(category === 'lifetime' ? ButtonStyle.Success : ButtonStyle.Primary)
      );

      // Créer la rangée du bouton de réclamation
      const claimRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_rewards_${category}`)
          .setLabel('Réclamer les récompenses')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎁')
          .setDisabled(!hasUnclaimedRewards)
      );
      
      await interaction.editReply({
        embeds: [missionEmbed],
        components: [navigationRow, claimRow]
      });
      
    } catch (error) {
      console.error('Erreur lors de la gestion du bouton de mission:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Une erreur est survenue lors du traitement de votre demande.',
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: '❌ Une erreur est survenue lors du traitement de votre demande.',
          ephemeral: true
        });
      }
    }
  }
  
  // Gestion du bouton pour réclamer les récompenses
  else if (interaction.customId.startsWith('claim_rewards_')) {
    try {
      await interaction.deferUpdate();
      
      const userId = interaction.user.id;
      const guildId = interaction.guildId;
      const category = interaction.customId.replace('claim_rewards_', '');
      
      if (!['daily', 'weekly', 'lifetime'].includes(category)) {
        return interaction.followUp({
          content: '❌ Catégorie de mission non valide.',
          ephemeral: true
        });
      }
      
      const user = ensureUser(userId, guildId);
      const config = require('./config');
      
      // Vérifier si l'utilisateur a des missions
      if (!user.missions || !user.missions[category]) {
        return interaction.followUp({
          content: '❌ Aucune mission trouvée pour cette catégorie.',
          ephemeral: true
        });
      }
      
      let totalReward = 0;
      let claimedMissions = 0;
      
      // Parcourir toutes les missions de la catégorie
      for (const mission of config.missions[category]) {
        const missionId = mission.id;
        const missionData = user.missions[category][missionId] || {};
        
        // Si la mission est terminée mais pas encore réclamée
        if (missionData.completed && !missionData.claimed) {
          // Ajouter la récompense au total
          totalReward += mission.reward || 0;
          claimedMissions++;
          
          // Marquer la mission comme réclamée
          if (!user.missions[category][missionId]) {
            user.missions[category][missionId] = {};
          }
          user.missions[category][missionId].claimed = true;
          user.missions[category][missionId].claimedAt = Date.now();
        }
      }
      
      if (claimedMissions === 0) {
        return interaction.followUp({
          content: '❌ Aucune récompense à réclamer pour le moment.',
          ephemeral: true
        });
      }
      
      // Mettre à jour le solde de l'utilisateur
      const newBalance = (user.balance || 0) + totalReward;
      updateUser(userId, guildId, { 
        balance: newBalance,
        missions: user.missions
      });
      
      // Mettre à jour l'affichage des missions
      const missionEmbed = new EmbedBuilder()
        .setTitle('🎉 Récompenses réclamées !')
        .setDescription(`Vous avez reçu **${totalReward}** ${config.currency.emoji} pour avoir complété ${claimedMissions} mission(s) !`)
        .setColor(0x00ff00);
      
      // Recharger la vue des missions
      const missionInteraction = {
        ...interaction,
        customId: `missions_${category}`
      };
      
      // Appeler manuellement le gestionnaire de l'onglet des missions
      const missionHandler = client.handlers?.get('MISSIONS');
      if (missionHandler) {
        await missionHandler(missionInteraction);
      } else {
        // Si le gestionnaire n'est pas disponible, afficher un message de succès
        await interaction.followUp({
          embeds: [missionEmbed],
          ephemeral: true
        });
      }
      
    } catch (error) {
      console.error('Erreur lors de la réclamation des récompenses:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Une erreur est survenue lors de la réclamation des récompenses.',
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: '❌ Une erreur est survenue lors de la réclamation des récompenses.',
          ephemeral: true
        });
      }
    }
  }
};

// Enregistrer le gestionnaire d'événements pour les boutons de mission
client.on('interactionCreate', handleMissionButton);

// Fonction utilitaire pour obtenir le nom d'affichage de la catégorie
function getCategoryName(category) {
  switch (category) {
    case 'daily': return 'Journalières';
    case 'weekly': return 'Hebdomadaires';
    case 'lifetime': return 'Permanentes';
    default: return category;
  }
}

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);