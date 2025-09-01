const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ensureUser, updateUser } = require('./database');

// Configuration du jeu
const CONFIG = {
  // Multiplicateurs et probabilités
  MULTIPLIERS: [
    { multiplier: 0.5, probability: 1 },
    { multiplier: 1.5, probability: 0.9 },
    { multiplier: 2, probability: 0.6 },
    { multiplier: 3, probability: 0.4 },
    { multiplier: 5, probability: 0.25 },
    { multiplier: 10, probability: 0.1 },
    { multiplier: 20, probability: 0.05 },
    { multiplier: 50, probability: 0.02 },
    { multiplier: 100, probability: 0.01 }
  ],
  // Paramètres de mise
  MIN_BET: 10, // Mise minimale
  MAX_BET: 10000, // Mise maximale
  // Paramètres de gain
  HOUSE_EDGE: 0.01, // 1% d'avantage pour la maison
  // Historique des parties (pour le dernier crash)
  history: []
};

// Stockage des parties en cours
const activeGames = new Map();

function calculateWinChance(multiplier) {
  // Trouve le multiplicateur le plus proche dans la liste
  const target = CONFIG.MULTIPLIERS.find(m => m.multiplier >= multiplier) || 
                { multiplier: 100, probability: 0.01 };
  return target.probability * 100; // Retourne en pourcentage
}

function shouldCrash(multiplier) {
  // Ajuster la probabilité en fonction de l'avantage de la maison
  const target = CONFIG.MULTIPLIERS.find(m => m.multiplier >= multiplier) || 
                { multiplier: 100, probability: 0.01 };
  
  // Ajuster la probabilité avec l'avantage de la maison
  const adjustedProbability = target.probability * (1 - CONFIG.HOUSE_EDGE);
  return Math.random() > adjustedProbability;
}

function calculateWinAmount(betAmount, multiplier) {
  // Calculer le gain brut
  const grossWin = Math.floor(betAmount * multiplier);
  // Appliquer l'avantage de la maison
  return Math.floor(grossWin * (1 - CONFIG.HOUSE_EDGE));
}

async function createProgressBar(progress, width = 20) {
  const filled = Math.min(Math.round(progress * width), width);
  const filledEmoji = '█';
  const emptyEmoji = '░';
  const progressEmoji = ['▏','▎','▍','▌','▋','▊','▉'];
  
  const fullBars = Math.floor(progress * width);
  const partial = Math.floor((progress * width - fullBars) * progressEmoji.length);
  
  let bar = filledEmoji.repeat(fullBars);
  if (fullBars < width) {
    bar += partial > 0 ? progressEmoji[partial - 1] : '';
    bar += emptyEmoji.repeat(width - fullBars - 1);
  }
  
  return bar;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString('fr-FR');
}

