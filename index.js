require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const express = require('express');
const { isMaintenanceMode, isAdmin } = require('./maintenance');

// Configuration
const config = require('./config');
const dailyContestConfig = require('./config/dailyContest');

// Base de données
const { 
  ensureUser, 
  updateUser, 
  db,
  saveDailyContest,
  getActiveDailyContest,
  setDailyContestWinner,
  getDailyContestById,
  getAllActiveDailyContests,
  removeDailyContest
} = require('./database');

// Utilitaires
const { random, now, getXpMultiplier, scheduleMidnightReset, calculateLevel, getLevelInfo } = require('./utils');

// Commandes
const commands = require('./commands');

// Jeux
const { 
  handleBlackjackStart,
  resolveBlackjack,
  handleRouletteStart,
  handleRouletteChoice,
  handleSlots,
  handleCoinflipSolo,
  handleCoinflipMulti,
  handleTicTacToe,
  handleTicTacToeMove,
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

// Initialisation du client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Gestion des messages pour l'XP
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  
  // Vérifier si le salon est dans la liste des exclus
  if (config.xp.excludedChannels.includes(message.channelId)) {
    return;
  }
  
  const user = ensureUser(message.author.id);
  const currentTime = now();
  const timeSinceLastXp = currentTime - (user.last_xp_gain || 0);
  
  // Vérifier le cooldown XP
  if (timeSinceLastXp < config.xp.cooldown) {
    return;
  }
  
  // Calculer le gain d'XP avec multiplicateur VIP
  let xpGain = random(config.xp.minPerMessage, config.xp.maxPerMessage);
  const multiplier = getXpMultiplier(message.member);
  xpGain = Math.floor(xpGain * multiplier);
  
  const newXp = (user.xp || 0) + xpGain;
  const newLevel = calculateLevel(newXp);
  const levelUp = newLevel > (user.level || 1);
  
  // Mettre à jour les messages quotidiens et missions
  const newDailyMessages = (user.daily_messages || 0) + 1;
  
  const updateData = {
    xp: newXp,
    level: newLevel,
    last_xp_gain: currentTime,
    daily_messages: newDailyMessages,
    balance: (user.balance || 0) + (levelUp ? 100 : 0)
  };
  
  updateUser(message.author.id, updateData);
  
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
    // Vérifier le mode maintenance
    if (isMaintenanceMode() && interaction.user.id !== '314458846754111499') {
      return interaction.reply({ 
        content: '⚠️ Le bot est actuellement en maintenance. Veuillez réessayer plus tard.',
        ephemeral: true
      });
    }

    // Gestion des commandes slash
    if (interaction.isCommand()) {
      if (interaction.commandName === 'concours-quotidien') {
        await handleDailyContest(interaction);
      } else {
        // Gérer les autres commandes
        // ...
      }
    } 
    // Gestion des boutons
    else if (interaction.isButton()) {
      // Gestion des boutons des jeux
      // ...
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

// Gestion des réactions aux messages de concours
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // Ignorer les réactions du bot
    if (user.bot) return;

    // Vérifier si c'est une réaction à un message de concours quotidien
    const contest = getActiveDailyContest();
    if (contest && contest.message_id === reaction.message.id && reaction.emoji.name === '🦦') {
      // Vérifier si le concours a déjà un gagnant
      if (contest.has_winner) return;

      // Récupérer le message et le canal
      const message = reaction.message;
      const channel = message.channel;

      // Marquer qu'il y a un gagnant
      setDailyContestWinner(contest.id, user.id);

      // Mettre à jour le solde de l'utilisateur
      const userData = ensureUser(user.id);
      updateUser(user.id, { balance: userData.balance + contest.prize });

      // Envoyer un message de félicitations
      await channel.send(dailyContestConfig.MESSAGES.CONTEST_ENDED(user.id, contest.prize));

      // Mettre à jour le message du concours
      const embed = new EmbedBuilder()
        .setTitle(dailyContestConfig.MESSAGES.CONTEST_ENDED_TITLE)
        .setDescription(`Félicitations <@${user.id}> ! Tu as gagné **${contest.prize.toLocaleString()} 🐚** !\n\nReviens demain pour une nouvelle chance de gagner !`)
        .setColor(dailyContestConfig.EMBED_COLORS.WINNER);

      await message.edit({ embeds: [embed] });
      await message.reactions.removeAll();

      // Marquer le concours comme terminé
      db.prepare('UPDATE daily_contests SET is_active = 0 WHERE id = ?').run(contest.id);
    }
  } catch (error) {
    console.error('Erreur dans la gestion des réactions:', error);
  }
});

