const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

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
  // Vérifier d'abord les 3 symboles identiques
  if (result[0] === result[1] && result[1] === result[2]) {
    const pattern = result[0].repeat(3);
    return PAYOUTS[pattern] ? bet * PAYOUTS[pattern] : 0;
  }
  
  // Vérifier les paires (deux symboles identiques)
  if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    // Trouver les symboles qui forment une paire
    let pairSymbol;
    if (result[0] === result[1]) pairSymbol = result[0];
    else if (result[1] === result[2]) pairSymbol = result[1];
    else pairSymbol = result[0]; // pour le cas où result[0] === result[2]
    
    const pattern = pairSymbol.repeat(2);
    return PAYOUTS[pattern] ? bet * PAYOUTS[pattern] : 0;
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
  
  // Créer l'affichage des rouleaux avec un meilleur formatage
  const display = `[ ${result[0]} | ${result[1]} | ${result[2]} ]`;
  
  // Calculer le résultat net
  const netResult = isWin ? winnings - bet : -bet;
  const resultText = isWin 
    ? `🎉 **Gain : +${winnings} ${config.currency.emoji}** (Net: +${netResult} ${config.currency.emoji})`
    : `😢 **Perte : -${bet} ${config.currency.emoji}**`;
  
  embed.setDescription(
    `### 🎰 **MACHINE À SOUS**\n` +
    `\n${display}\n` +
    `\n**Mise :** ${bet} ${config.currency.emoji}\n` +
    `${resultText}`
  );
  
  // Ajouter un champ pour afficher la combinaison obtenue
  embed.addFields(
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