function getMultiplierColor(multiplier) {
  if (multiplier < 1) return '#FF0000'; // Rouge pour les pertes
  if (multiplier < 2) return '#FFA500'; // Orange
  if (multiplier < 5) return '#FFFF00'; // Jaune
  if (multiplier < 10) return '#00FF00'; // Vert clair
  if (multiplier < 20) return '#00FFFF'; // Cyan
  if (multiplier < 50) return '#0000FF'; // Bleu
  return '#FF00FF'; // Magenta pour les très gros multiplicateurs
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes > 0 ? `${minutes}m ` : ''}${remainingSeconds}s`;
}

async function startCrashGame(interaction) {
  const userId = interaction.user.id;
  let betAmount = interaction.options.getInteger('mise');
  
  // Vérifier si l'utilisateur a déjà une partie en cours
  if (activeGames.has(userId)) {
    await interaction.reply({
      content: '❌ Vous avez déjà une partie en cours !',
      ephemeral: true
    });
    return;
  }

  // Vérifier la mise
  const user = ensureUser(userId);
  
  if (betAmount < CONFIG.MIN_BET) {
    await interaction.reply({
      content: `❌ La mise minimale est de ${CONFIG.MIN_BET} 🐚`,
      ephemeral: true
    });
    return;
  }
  
  if (betAmount > CONFIG.MAX_BET) {
    await interaction.reply({
      content: `❌ La mise maximale est de ${CONFIG.MAX_BET} 🐚`,
      ephemeral: true
    });
    return;
  }
  
  if (user.balance < betAmount) {
    await interaction.reply({
      content: `❌ Vous n'avez pas assez de coquillages ! Solde: ${user.balance} 🐚`,
      ephemeral: true
    });
    return;
  }

  // Retirer la mise du solde
  updateUser(userId, { 
    balance: user.balance - betAmount,
    last_bet: betAmount,
    last_bet_time: Date.now()
  });

  // Créer la partie
  const game = {
    userId,
    username: interaction.user.username,
    betAmount,
    currentMultiplier: 1.0,
    isCrashed: false,
    startTime: Date.now(),
    lastUpdate: Date.now(),
    autoCashout: null,
    maxMultiplier: 1.0
  };
  
  // Ajouter à l'historique
  CONFIG.history.unshift({
    userId,
    username: interaction.user.username,
    betAmount,
    startTime: new Date().toISOString(),
    status: 'playing'
  });
  
  // Garder uniquement les 10 dernières parties
  if (CONFIG.history.length > 10) {
    CONFIG.history.pop();
  }

  activeGames.set(userId, game);

  // Calculer les gains potentiels
  const potentialWin = calculateWinAmount(betAmount, 1.0);
  
  // Créer l'embed
  const embed = new EmbedBuilder()
    .setTitle('🚀 **JEU DU CRASH**')
    .setDescription(
      `\n` +
      `${await createProgressBar(0, 20)}\n\n` +
      `**Multiplicateur actuel:** \`1.00x\`\n` +
      `**Mise:** \`${formatNumber(betAmount)} 🐚\`\n` +
      `**Gains potentiels:** \`${formatNumber(potentialWin)} 🐚\`\n` +
      `**Chance de gain:** \`${calculateWinChance(1.0).toFixed(1)}%\``
    )
    .setColor(0x2b2d31)
    .setThumbnail('https://i.imgur.com/8Km9tLL.png')
    .addFields(
      {
        name: '📊 Statistiques',
        value: `• Mise min: \`${formatNumber(CONFIG.MIN_BET)} 🐚\`\n` +
              `• Mise max: \`${formatNumber(CONFIG.MAX_BET)} 🐚\`\n` +
              `• Avantage: \`${(CONFIG.HOUSE_EDGE * 100)}%\``,
        inline: true
      },
      {
        name: '🏆 Derniers gains',
        value: CONFIG.history
          .filter(g => g.status === 'cashed_out')
          .slice(0, 3)
          .map(g => `\`${g.username}\`: ${g.endMultiplier?.toFixed(2)}x`)
          .join('\n') || 'Aucun gain récent',
        inline: true
      }
    )
    .setFooter({ 
      text: `💡 Utilise /cashout pour sécuriser tes gains !`, 
      iconURL: interaction.user.displayAvatarURL({ dynamic: true })
    })
    .setTimestamp();

  // Envoyer le message
  const message = await interaction.reply({ 
    embeds: [embed], 
    fetchReply: true 
  });

  // Ajouter une réaction pour l'effet visuel
  try {
    await message.react('🚀');
  } catch (error) {
    console.error('Erreur lors de l\'ajout de la réaction:', error);
  }

  // Démarrer la boucle de jeu
  const gameLoop = setInterval(async () => {
    try {
      if (!activeGames.has(userId)) {
        clearInterval(gameLoop);
        return;
      }

      const game = activeGames.get(userId);
      const now = Date.now();
      const timeElapsed = (now - game.lastUpdate) / 1000; // en secondes
      
      // Mettre à jour le multiplicateur
      game.currentMultiplier += 0.1 * timeElapsed;
      game.currentMultiplier = parseFloat(game.currentMultiplier.toFixed(2));
      game.lastUpdate = now;

      // Vérifier si le joueur a atteint son multiplicateur cible
      if (game.isAutoCashout && game.targetMultiplier && game.currentMultiplier >= game.targetMultiplier) {
        await handleCashout({ user: { id: userId }, deferUpdate: () => Promise.resolve(), message });
        clearInterval(gameLoop);
        return;
      }

      // Vérifier si ça crash
      const currentMultiplier = CONFIG.MULTIPLIERS.find(m => m.multiplier >= game.currentMultiplier);
      if (currentMultiplier && shouldCrash(game.currentMultiplier)) {
        await endGame(userId, message, true);
        clearInterval(gameLoop);
        return;
      }

      // Mettre à jour l'interface
      await updateGameInterface(message, game);
    } catch (error) {
      console.error('Erreur dans la boucle de jeu:', error);
      clearInterval(gameLoop);
      // Essayer de sauvegarder les gains en cas d'erreur
      const game = activeGames.get(userId);
      if (game) {
        await endGame(userId, message, false, Math.floor(game.betAmount * game.currentMultiplier));
      }
    }
  }, 100);
}

