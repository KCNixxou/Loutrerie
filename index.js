require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');
const { isMaintenanceMode, isAdmin, maintenanceMiddleware, setMaintenance } = require('./maintenance');
// Modules personnalis�s
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

// Initialisation du serveur web pour uptime
const app = express();
const PORT = process.env.PORT || 8080;

// Route de base pour v�rifier que le serveur est en ligne
app.get('/', (req, res) => {
  res.send('?? Bot Loutrerie en ligne !');
});

app.listen(PORT, () => {
  console.log(`Serveur web d�marr� sur le port ${PORT}`);
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

// �v�nement ready
client.once('ready', async () => {
  console.log(`? ${client.user.tag} est connect� !`);
  
  // Enregistrer les commandes
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('?? Enregistrement des commandes...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('? Commandes enregistr�es !');
  } catch (error) {
    console.error('? Erreur lors de l\'enregistrement des commandes:', error);
  }
  
  // D�marrer le reset des missions � minuit
  scheduleMidnightReset(async () => {
    console.log('?? Reset des missions, limites quotidiennes et r�compenses BDG � minuit');
    const { generateDailyMissions } = require('./database');
    const missions = generateDailyMissions();
    const users = db.prepare('SELECT user_id FROM users').all();
    const currentTime = Math.floor(Date.now() / 1000);
    
    const guild = client.guilds.cache.first();
    if (guild) {
      await guild.members.fetch();
    }
    
    for (const user of users) {
      updateUser(user.user_id, {
        daily_missions: JSON.stringify(missions),
        daily_messages: 0,
        last_mission_reset: currentTime,
        daily_given: 0,
        last_give_reset: currentTime,
        last_bdg_claim: 0
      });
      
      const member = guild?.members.cache.get(user.user_id);
      if (member) {
        const bdgRoles = [
          config.shop.bdgBaby.role,
          config.shop.bdgPetit.role,
          config.shop.bdgGros.role,
          config.shop.bdgUltime.role
        ].map(r => r.name);
        
        const hasBdgRole = member.roles.cache.some(role => bdgRoles.includes(role.name));
        
        if (hasBdgRole) {
          try {
            await member.send({
              content: '?? **Nouvelle r�compense BDG disponible !**\nUtilise la commande `/dailybdg` pour r�clamer ta r�compense quotidienne ! ??'
            });
          } catch (error) {
            console.error(`Impossible d'envoyer un message � ${member.user.tag}:`, error);
          }
        }
      }
    }
  });
});

// Gain d'XP sur les messages
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  
  // V�rifier si le salon est dans la liste des exclus
  if (config.xp.excludedChannels.includes(message.channelId)) {
    console.log(`[XP] Message ignor� - Salon exclu: ${message.channel.name} (${message.channelId})`);
    return;
  }
  
  const user = ensureUser(message.author.id);
  const currentTime = now();
  const timeSinceLastXp = currentTime - (user.last_xp_gain || 0);
  
  console.log(`[XP DEBUG] Message de ${message.author.tag} (${message.author.id}) dans #${message.channel.name}`);
  console.log(`[XP DEBUG] Dernier gain d'XP: ${new Date(user.last_xp_gain).toISOString()} (${timeSinceLastXp}ms ago)`);
  console.log(`[XP DEBUG] XP actuel: ${user.xp}, Niveau: ${user.level}`);
  
  // V�rifier le cooldown XP
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
  console.log(`[XP DEBUG] Nouvel XP: ${newXp}, Nouveau niveau: ${newLevel} (${levelUp ? 'NIVEAU SUP�RIEUR!' : 'Pas de changement de niveau'})`);
  
  // Mettre � jour les messages quotidiens et missions
  const newDailyMessages = (user.daily_messages || 0) + 1;
  const missionReward = updateMissionProgress(message.author.id, 'messages_30', 1) ||
                       updateMissionProgress(message.author.id, 'messages_50', 1);
  
  const updateData = {
    xp: newXp,
    level: newLevel,  // D�j� une valeur num�rique
    last_xp_gain: currentTime,
    daily_messages: newDailyMessages,
    balance: (user.balance || 0) + (levelUp ? 100 : 0) + (missionReward || 0)  // Augment� de 50 � 100
  };
  
  console.log('[XP DEBUG] Mise � jour de la base de donn�es:', JSON.stringify(updateData, null, 2));
  
  updateUser(message.author.id, updateData);
  
  if (levelUp) {
    console.log(`[XP DEBUG] F�licitations! ${message.author.tag} est maintenant niveau ${newLevel}!`);
  }
  
  if (levelUp) {
    const levelInfo = getLevelInfo(newXp);
    const embed = new EmbedBuilder()
      .setTitle('?? Niveau sup�rieur !')
      .setDescription(`F�licitations <@${message.author.id}> ! Tu es maintenant niveau **${newLevel}** !\n+100 ${config.currency.emoji} de bonus !\nProgression: ${levelInfo.currentXp}/${levelInfo.xpForNextLevel} XP (${levelInfo.progress.toFixed(1)}%)`)
      .setColor(0x00ff00);
    
    message.channel.send({ embeds: [embed] });
  }
});

