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
      `${createProgressBar(0, 20)}\n\n` +
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
      text: `💡 Appuie sur CASH OUT pour sécuriser tes gains !`, 
      iconURL: interaction.user.displayAvatarURL({ dynamic: true })
    })
    .setTimestamp();

  // Créer les boutons
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('cashout')
        .setLabel(`💰 CASH OUT (1.00x = ${formatNumber(potentialWin)} 🐚)`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('💰'),
      new ButtonBuilder()
        .setCustomId('next_multiplier')
        .setLabel('⏫ Tenter le multiplicateur supérieur')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎲')
    );
    
  // Ajouter un deuxième rang de boutons pour l'auto-cashout
  const autoCashoutRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('auto_2x')
        .setLabel('Auto 2x')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('auto_5x')
        .setLabel('Auto 5x')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('auto_10x')
        .setLabel('Auto 10x')
        .setStyle(ButtonStyle.Secondary)
    );

  // Envoyer le message
  const message = await interaction.reply({ 
    embeds: [embed], 
    components: [row, autoCashoutRow],
    fetchReply: true 
  });

  // Ajouter une réaction pour l'effet visuel
  try {
    await message.react('🚀');
  } catch (error) {
    console.error('Erreur lors de l\'ajout de la réaction:', error);
  }

  // Démarrer la boucle de jeu
  const gameLoop = setInterval(() => {
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

    // Vérifier si ça crash
    const currentMultiplier = MULTIPLIERS.find(m => m.multiplier >= game.currentMultiplier);
    if (currentMultiplier && shouldCrash(game.currentMultiplier)) {
      endGame(userId, message, true);
      clearInterval(gameLoop);
      return;
    }

    // Mettre à jour l'interface
    updateGameInterface(message, game);
  }, 100);
}

function updateGameInterface(message, game) {
  const potentialWin = Math.floor(game.betAmount * game.currentMultiplier);
  const winChance = calculateWinChance(game.currentMultiplier);
  
  const embed = new EmbedBuilder()
    .setTitle('🚀 Jeu du Crash')
    .setDescription(
      `**Multiplicateur actuel: ${game.currentMultiplier.toFixed(2)}x**\n` +
      `Mise: ${game.betAmount} 🐚\n` +
      `Gains potentiels: ${potentialWin} 🐚\n` +
      `Chance de gain: ${winChance.toFixed(1)}%`
    )
    .setColor(0x00ff00)
    .setFooter({ text: 'Appuie sur CASHOUT pour récupérer tes gains !' });

  // Trouver le prochain multiplicateur
  const nextMultiplier = MULTIPLIERS.find(m => m.multiplier > game.currentMultiplier)?.multiplier || 
                       (game.currentMultiplier * 1.5).toFixed(1);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cashout')
      .setLabel(`CASH OUT (${game.currentMultiplier.toFixed(2)}x)`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('next_multiplier')
      .setLabel(`Tenter ${nextMultiplier}x`)
      .setStyle(ButtonStyle.Primary)
  );

  message.edit({ embeds: [embed], components: [row] });
}

// Gestion des interactions de boutons pour le jeu Crash
async function handleCrashButton(interaction) {
  if (!interaction.isButton()) return;
  
  const userId = interaction.user.id;
  if (interaction.customId === 'cashout') {
    await handleCashout(interaction);
  } else if (interaction.customId === 'next_multiplier') {
    // Mettre à jour le message pour indiquer que le joueur tente le prochain multiplicateur
    await interaction.deferUpdate();
    
    // Trouver le jeu actif
    const game = activeGames.get(userId);
    if (!game) return;
    
    // Mettre à jour l'interface pour montrer que le joueur tente le prochain multiplicateur
    const nextMultiplier = MULTIPLIERS.find(m => m.multiplier > game.currentMultiplier)?.multiplier || 
                         (game.currentMultiplier * 1.5).toFixed(1);
    
    const embed = new EmbedBuilder()
      .setTitle('🚀 Jeu du Crash')
      .setDescription(
        `**En attente du multiplicateur ${nextMultiplier}x...**\n` +
        `Multiplicateur actuel: ${game.currentMultiplier.toFixed(2)}x\n` +
        `Mise: ${game.betAmount} 🐚\n` +
        `Gains potentiels: ${Math.floor(game.betAmount * game.currentMultiplier)} 🐚`
      )
      .setColor(0xFFA500); // Orange pour indiquer l'attente
    
    await interaction.message.edit({ 
      embeds: [embed],
      components: [] // Supprimer les boutons pendant l'attente
    });
  }
}