async function updateGameInterface(message, game) {
  try {
    const progress = Math.min(game.currentMultiplier / 100, 1);
    const progressBar = await createProgressBar(progress);
    const winAmount = calculateWinAmount(game.betAmount, game.currentMultiplier);
    
    const embed = new EmbedBuilder()
      .setTitle('🚀 **JEU DU CRASH**')
      .setDescription(
        `\n` +
        `${progressBar}\n\n` +
        `**Multiplicateur actuel:** \`${game.currentMultiplier.toFixed(2)}x\`\n` +
        `**Mise:** \`${formatNumber(game.betAmount)} 🐚\`\n` +
        `**Gains potentiels:** \`${formatNumber(winAmount)} 🐚\`\n` +
        `**Chance de gain:** \`${calculateWinChance(game.currentMultiplier).toFixed(1)}%\``
      )
      .setColor(getMultiplierColor(game.currentMultiplier))
      .setThumbnail('https://i.imgur.com/8Km9tLL.png')
      .addFields(
        {
          name: '📊 Statistiques',
          value: `• Mise min: \`${formatNumber(CONFIG.MIN_BET)} 🐚\`\n` +
                `• Mise max: \`${formatNumber(CONFIG.MAX_BET)} 🐚\`\n` +
                `• Avantage: \`${(CONFIG.HOUSE_EDGE * 100)}%\``,
          inline: true
        },
        {
          name: '🏆 Derniers gains',
          value: CONFIG.history
            .filter(g => g.status === 'cashed_out')
            .slice(0, 3)
            .map(g => `\`${g.username}\`: ${g.endMultiplier?.toFixed(2)}x`)
            .join('\n') || 'Aucun gain récent',
          inline: true
        }
      )
      .setFooter({ text: `Utilise /cashout pour récupérer tes gains ou /next pour tenter d'aller plus loin !` });

    if (message) {
      await message.edit({ embeds: [embed] });
    } else {
      return { embed };
    }
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'interface:', error);
  }
}

