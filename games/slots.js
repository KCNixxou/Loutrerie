const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ensureUser, updateUser } = require('../database');
const { getGameConfig } = require('../game-utils');

// Variables pour stocker les parties en cours
const activeSlotsGames = new Map();

// Constantes du jeu
const SYMBOLS = ['🦦', '🐳', '🪼', '🐚', '🪸', '🏝️'];
const PAYOUTS = {
  '🦦🦦🦦': 3.5,
  '🐳🐳🐳': 3.5,
  '🪼🪼🪼': 3.5,
  '🐚🐚🐚': 3.5,
  '🪸🪸🪸': 3.5,
  '🏝️🏝️🏝️': 3.5,
  '🦦🦦': 2.3,
  '🐳🐳': 2.3,
  '🪼🪼': 2.3,
  '🐚🐚': 2.3,
  '🪸🪸': 2.3,
  '🏝️🏝️': 2.3
};

// Fonction pour démarrer une nouvelle partie de machine à sous
async function handleSlots(interaction) {
  const bet = interaction.options.getInteger('mise');
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id || null;
  const user = ensureUser(userId, guildId);
  const config = getGameConfig(interaction);

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
    guildId,
    bet,
    result: null,
    winnings: 0,
    lastAction: Date.now()
  };

  // Mettre à jour le solde de l'utilisateur
  updateUser(userId, guildId, { balance: user.balance - bet });
  
  // Jouer la partie
  const result = spinSlots();
  gameState.result = result;
  
  // Calculer les gains
  const winnings = calculateWinnings(result, bet, config);
  const newBalance = user.balance - bet + winnings;
  
  // Mettre à jour le solde de l'utilisateur avec les gains
  updateUser(userId, guildId, { balance: user.balance - bet + winnings });
  
  // Créer l'embed
  const embed = createSlotsEmbed(interaction, {
    result,
    bet,
    winnings,
    newBalance,
    userId: interaction.user.id,
    username: interaction.user.username
  });
  
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
function calculateWinnings(result, bet, config) {
  const resultStr = result.join('');
  const multiplier = PAYOUTS[resultStr] || 0;
  return Math.floor(bet * multiplier);
}

// Fonction pour créer l'embed de la machine à sous
function createSlotsEmbed(interaction, gameState) {
  const config = getGameConfig(interaction);
  const { result, bet, winnings, newBalance, userId, username } = gameState;
  const isWin = winnings > 0;
  
  const embed = new EmbedBuilder()
    .setTitle('🎰 Machine à sous')
    .setDescription(`[ ${result[0]} | ${result[1]} | ${result[2]} ]`)
    .addFields(
      { name: 'Mise', value: `${bet} ${config.currency.emoji}`, inline: true },
      { name: 'Gains', value: `${winnings} ${config.currency.emoji}`, inline: true },
      { name: 'Nouveau solde', value: `${newBalance} ${config.currency.emoji}`, inline: true },
      { name: 'Résultat', value: result.join(' '), inline: true },
      { name: 'Multiplicateur', value: isWin ? `x${(winnings / bet).toFixed(1)}` : 'x0', inline: true }
    );
  
  // Mettre à jour la couleur en fonction du résultat
  if (isWin) {
    embed.setColor(0x57F287); // Vert Discord pour les gains
    
    // Ajouter un message spécial pour les gros gains
    if (winnings >= bet * 10) {
      embed.setFooter({ text: '🎊 Gros gain ! 🎊' });
    }
  } else {
    embed.setColor(0xED4245); // Rouge Discord pour les pertes
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
