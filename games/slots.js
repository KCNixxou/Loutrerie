const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

// Variables pour stocker les parties en cours
const activeSlotsGames = new Map();

// Constantes du jeu
const SYMBOLS = ['🦦', '🐳', '🪼', '🐚', '🪸', '🏝️'];
const PAYOUTS = {
  '🦦🦦🦦': 3,
  '🐳🐳🐳': 3,
  '🪼🪼🪼': 3,
  '🐚🐚🐚': 3,
  '🪸🪸🪸': 3,
  '🏝️🏝️🏝️': 3,
  '🦦🦦': 2.1,
  '🐳🐳': 2.1,
  '🪼🪼': 2.1,
  '🐚🐚': 2.1,
  '🪸🪸': 2.1,
  '🏝️🏝️': 2.1
};

// Fonction pour démarrer une nouvelle partie de machine à sous
async function handleSlots(interaction) {
  const bet = interaction.options.getInteger('mise');
  const userId = interaction.user.id;
  const user = ensureUser(userId);

  if (bet > user.balance) {
    return interaction.reply({ 
      content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour cette mise !`, 
      ephemeral: true 
    });
  }

  if (bet > config.casino.maxBet) {
    return interaction.reply({ 
      content: `❌ La mise maximale est de ${config.casino.maxBet} ${config.currency.emoji} !`, 
      ephemeral: true 
    });
  }

  if (bet < config.casino.minBet) {
    return interaction.reply({ 
      content: `❌ La mise minimale est de ${config.casino.minBet} ${config.currency.emoji} !`, 
      ephemeral: true 
    });
  }

  // Créer une nouvelle partie
  const gameId = Date.now().toString();
  
  const gameState = {
    userId,
    bet,
    result: null,
    winnings: 0,
    lastAction: Date.now()
  };

  // Mettre à jour le solde de l'utilisateur
  updateUser(userId, { balance: user.balance - bet });
  
  // Jouer la partie
  const result = spinSlots();
  gameState.result = result;
  
  // Calculer les gains
  const winAmount = calculateWinnings(result, bet);
  gameState.winnings = winAmount;
  
  // Mettre à jour le solde si le joueur a gagné
  if (winAmount > 0) {
    updateUser(userId, { balance: user.balance - bet + winAmount });
  }
  
  // Créer l'embed
  const embed = createSlotsEmbed(gameState, interaction.user);
  
  // Envoyer le message
  await interaction.reply({
    embeds: [embed]
  });
  
  // Stocker la partie pour le nettoyage
  activeSlotsGames.set(gameId, gameState);
  
  // Supprimer la partie après un délai
  setTimeout(() => {
    activeSlotsGames.delete(gameId);
  }, 30000); // 30 secondes
}

// Fonction pour faire tourner les rouleaux
function spinSlots() {
  const result = [];
  for (let i = 0; i < 3; i++) {
    const randomIndex = Math.floor(Math.random() * SYMBOLS.length);
    result.push(SYMBOLS[randomIndex]);
  }
  return result;
}

// Fonction pour calculer les gains
function calculateWinnings(result, bet) {
  const resultStr = result.join('');
  
  // Vérifier les combinaisons gagnantes
  for (const [pattern, multiplier] of Object.entries(PAYOUTS)) {
    if (pattern.length === 3 && resultStr === pattern) {
      return bet * multiplier;
    }
    if (pattern.length === 2 && resultStr.includes(pattern)) {
      return bet * multiplier;
    }
    if (pattern.length === 1 && resultStr.includes(pattern)) {
      return bet * multiplier;
    }
  }
  
  return 0; // Aucun gain
}

// Fonction pour créer l'embed de la machine à sous
function createSlotsEmbed(gameState, user) {
  const { bet, result, winnings } = gameState;
  
  const embed = new EmbedBuilder()
    .setTitle('🎰 MACHINE À SOUS')
    .setColor(0x0099FF);
    
  const isWin = winnings > 0;
  
  // Créer l'affichage des rouleaux
  const display = `[ ${result.join(' | ')} ]`;
  
  embed.setDescription(
    `${display}\n\n` +
    `**Mise :** ${bet} ${config.currency.emoji}\n` +
    (isWin 
      ? `🎉 **Vous avez gagné ${winnings} ${config.currency.emoji} !**`
      : `😢 **Vous avez perdu ${bet} ${config.currency.emoji}...**`)
  );
  
  // Ajouter une image en fonction du résultat
  if (isWin) {
    if (result.every(symbol => symbol === '7️⃣')) {
      embed.setThumbnail('https://i.imgur.com/xyz1234.png'); // Remplacez par une image de jackpot
    } else if (result.every(symbol => symbol === '💎')) {
      embed.setThumbnail('https://i.imgur.com/abc5678.png'); // Remplacez par une image de gros gain
    }
    embed.setColor(0x00FF00); // Vert pour les gains
  } else {
    embed.setColor(0xFF0000); // Rouge pour les pertes
  }
  
  return embed;
}

// Nettoyer les anciennes parties inactives (appelé périodiquement)
function cleanupOldSlotsGames() {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes d'inactivité
  
  for (const [gameId, game] of activeSlotsGames.entries()) {
    if (now - game.lastAction > timeout) {
      activeSlotsGames.delete(gameId);
    }
  }
}

// Nettoyer les anciennes parties toutes les 5 minutes
setInterval(cleanupOldSlotsGames, 5 * 60 * 1000);

module.exports = {
  handleSlots
};