async function handleNextMultiplier(interaction) {
  try {
    const userId = interaction.user.id;
    const game = activeGames.get(userId);

    if (!game) {
      await interaction.reply({
        content: '❌ Vous n\'avez pas de partie en cours !',
        ephemeral: true
      });
      return;
    }

    if (game.isCrashed) {
      await interaction.reply({
        content: '❌ La partie est déjà terminée !',
        ephemeral: true
      });
      return;
    }

    // Trouver le prochain multiplicateur dans la liste
    const nextMultiplier = CONFIG.MULTIPLIERS
      .sort((a, b) => a.multiplier - b.multiplier)
      .find(m => m.multiplier > game.currentMultiplier);

    if (!nextMultiplier) {
      await interaction.reply({
        content: '❌ Vous avez atteint le multiplicateur maximum !',
        ephemeral: true
      });
      return;
    }

    // Vérifier si le jeu doit s'arrêter
    if (shouldCrash(nextMultiplier.multiplier)) {
      // Le jeu s'arrête, l'utilisateur perd sa mise
      await endGame(userId, game.message, true);
      await interaction.reply({
        content: `❌ Le crash est arrivé à ${nextMultiplier.multiplier.toFixed(2)}x ! Tu as perdu ta mise de ${game.betAmount} 🐚`,
        ephemeral: true
      });
      return;
    }

    // Mettre à jour le multiplicateur actuel
    game.currentMultiplier = nextMultiplier.multiplier;
    game.maxMultiplier = Math.max(game.maxMultiplier, game.currentMultiplier);
    
    // Mettre à jour l'interface
    await updateGameInterface(game.message, game);
    
    await interaction.reply({
      content: `✅ Tu as atteint le multiplicateur ${game.currentMultiplier.toFixed(2)}x !`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Erreur lors du passage au multiplicateur suivant:', error);
    await interaction.reply({
      content: '❌ Une erreur est survenue lors du passage au multiplicateur suivant.',
      ephemeral: true
    });
  }
}

async function handleCashout(interaction) {
  try {
    const userId = interaction.user.id;
    const game = activeGames.get(userId);

    if (!game) {
      await interaction.reply({
        content: '❌ Vous n\'avez pas de partie en cours !',
        ephemeral: true
      });
      return;
    }

    if (game.isCrashed) {
      await interaction.reply({
        content: '❌ La partie est déjà terminée !',
        ephemeral: true
      });
      return;
    }

    const winAmount = calculateWinAmount(game.betAmount, game.currentMultiplier);
    
    // Mettre à jour le solde de l'utilisateur
    const user = ensureUser(userId);
    updateUser(userId, { balance: user.balance + winAmount });
    
    // Marquer la partie comme terminée
    game.isCrashed = true;
    activeGames.delete(userId);
    
    // Mettre à jour l'historique
    const gameHistory = CONFIG.history.find(g => g.userId === userId && g.status === 'playing');
    if (gameHistory) {
      gameHistory.status = 'cashed_out';
      gameHistory.endMultiplier = game.currentMultiplier;
      gameHistory.winAmount = winAmount;
      gameHistory.endTime = new Date().toISOString();
    }
    
    // Mettre à jour l'interface
    const embed = new EmbedBuilder()
      .setTitle('💰 **CASHOUT RÉUSSI !**')
      .setDescription(
        `Félicitations <@${userId}> ! Tu as récupéré tes gains à **${game.currentMultiplier.toFixed(2)}x** !\n` +
        `**Mise :** \`${formatNumber(game.betAmount)} 🐚\`\n` +
        `**Gains :** \`+${formatNumber(winAmount)} 🐚\`\n` +
        `**Nouveau solde :** \`${formatNumber(user.balance + winAmount)} 🐚\``
      )
      .setColor(0x00ff00)
      .setThumbnail('https://i.imgur.com/8Km9tLL.png');
    
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur lors du cashout:', error);
    await interaction.reply({
      content: '❌ Une erreur est survenue lors du cashout. Tes coquillages sont en sécurité !',
      ephemeral: true
    });
  }
}

async function endGame(userId, message, crashed, winAmount = 0) {
  try {
    const game = activeGames.get(userId);
    if (!game) return;

    // Calculer les valeurs finales
    const finalMultiplier = game.currentMultiplier;
    const duration = (Date.now() - game.startTime) / 1000;
    const isAutoCashout = game.isAutoCashout && !crashed;

    // Créer l'embed de fin de partie
    const embed = new EmbedBuilder()
      .setTitle(crashed ? '💥 CRASH !' : isAutoCashout ? '🎯 CASHOUT AUTOMATIQUE !' : '🏆 CASH OUT !')
      .setDescription(
        `Multiplicateur final: **${finalMultiplier.toFixed(2)}x**\n` +
        `Mise: **${game.betAmount.toLocaleString()}** 🐚\n` +
        (crashed 
          ? `❌ Tu as perdu ta mise de **${game.betAmount.toLocaleString()}** 🐚`
          : `✅ Tu as gagné **${winAmount.toLocaleString()}** 🐚 !`)
      )
      .addFields(
        { 
          name: 'Statistiques', 
          value: `Multiplicateur max: **${game.maxMultiplier.toFixed(2)}x**\n` +
                `Durée: **${duration.toFixed(1)} secondes**`,
          inline: true 
        }
      )
      .setColor(crashed ? 0xff0000 : 0x00ff00);

    // Ajouter des statistiques supplémentaires
    if (CONFIG.history && CONFIG.history.length > 0) {
      const lastGames = CONFIG.history.slice(0, 5);
      const crashedGames = lastGames.filter(g => g.status === 'crashed').length;
      const crashRate = lastGames.length > 0 ? (crashedGames / lastGames.length) * 100 : 0;
      
      embed.addFields({
        name: 'Statistiques récentes',
        value: `Crash rate: **${crashRate.toFixed(0)}%** (${crashedGames}/${lastGames.length})`,
        inline: true
      });
    }

    // Mettre à jour le message
    if (message && message.edit) {
      await message.edit({ 
        embeds: [embed], 
        components: [] 
      });
    }

    // Mettre à jour l'historique du jeu
    const gameHistory = CONFIG.history.find(g => g.userId === userId && g.status === 'playing');
    if (gameHistory) {
      gameHistory.endTime = new Date().toISOString();
      gameHistory.endMultiplier = game.currentMultiplier;
      gameHistory.winAmount = crashed ? -game.betAmount : winAmount - game.betAmount;
      gameHistory.status = crashed ? 'crashed' : 'cashed_out';
    }

    // Mettre fin à la partie
    activeGames.delete(userId);
  } catch (error) {
    console.error('Erreur dans endGame:', error);
    // S'assurer que la partie est bien nettoyée même en cas d'erreur
    activeGames.delete(userId);
  }
}

module.exports = {
  startCrashGame,
  handleCashout,
  handleNextMultiplier,
  activeGames,
  CONFIG
};