// Gestion de la commande concours-quotidien
async function handleDailyContest(interaction) {
  try {
    // Vérifier les permissions admin
    if (!isAdmin(interaction.user.id)) {
      return interaction.reply({ 
        content: dailyContestConfig.ERRORS.NO_PERMISSION, 
        ephemeral: true 
      });
    }

    const duration = interaction.options.getInteger('duree') || dailyContestConfig.DEFAULT_DURATION;
    const prize = interaction.options.getInteger('gain');
    
    // Vérifier si un concours est déjà en cours
    const activeContest = getActiveDailyContest();
    if (activeContest) {
      return interaction.reply({
        content: dailyContestConfig.ERRORS.ALREADY_ACTIVE,
        ephemeral: true
      });
    }
    
    // Vérifier la durée
    if (duration < 1 || duration > dailyContestConfig.MAX_DURATION) {
      return interaction.reply({
        content: dailyContestConfig.ERRORS.INVALID_DURATION(1, dailyContestConfig.MAX_DURATION),
        ephemeral: true
      });
    }
    
    // Vérifier le gain
    if (prize < dailyContestConfig.MIN_PRIZE) {
      return interaction.reply({
        content: dailyContestConfig.ERRORS.INVALID_PRIZE(dailyContestConfig.MIN_PRIZE),
        ephemeral: true
      });
    }
    
    const startTime = Date.now();
    const endTime = startTime + (duration * 60 * 60 * 1000);
    
    // Créer l'embed du concours
    const embed = new EmbedBuilder()
      .setTitle(dailyContestConfig.MESSAGES.CONTEST_ACTIVE_TITLE)
      .setDescription(dailyContestConfig.MESSAGES.CONTEST_DESCRIPTION(prize, duration))
      .setColor(dailyContestConfig.EMBED_COLORS.ACTIVE)
      .setFooter({ text: 'Un seul gagnant sera désigné !' });

    // Envoyer le message du concours
    const message = await interaction.channel.send({ embeds: [embed] });
    await message.react('🦦');

    // Sauvegarder le concours dans la base de données
    const contestId = saveDailyContest(interaction.channelId, message.id, prize, startTime, endTime);
    
    // Planifier la fin du concours
    const timeLeft = endTime - startTime;
    if (timeLeft > 0) {
      setTimeout(() => endDailyContest(contestId, interaction.channel), timeLeft);
    }

    await interaction.reply({
      content: dailyContestConfig.MESSAGES.CONTEST_STARTED(prize, endTime),
      ephemeral: true
    });

  } catch (error) {
    console.error('Erreur lors du lancement du concours quotidien:', error);
    await interaction.reply({
      content: '❌ Une erreur est survenue lors du lancement du concours.',
      ephemeral: true
    });
  }
}

// Fonction pour terminer un concours quotidien
async function endDailyContest(contestId, channel) {
  try {
    // Récupérer les informations du concours
    const contest = getDailyContestById(contestId);
    if (!contest || contest.has_winner) return;

    // Marquer le concours comme terminé
    db.prepare('UPDATE daily_contests SET is_active = 0 WHERE id = ?').run(contestId);

    // Essayer de récupérer le message
    let message;
    try {
      message = await channel.messages.fetch(contest.message_id);
    } catch (error) {
      console.error('Erreur lors de la récupération du message du concours:', error);
      return;
    }

    // Mettre à jour le message pour indiquer qu'aucun gagnant n'a été trouvé
    const embed = new EmbedBuilder()
      .setTitle(dailyContestConfig.MESSAGES.CONTEST_ENDED_TITLE)
      .setDescription(dailyContestConfig.MESSAGES.NO_WINNERS)
      .setColor(dailyContestConfig.EMBED_COLORS.ENDED);

    await message.edit({ embeds: [embed] });
    await message.reactions.removeAll();

  } catch (error) {
    console.error('Erreur lors de la fin du concours quotidien:', error);
  }
}

// Fonction pour restaurer les concours quotidiens actifs au démarrage
async function restoreActiveDailyContests() {
  try {
    const activeContestsList = getAllActiveDailyContests();
    console.log(`[Concours] Restauration de ${activeContestsList.length} concours quotidiens actifs...`);
    
    for (const contest of activeContestsList) {
      try {
        const channel = await client.channels.fetch(contest.channel_id);
        if (!channel) {
          console.log(`[Concours] Salon ${contest.channel_id} introuvable, suppression du concours`);
          removeDailyContest(contest.id);
          continue;
        }
        
        // Vérifier si le message existe toujours
        let message;
        try {
          message = await channel.messages.fetch(contest.message_id);
        } catch (error) {
          console.log(`[Concours] Message ${contest.message_id} introuvable, création d'un nouveau message`);
          
          // Si le message a été supprimé, en créer un nouveau
          const timeLeftHours = Math.ceil((contest.end_time - Date.now()) / 1000 / 60 / 60);
          const embed = new EmbedBuilder()
            .setTitle(dailyContestConfig.MESSAGES.CONTEST_ACTIVE_TITLE)
            .setDescription(dailyContestConfig.MESSAGES.CONTEST_DESCRIPTION(contest.prize, timeLeftHours))
            .setColor(dailyContestConfig.EMBED_COLORS.ACTIVE)
            .setFooter({ text: 'Un seul gagnant sera désigné !' });
          
          message = await channel.send({ embeds: [embed] });
          await message.react('🦦');
          
          // Mettre à jour l'ID du message dans la base de données
          saveDailyContest(channel.id, message.id, contest.prize, contest.start_time, contest.end_time);
        }
        
        // Planifier la fin du concours
        const timeLeft = contest.end_time - Date.now();
        if (timeLeft > 0) {
          console.log(`[Concours] Concours restauré dans #${channel.name}, se termine dans ${Math.ceil(timeLeft / 1000 / 60)} minutes`);
          setTimeout(() => endDailyContest(contest.id, channel), timeLeft);
        } else {
          // Le concours est déjà terminé, le nettoyer
          console.log(`[Concours] Concours expiré dans #${channel.name}, nettoyage...`);
          removeDailyContest(contest.id);
        }
        
      } catch (error) {
        console.error(`[Concours] Erreur lors de la restauration du concours:`, error);
      }
    }
    
  } catch (error) {
    console.error('[Concours] Erreur lors de la restauration des concours:', error);
  }
}

// Événement ready
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} est connecté !`);
  
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
    
    console.log('✅ Commandes enregistrées avec succès !');
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
  }
  
  // Restaurer les concours quotidiens actifs
  await restoreActiveDailyContests();
  
  // Planifier le reset quotidien
  scheduleMidnightReset();
});

// Démarrer le bot
client.login(process.env.DISCORD_TOKEN);
