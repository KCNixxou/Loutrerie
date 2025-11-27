const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ensureUser, updateUser, getUserEffects, hasActiveEffect, useEffect } = require('../database');
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

function calculateEffectMultiplier(userId, guildId) {
  const effects = getUserEffects(userId, guildId);
  let multiplier = 1.0;

  effects.forEach(effect => {
    switch (effect.effect) {
      case 'casino_bonus':
        multiplier *= (1 + effect.value);
        break;
      case 'double_winnings':
        multiplier *= effect.value;
        break;
    }
  });

  return multiplier;
}

function checkLossProtection(userId, guildId, lossAmount) {
  if (!guildId) return false;
  if (hasActiveEffect(userId, 'loss_protection', guildId)) {
    useEffect(userId, 'loss_protection', guildId);
    return true;
  }
  return false;
}

function applyDoubleOrNothing(userId, guildId, baseWinnings) {
  if (!guildId || baseWinnings <= 0) {
    return { winnings: baseWinnings, message: null };
  }

  if (!hasActiveEffect(userId, 'double_or_nothing', guildId)) {
    return { winnings: baseWinnings, message: null };
  }

  useEffect(userId, 'double_or_nothing', guildId);

  const success = Math.random() < 0.5;
  if (success) {
    return {
      winnings: baseWinnings * 2,
      message: '🔪 **Double ou Crève** a réussi : vos gains ont été **doublés** !'
    };
  }

  return {
    winnings: 0,
    message: '🔪 **Double ou Crève** a échoué : vous perdez **tous vos gains** sur ce tour.'
  };
}

// Fonction pour démarrer une nouvelle partie de machine à sous
async function handleSlots(interaction) {
  const bet = interaction.options.getInteger('mise');
  const userId = interaction.user.id;
  const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
  console.log(`[SLOTS] guildId utilisé: ${guildId} pour ${interaction.user.tag}`);
  const user = ensureUser(userId, guildId);
  console.log(`[SLOTS] solde lu: ${user.balance} pour ${interaction.user.tag}`);
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
    lastAction: Date.now(),
    doubleOrNothingMessage: null,
    lossProtectionUsed: false
  };

  // Mettre à jour le solde de l'utilisateur
  updateUser(userId, guildId, { balance: user.balance - bet });
  
  // Jouer la partie
  const result = spinSlots();
  gameState.result = result;
  
  // Calculer les gains bruts
  const baseWinnings = calculateWinnings(result, bet, config);

  // Appliquer les effets de multiplicateur
  const effectMultiplier = calculateEffectMultiplier(userId, guildId);
  let finalWinnings = Math.floor(baseWinnings * effectMultiplier);

  // Appliquer Double ou Crève
  const doubleResult = applyDoubleOrNothing(userId, guildId, finalWinnings);
  finalWinnings = doubleResult.winnings;
  gameState.doubleOrNothingMessage = doubleResult.message;

  // Protection contre les pertes si zéro gain
  if (finalWinnings === 0 && baseWinnings === 0) {
    const usedProtection = checkLossProtection(userId, guildId, bet);
    if (usedProtection) {
      finalWinnings = bet;
      gameState.lossProtectionUsed = true;
    }
  }

  gameState.winnings = finalWinnings;

  const newBalance = user.balance - bet + finalWinnings;

  // Mettre à jour le solde de l'utilisateur avec le résultat final
  updateUser(userId, guildId, { balance: newBalance });

  // Consommer une utilisation de Saignée (double_winnings) pour cette partie si actif
  if (hasActiveEffect(userId, 'double_winnings', guildId)) {
    useEffect(userId, 'double_winnings', guildId);
  }
  
  // Créer l'embed
  const embed = createSlotsEmbed(interaction, {
    result,
    bet,
    winnings: finalWinnings,
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
  const { result, bet, winnings, newBalance, userId, username, doubleOrNothingMessage, lossProtectionUsed } = gameState;
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
  
  if (!isWin && lossProtectionUsed) {
    embed.addFields({
      name: '🫀 Protection',
      value: 'Votre **Cœur de Remplacement** a remboursé votre mise.',
      inline: false
    });
  }

  if (doubleOrNothingMessage) {
    embed.addFields({
      name: '🔪 Double ou Crève',
      value: doubleOrNothingMessage,
      inline: false
    });
  }
  
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
