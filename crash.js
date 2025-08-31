const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ensureUser, updateUser } = require('./database');

// Configuration des multiplicateurs et probabilités
const MULTIPLIERS = [
  { multiplier: 1.5, probability: 0.9 },
  { multiplier: 2, probability: 0.6 },
  { multiplier: 3, probability: 0.4 },
  { multiplier: 5, probability: 0.25 },
  { multiplier: 10, probability: 0.1 },
  { multiplier: 20, probability: 0.05 },
  { multiplier: 50, probability: 0.02 },
  { multiplier: 100, probability: 0.01 }
];

// Stockage des parties en cours
const activeGames = new Map();

function calculateWinChance(multiplier) {
  // Trouve le multiplicateur le plus proche dans la liste
  const target = MULTIPLIERS.find(m => m.multiplier >= multiplier) || 
                { multiplier: 100, probability: 0.01 };
  return target.probability * 100; // Retourne en pourcentage
}

function shouldCrash(multiplier) {
  const target = MULTIPLIERS.find(m => m.multiplier >= multiplier) || 
                { multiplier: 100, probability: 0.01 };
  return Math.random() > target.probability;
}

async function startCrashGame(interaction) {
  const userId = interaction.user.id;
  const betAmount = interaction.options.getInteger('mise');
  
  // Vérifier si l'utilisateur a déjà une partie en cours
  if (activeGames.has(userId)) {
    await interaction.reply({
      content: '❌ Vous avez déjà une partie en cours !',
      ephemeral: true
    });
    return;
  }

  // Vérifier le solde
  const user = ensureUser(userId);
  if (user.balance < betAmount) {
    await interaction.reply({
      content: `❌ Vous n'avez pas assez de coquillages ! Solde: ${user.balance} 🐚`,
      ephemeral: true
    });
    return;
  }

  // Retirer la mise du solde
  updateUser(userId, { balance: user.balance - betAmount });

  // Créer la partie
  const game = {
    userId,
    betAmount,
    currentMultiplier: 1.0,
    isCrashed: false,
    startTime: Date.now(),
    lastUpdate: Date.now()
  };

  activeGames.set(userId, game);

  // Créer l'embed
  const embed = new EmbedBuilder()
    .setTitle('🚀 Jeu du Crash')
    .setDescription(`**Multiplicateur actuel: 1.00x**\n` +
                   `Mise: ${betAmount} 🐚\n` +
                   `Gains potentiels: ${Math.floor(betAmount * 1.0)} 🐚`)
    .setColor(0x00ff00)
    .setFooter({ text: 'Appuie sur CASHOUT pour récupérer tes gains !' });

  // Créer les boutons
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('cashout')
        .setLabel('CASH OUT (1.00x)')
        .setStyle(ButtonStyle.Success)
    );

  // Envoyer le message
  const message = await interaction.reply({ 
    embeds: [embed], 
    components: [row],
    fetchReply: true 
  });

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

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cashout')
      .setLabel(`CASH OUT (${game.currentMultiplier.toFixed(2)}x)`)
      .setStyle(ButtonStyle.Success)
  );

  message.edit({ embeds: [embed], components: [row] });
}

async function handleCashout(interaction) {
  const userId = interaction.user.id;
  const game = activeGames.get(userId);
  
  if (!game) {
    await interaction.reply({
      content: '❌ Aucune partie en cours !',
      ephemeral: true
    });
    return;
  }

  await endGame(userId, interaction.message, false);
  await interaction.deferUpdate();
}

async function endGame(userId, message, crashed) {
  const game = activeGames.get(userId);
  if (!game) return;

  const winAmount = crashed ? 0 : Math.floor(game.betAmount * game.currentMultiplier);
  const user = ensureUser(userId);
  
  if (winAmount > 0) {
    updateUser(userId, { balance: user.balance + winAmount });
  }

  // Mettre à jour l'interface de fin de jeu
  const embed = new EmbedBuilder()
    .setTitle(crashed ? '💥 CRASH !' : '🏆 CASH OUT !')
    .setDescription(
      crashed 
        ? `Le multiplicateur s'est écrasé à ${game.currentMultiplier.toFixed(2)}x\n` +
          `Tu as perdu ta mise de ${game.betAmount} 🐚`
        : `Tu as récupéré ${winAmount} 🐚 !\n` +
          `Multiplicateur: ${game.currentMultiplier.toFixed(2)}x`
    )
    .setColor(crashed ? 0xff0000 : 0x00ff00);

  await message.edit({ 
    embeds: [embed], 
    components: [] 
  });

  // Nettoyer
  activeGames.delete(userId);
}

module.exports = {
  startCrashGame,
  handleCashout,
  activeGames
};