// Gestion des interactions
client.on('interactionCreate', async (interaction) => {
  try {
    // V�rifier le mode maintenance pour toutes les interactions
    if (isMaintenanceMode() && interaction.user.id !== '314458846754111499') {
      return interaction.reply({ 
        content: '?? Le bot est actuellement en maintenance. Veuillez r�essayer plus tard.',
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
        // G�rer les actions du High Low normal
        if (interaction.customId.startsWith('highlow_continue_') || interaction.customId.startsWith('highlow_stop_')) {
          await handleHighLowDecision(interaction);
        } else {
          await handleHighLowAction(interaction);
        }
      } else if (interaction.customId.startsWith('special_highlow_')) {
        // G�rer les actions du High Low sp�cial
        if (interaction.customId.startsWith('special_highlow_continue_') || interaction.customId.startsWith('special_highlow_stop_')) {
          await handleHighLowDecision(interaction);
        } else {
          await handleHighLowAction(interaction);
        }
      } else if (interaction.customId.startsWith('mines_') || interaction.customId === 'mines_cashout' || interaction.customId === 'mines_flag') {
        // G�rer les actions du jeu des mines
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
  console.log(`[COMMANDE] Commande re�ue: ${interaction.commandName}`);
  
  try {
    switch (interaction.commandName) {
      case 'de':
        const diceResult = Math.floor(Math.random() * 6) + 1;
        await interaction.reply(`?? Le d� affiche : **${diceResult}**`);
        break;
      
      case 'profil':
        try {
          console.log('[DEBUG] Commande /profil d�clench�e');
          console.log('[DEBUG] Options:', interaction.options.data);
          console.log('[DEBUG] Utilisateur:', interaction.user.tag, `(${interaction.user.id})`);
          
          console.log('[DEBUG] R�cup�ration de l\'utilisateur cible...');
          const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
          const isSelf = targetUser.id === interaction.user.id;
        
          console.log(`[DEBUG] Cible: ${targetUser.tag} (${targetUser.id}) - ${isSelf ? 'soi-m�me' : 'autre utilisateur'}`);
        
          console.log('[DEBUG] V�rification et r�cup�ration des donn�es utilisateur...');
          const user = ensureUser(targetUser.id);
          console.log('[DEBUG] Donn�es utilisateur r�cup�r�es:', JSON.stringify(user, null, 2));
        
          const xp = user.xp || 0;
          console.log(`[DEBUG] XP de l'utilisateur: ${xp}`);
        
          console.log('[DEBUG] Calcul du niveau...');
          const levelInfo = getLevelInfo(xp);
          console.log('[DEBUG] Niveau calcul�:', levelInfo);
          
          console.log('[DEBUG] Cr�ation de l\'embed...');
          const embed = new EmbedBuilder()
            .setTitle(`?? Profil de ${targetUser.username}`)
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
          
          // Ajouter un champ suppl�mentaire si c'est le profil de l'utilisateur
          if (isSelf) {
            const xpNeeded = levelInfo.xpForNextLevel - levelInfo.currentXp;
            console.log(`[DEBUG] XP n�cessaire pour le prochain niveau: ${xpNeeded}`);
            
            embed.addFields({
              name: 'Prochain niveau',
              value: `Encore **${xpNeeded} XP** pour le niveau ${levelInfo.level + 1}`,
              inline: false
            });
          }
          
          console.log('[DEBUG] Envoi de la r�ponse...');
          const replyOptions = { 
            embeds: [embed],
            ephemeral: isSelf // Le message est �ph�m�re uniquement si c'est le profil de l'utilisateur
          };
          console.log('[DEBUG] Options de r�ponse:', JSON.stringify(replyOptions, null, 2));
          
          await interaction.reply(replyOptions);
          console.log('[DEBUG] R�ponse envoy�e avec succ�s');
          
        } catch (error) {
          console.error('[ERREUR] Erreur dans la commande /profil:', error);
          console.error(error.stack);
          
          try {
            const errorMessage = '? Une erreur est survenue lors de la r�cup�ration du profil. Veuillez r�essayer plus tard.';
            console.log(`[DEBUG] Tentative d'envoi d'un message d'erreur: "${errorMessage}"`);
          
            await interaction.reply({
              content: errorMessage,
              ephemeral: true
            });
            
            console.log('[DEBUG] Message d\'erreur envoy� avec succ�s');
          } catch (replyError) {
            console.error('[ERREUR CRITIQUE] �chec de l\'envoi du message d\'erreur:', replyError);
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
          content: '? Une erreur est survenue lors du d�marrage du jeu. Veuillez r�essayer plus tard.',
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
            content: '? Seuls les administrateurs peuvent utiliser cette commande.', 
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
              content: '? Aucun participant dans le pot commun pour le moment ou erreur lors du tirage.',
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
          
          const winMessage = `?? **TIRAGE AU SORT** ??\n` +
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
            .setTitle('?? Pot Commun de la Loterie')
            .setDescription(
              `Montant actuel du pot : **${potAmount}** ${config.currency.emoji}\n` +
              `Nombre de participants : **${participants.length}**`
            )
            .setColor(0x00ff00)
            .setFooter({ text: '1% de chaque mise est ajout� au pot commun' });
          
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
          content: '? Une erreur est survenue lors du traitement de la commande.',
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
          content: '? Cette commande est r�serv�e � l\'administrateur.', 
          ephemeral: true 
        });
      }
      
      try {
        const targetUser = interaction.options.getUser('utilisateur');
        
        if (targetUser) {
          // R�initialiser pour un utilisateur sp�cifique
          resetTicTacToeStats(targetUser.id);
          await interaction.reply({ 
            content: `? Les statistiques du morpion de ${targetUser.tag} ont �t� r�initialis�es avec succ�s !`, 
            ephemeral: true 
          });
        } else {
          // R�initialiser pour tous les utilisateurs
          resetTicTacToeStats();
          await interaction.reply({ 
            content: '? Toutes les statistiques du morpion ont été réinitialisées avec succès !', 
            ephemeral: true 
          });
        }
      } catch (error) {
        console.error('Erreur lors de la réinitialisation des statistiques du morpion:', error);
        await interaction.reply({ 
          content: '? Une erreur est survenue lors de la réinitialisation des statistiques.', 
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
      
      // V�rification stricte : l'utilisateur doit �tre autoris� ET �tre dans le bon salon
      if (!isAdminOrSpecialUser || interaction.channelId !== specialHighLow.channelId) {
        console.log(`[Security] Tentative d'acc�s non autoris�e � /solde-special par ${interaction.user.id} dans le salon ${interaction.channelId}`);
        return interaction.reply({
          content: '? Cette commande est r�serv�e au salon sp�cial et aux utilisateurs autoris�s.',
          ephemeral: true
        });
      }
      
      const specialBalance = getSpecialBalance(interaction.user.id);
      
      const embed = new EmbedBuilder()
        .setTitle('?? Solde Sp�cial High Low')
        .setDescription(`Votre solde sp�cial est de **${specialBalance}** ${config.currency.emoji}`)
        .setColor(0x9b59b6);
        
      if (isAdminOrSpecialUser) {
        embed.addFields(
          { name: 'Statut', value: '?? Utilisateur sp�cial', inline: true }
        );
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
      
    case 'admin-solde-special':
      // V�rifier si l'utilisateur est admin
      const { specialHighLow: configHighLow } = require('./config');
      if (!configHighLow.isAdmin(interaction.user.id)) {
        console.log(`[Security] Tentative d'acc�s non autoris�e � /admin-solde-special par ${interaction.user.id}`);
        return interaction.reply({
          content: '? Cette commande est r�serv�e aux administrateurs.',
          ephemeral: true
        });
      }
      
      // V�rifier que la commande est utilis�e dans le bon salon
      if (interaction.channelId !== configHighLow.channelId) {
        console.log(`[Security] Tentative d'utilisation de /admin-solde-special dans le mauvais salon par ${interaction.user.id}`);
        return interaction.reply({
          content: `? Cette commande ne peut �tre utilis�e que dans le salon d�di�.`,
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
                content: '? Le montant doit �tre sup�rieur � z�ro.',
                ephemeral: true
              });
            }
            
            const newBalance = updateSpecialBalance(adminTargetUser.id, amount);
            await interaction.reply({
              content: `? **${amount}** ${config.currency.emoji} ont �t� ajout�s au solde sp�cial de ${adminTargetUser.tag}.\nNouveau solde: **${newBalance}** ${config.currency.emoji}`,
              ephemeral: true
            });
            break;
          }
          
          case 'definir': {
            const amount = interaction.options.getInteger('montant');
            if (amount < 0) {
              return interaction.reply({
                content: '? Le montant ne peut pas �tre n�gatif.',
                ephemeral: true
              });
            }
            
            // Pour d�finir un solde sp�cifique, on utilise updateSpecialBalance avec la diff�rence
            const currentBalance = getSpecialBalance(adminTargetUser.id);
            const difference = amount - currentBalance;
            const newBalance = updateSpecialBalance(adminTargetUser.id, difference);
            
            await interaction.reply({
              content: `? Le solde sp�cial de ${adminTargetUser.tag} a �t� d�fini � **${newBalance}** ${config.currency.emoji}`,
              ephemeral: true
            });
            break;
          }
          
          case 'voir': {
            const balance = getSpecialBalance(adminTargetUser.id);
            const embed = new EmbedBuilder()
              .setTitle(`?? Solde Sp�cial de ${adminTargetUser.username}`)
              .setDescription(`**${balance}** ${config.currency.emoji}`)
              .setColor(0x9b59b6)
              .setThumbnail(adminTargetUser.displayAvatarURL())
              .setFooter({ text: `Demand� par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
              .setTimestamp();
              
            await interaction.reply({ embeds: [embed], ephemeral: true });
            break;
          }
        }
      } catch (error) {
        console.error('Erreur lors de la gestion de la commande admin-solde-special:', error);
        await interaction.reply({
          content: '? Une erreur est survenue lors du traitement de la commande.',
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
          content: '? Cette commande est r�serv�e � l\'administrateur.',
          flags: 'Ephemeral'
        });
      }
      
      const targetUserId = interaction.options.getUser('utilisateur').id;
      updateUser(targetUserId, { last_daily_claim: 0 });
      
      await interaction.reply({
        content: `? Date de derni�re r�cup�ration r�initialis�e pour <@${targetUserId}>`,
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
      
      // V�rifier si le timestamp est valide (entre 2000 et 2100)
      const lastClaimDate = new Date(lastClaim * 1000);
      const currentYear = now.getFullYear();
      
      if (lastClaimDate.getFullYear() < 2000 || lastClaimDate.getFullYear() > 2100) {
        // Timestamp invalide, on le r�initialise
        console.log('Timestamp invalide d�tect�, r�initialisation...');
        lastClaim = 0;
      }
      
      const lastClaimTimestamp = lastClaim * 1000;
      const todayTimestamp = today.getTime();
      
      if (lastClaim > 0 && lastClaimTimestamp >= todayTimestamp) {
        // Log pour d�bogage
        console.log('Derni�re r�cup�ration aujourd\'hui, calcul du temps restant...');
        // Calculer le temps jusqu'� minuit prochain
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
          content: `? Tu as d�j� r�cup�r� ta r�compense aujourd'hui ! La prochaine r�compense sera disponible � minuit dans ${timeLeftText}.`,
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
        content: `?? Tu as re�u ta r�compense journali�re de **${config.currency.dailyReward}** ${config.currency.emoji} !\nNouveau solde: **${newBalance}** ${config.currency.emoji}`
      });
      break;
      
    case 'dailybdg':
      await handleDailyBdg(interaction);
      break;

    case 'missions':
      const userMissions = ensureUser(interaction.user.id);
      const missions = JSON.parse(userMissions.daily_missions || '[]');
      let missionText = '';
      
      missions.forEach(mission => {
        const status = mission.completed ? '✅' : `${mission.progress || 0}/${mission.goal}`;
        const emoji = mission.completed ? '✅' : '❌';
        missionText += `${emoji} **${mission.description}**\n`;
        missionText += `   Progression: ${status} • Récompense: ${mission.reward} ${config.currency.emoji}\n\n`;
      });
      
      const missionEmbed = new EmbedBuilder()
        .setTitle('🎯 Missions Journalières')
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
        .setTitle(`?? Classement ${type.toUpperCase()}`)
        .setDescription(leaderboardText || 'Aucun utilisateur trouv�')
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
        return interaction.reply({ content: '? Cette commande est r�serv�e � l\'administrateur.', ephemeral: true });
      }
      
      const targetUser = interaction.options.getUser('utilisateur');
      const amount = interaction.options.getInteger('montant');
      
      // V�rifier que l'utilisateur existe dans la base de donn�es et mettre � jour le solde
      ensureUser(targetUser.id);
      updateUser(targetUser.id, { balance: amount });
      
      await interaction.reply({
        content: `? Le solde de ${targetUser.tag} a �t� d�fini � **${amount}** ${config.currency.emoji}`,
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

// Fonction pour réinitialiser la récompense BDG d'un utilisateur
async function handleResetDailyBdg(interaction) {
  try {
    // Vérifier les permissions d'administration
    if (!isAdmin(interaction.user.id)) {
      return interaction.reply({
        content: '? Vous n\'avez pas la permission d\'utiliser cette commande.',
        ephemeral: true
      });
    }
    
    const targetUser = interaction.options.getUser('utilisateur');
    if (!targetUser) {
      return interaction.reply({
        content: '? Utilisateur non trouv�.',
        ephemeral: true
      });
    }
    
    // R�initialiser la derni�re r�clamation BDG
    updateUser(targetUser.id, {
      last_bdg_claim: 0
    });
    
    await interaction.reply({
      content: `? La r�compense BDG quotidienne de <@${targetUser.id}> a �t� r�initialis�e.`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Erreur dans handleResetDailyBdg:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '? Une erreur est survenue lors de la r�initialisation de la r�compense BDG.',
        ephemeral: true
      });
    }
  }
}

// Fonction pour g�rer la r�compense quotidienne BDG
async function handleDailyBdg(interaction) {
  try {
    const userId = interaction.user.id;
    const member = interaction.member;
    const currentTime = Math.floor(Date.now() / 1000);
    const oneDayInSeconds = 24 * 60 * 60;
    
    // V�rifier si l'utilisateur a d�j� r�clam� sa r�compense aujourd'hui
    const user = ensureUser(userId);
    const lastClaim = user.last_bdg_claim || 0;
    
    if (currentTime - lastClaim < oneDayInSeconds) {
      const nextClaim = lastClaim + oneDayInSeconds;
      const timeLeft = nextClaim - currentTime;
      const hours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      
      return interaction.reply({
        content: `? Tu as d�j� r�clam� ta r�compense BDG aujourd'hui. Tu pourras � nouveau r�clamer dans ${hours}h${minutes}m.`,
        ephemeral: true
      });
    }

    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur dans handleDailyBdg:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: '? Une erreur est survenue lors du traitement de ta demande.',
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

    // V�rifications de base
    if (!targetUser || !amount) {
      await interaction.reply({ 
        content: '? Param�tres invalides. Utilisation: `/give @utilisateur montant`', 
        ephemeral: true 
      });
      return;
    }

    if (targetUser.bot) {
      await interaction.reply({ 
        content: '? Tu ne peux pas donner de coquillages � un bot !', 
        ephemeral: true 
      });
      return;
    }

    if (targetUser.id === giverId) {
      await interaction.reply({ 
        content: '? Tu ne peux pas te donner des coquillages � toi-m�me !', 
        ephemeral: true 
      });
      return;
    }

    if (amount <= 0) {
      await interaction.reply({ 
        content: '? Le montant doit �tre sup�rieur � 0 !', 
        ephemeral: true 
      });
      return;
    }

    // R�cup�rer les informations des utilisateurs
    const giver = ensureUser(giverId);
    const currentTime = Math.floor(Date.now() / 1000); // timestamp en secondes
    const oneDayInSeconds = 24 * 60 * 60;

    // V�rifier et r�initialiser le compteur quotidien si n�cessaire
    const lastReset = giver.last_give_reset || 0;
    let dailyGiven = giver.daily_given || 0;

    if (currentTime - lastReset >= oneDayInSeconds) {
      dailyGiven = 0;
      updateUser(giverId, {
        daily_given: 0,
        last_give_reset: currentTime
      });
    }

    // V�rifier la limite quotidienne
    const dailyGiveLimit = 500;  // Limite de 500 coquillages par jour
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
    const receiver = ensureUser(targetUser.id);
    const receiverBalance = receiver.balance || 0;
    
    // Mise � jour du donneur avec le nouveau montant quotidien
    updateUser(giverId, { 
      balance: giverBalance - amount,
      daily_given: newDailyGiven,
      last_give_reset: currentTime
    });
    
    // Mise � jour du receveur
    updateUser(targetUser.id, { 
      balance: receiverBalance + amount 
    });

    // Cr�er et envoyer l'embed de confirmation
    const embed = new EmbedBuilder()
      .setTitle('?? Don de coquillages')
      .setDescription(`<@${giverId}> a donn� **${amount}** ${config.currency.emoji} � <@${targetUser.id}> !`)
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
const GIVEAWAY_PRIZES = [500, 750, 1000, 1500, 2000]; // Valeurs possibles des prix
const GIVEAWAY_DURATION = 60 * 60 * 1000; // Dur�e du giveaway en millisecondes (1 heure)

// Cache en m�moire des giveaways actifs
const activeGiveaways = new Map();

// Fonction pour d�marrer un giveaway
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

    // V�rifications de base
    if (!targetUser || amount === null) {
      return interaction.reply({ 
        content: '? Param�tres invalides. Utilisation: `/givea @utilisateur montant`', 
        ephemeral: true 
      });
    }

    if (targetUser.bot) {
      return interaction.reply({ 
        content: '? Tu ne peux pas donner de coquillages � un bot !', 
        ephemeral: true 
      });
    }

    if (amount <= 0) {
      return interaction.reply({ 
        content: '? Le montant doit �tre sup�rieur � 0 !', 
        ephemeral: true 
      });
    }

    // R�cup�rer les informations du receveur
    const receiver = ensureUser(targetUser.id);
    const receiverBalance = receiver.balance || 0;
    
    // Mise � jour du solde du receveur
    updateUser(targetUser.id, { 
      balance: receiverBalance + amount 
    });

    // Cr�er et envoyer l'embed de confirmation
    const embed = new EmbedBuilder()
      .setTitle('?? Don de coquillages (Admin)')
      .setDescription(`L'administrateur <@${interaction.user.id}> a donn� **${amount}** ${config.currency.emoji} � <@${targetUser.id}> !`)
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
        content: '? Une erreur est survenue lors du traitement de la commande.',
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
      content: '? Vous n\'avez pas la permission d\'utiliser cette commande.', 
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
      content: '? Vous n\'avez pas la permission d\'utiliser cette commande.', 
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

  try {
    await startGiveaway(channel);
    
    // Planifier le prochain giveaway
    await scheduleNextGiveaway();
    
    await interaction.reply({
      content: '? Le giveaway a �t� lanc� avec succ�s !',
      ephemeral: true
    });
  } catch (error) {
    console.error('Erreur lors du lancement du giveaway:', error);
    await interaction.reply({
      content: '? Une erreur est survenue lors du lancement du giveaway.',
      ephemeral: true
    });
  }
}

// Gestion des r�actions aux messages de giveaway
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // Ignorer les r�actions du bot
    if (user.bot) return;

    // V�rifier si c'est une r�action � un message de giveaway
    const giveaway = Array.from(activeGiveaways.values())
      .find(g => g.messageId === reaction.message.id);

    // Si pas trouv� dans le cache, v�rifier dans la base de donn�es
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

    if (!currentGiveaway || currentGiveaway.hasWinner || reaction.emoji.name !== '??') return;

    // Marquer qu'il y a un gagnant dans le cache
    currentGiveaway.hasWinner = true;
    activeGiveaways.set(currentGiveaway.channelId, currentGiveaway);

    // Mettre � jour la base de donn�es
    setGiveawayWinner(currentGiveaway.channelId, user.id);
    
    // Mettre � jour le solde de l'utilisateur
    const userData = ensureUser(user.id);
    updateUser(user.id, { balance: userData.balance + currentGiveaway.prize });
    
    // Envoyer un message de f�licitations
    const channel = reaction.message.channel;
    await channel.send(`?? F�licitations <@${user.id}> ! Tu as gagn� **${currentGiveaway.prize.toLocaleString()} ??** dans le giveaway !`);

    // Mettre � jour le message
    const embed = new EmbedBuilder()
      .setTitle('?? GIVEAWAY TERMIN� ! ??')
      .setDescription(`F�licitations <@${user.id}> ! Tu as gagn� **${currentGiveaway.prize} ??** !`)
      .setColor('#00ff00')
      .setFooter({ text: 'Giveaway termin�' });

    await reaction.message.edit({ embeds: [embed] });
    await reaction.message.reactions.removeAll();

    // Supprimer le giveaway (sera nettoy� par la fonction endGiveaway)
    removeGiveaway(currentGiveaway.channelId);
    
  } catch (error) {
    console.error('Erreur dans la gestion des réactions:', error);
  }
});

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

// Restaurer les giveaways actifs au démarrage
restoreActiveGiveaways();

// Gestion des erreurs non capturées
process.on('unhandledRejection', error => {
  console.error('Erreur non gérée dans une promesse:', error);
});

process.on('uncaughtException', error => {
  console.error('Erreur non capturée:', error);
});

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);