async function handleCashout(interaction) {
  const userId = interaction.user.id;
  const game = activeGames.get(userId);
  
  if (!game) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ Aucune partie en cours !',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ Aucune partie en cours !',
        ephemeral: true
      });
    }
    return;
  }

  // Calculer les gains
  const winAmount = calculateWinAmount(game.betAmount, game.currentMultiplier);
  
  // Mettre à jour le solde de l'utilisateur
  const user = ensureUser(userId);
  updateUser(userId, { 
    balance: user.balance + winAmount,
    total_won: (user.total_won || 0) + winAmount,
    total_wagered: (user.total_wagered || 0) + game.betAmount,
    last_win: winAmount,
    last_win_time: Date.now()
  });

  // Mettre à jour l'historique
  const gameHistory = CONFIG.history.find(g => g.userId === userId && g.status === 'playing');
  if (gameHistory) {
    gameHistory.endTime = new Date().toISOString();
    gameHistory.endMultiplier = game.currentMultiplier;
    gameHistory.winAmount = winAmount;
    gameHistory.status = 'cashed_out';
  }

  // Mettre fin à la partie
  await endGame(userId, interaction.message, false, winAmount);
  
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferUpdate();
  }
}

async function endGame(userId, message, crashed, winAmount = 0) {
  const game = activeGames.get(userId);
  if (!game) return;

  // Mettre à jour l'interface de fin de jeu
  const embed = new EmbedBuilder()
    .setTitle(crashed ? '💥 CRASH !' : '🏆 CASH OUT !')
    .setDescription(
      `Multiplicateur final: ${game.currentMultiplier.toFixed(2)}x\n` +
      `Mise: ${game.betAmount.toLocaleString()} 🐚\n` +
      (crashed 
        ? `Tu as perdu ta mise de ${game.betAmount.toLocaleString()} 🐚`
        : `Tu as gagné ${winAmount.toLocaleString()} 🐚 !`)
    )
    .addFields(
      { 
        name: 'Statistiques', 
        value: `Multiplicateur max: ${game.maxMultiplier.toFixed(2)}x\n` +
              `Durée: ${((Date.now() - game.startTime) / 1000).toFixed(1)} secondes`,
        inline: true 
      }
    )
    .setColor(crashed ? 0xff0000 : 0x00ff00);

  // Ajouter un pied de page avec le prochain multiplicateur moyen
  if (CONFIG.history.length > 0) {
    const lastGames = CONFIG.history.slice(0, 3);
    const crashedGames = lastGames.filter(g => g.status === 'crashed').length;
    embed.setFooter({ 
      text: `Derniers crashes: ${crashedGames}/${lastGames.length} (${(crashedGames / lastGames.length * 100 || 0).toFixed(0)}%)` 
    });
  }

  try {
    await message.edit({ 
      embeds: [embed], 
      components: [] 
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du message de fin:', error);
  }

  // Mettre à jour l'historique si crash
  if (crashed) {
    const gameHistory = CONFIG.history.find(g => g.userId === userId && g.status === 'playing');
    if (gameHistory) {
      gameHistory.endTime = new Date().toISOString();
      gameHistory.endMultiplier = game.currentMultiplier;
      gameHistory.status = 'crashed';
    }
  }

  // Nettoyer
  activeGames.delete(userId);
}

module.exports = {
  startCrashGame,
  handleCashout,
  handleButtonInteraction: handleCrashButton,
  activeGames
};
