const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser, getUserEffects, hasActiveEffect, useEffect } = require('../database');

// Variables pour stocker les parties en cours
const activeRouletteGames = new Map();

// Constantes du jeu
const ROULETTE_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const NUMBER_TYPES = {
  RED: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
  BLACK: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35],
  GREEN: [0],
  FIRST_HALF: Array.from({ length: 18 }, (_, i) => i + 1),
  SECOND_HALF: Array.from({ length: 18 }, (_, i) => i + 19),
  FIRST_DOZEN: Array.from({ length: 12 }, (_, i) => i + 1),
  SECOND_DOZEN: Array.from({ length: 12 }, (_, i) => i + 13),
  THIRD_DOZEN: Array.from({ length: 12 }, (_, i) => i + 25),
  EVEN: Array.from({ length: 18 }, (_, i) => (i + 1) * 2),
  ODD: Array.from({ length: 18 }, (_, i) => (i * 2) + 1)
};

const PAYOUTS = {
  STRAIGHT_UP: 35,
  SPLIT: 17,
  STREET: 11,
  CORNER: 8,
  FIVE_NUMBERS: 6,
  LINE: 5,
  DOZEN: 2,
  COLUMN: 2,
  EVEN_MONEY: 1
};

// Effets temporaires
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

  // Consommer l'effet
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

// Fonction pour démarrer une nouvelle partie de roulette
async function handleRouletteStart(interaction) {
  const bet = interaction.options.getInteger('mise');
  const choice = interaction.options.getString('choix');
  const userId = interaction.user.id;
  const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
  const user = ensureUser(userId, guildId);

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
    choice,
    result: null,
    winnings: 0,
    lastAction: Date.now(),
    doubleOrNothingMessage: null,
    lossProtectionUsed: false
  };

  // Mettre à jour le solde de l'utilisateur
  updateUser(userId, guildId, { balance: user.balance - bet });
  
  // Stocker la partie
  activeRouletteGames.set(gameId, gameState);
  
  // Lancer la roulette
  const result = spinRoulette();
  gameState.result = result;
  
  // Calculer les gains
  const baseWin = calculateWinnings(gameState);

  // Appliquer les multiplicateurs d'effets
  const effectMultiplier = calculateEffectMultiplier(userId, guildId);
  let finalWin = Math.floor(baseWin * effectMultiplier);

  // Appliquer Double ou Crève si applicable
  const doubleResult = applyDoubleOrNothing(userId, guildId, finalWin);
  finalWin = doubleResult.winnings;
  gameState.doubleOrNothingMessage = doubleResult.message;

  // Gestion de la protection contre les pertes si le joueur a tout perdu
  if (finalWin === 0 && baseWin === 0) {
    const usedProtection = checkLossProtection(userId, guildId, bet);
    if (usedProtection) {
      finalWin = bet; // Remboursement de la mise
      gameState.lossProtectionUsed = true;
    }
  }

  gameState.winnings = finalWin;

  // Mettre à jour le solde en fonction du résultat final
  const newBalance = user.balance - bet + finalWin;
  updateUser(userId, guildId, { balance: newBalance });

  // Consommer une utilisation de Saignée (double_winnings) pour cette partie si actif
  if (hasActiveEffect(userId, 'double_winnings', guildId)) {
    useEffect(userId, 'double_winnings', guildId);
  }
  
  // Créer l'embed
  const embed = createRouletteEmbed(gameState, interaction.user);
  
  // Envoyer le message
  await interaction.reply({
    embeds: [embed]
  });
  
  // Supprimer la partie après un délai
  setTimeout(() => {
    activeRouletteGames.delete(gameId);
  }, 30000); // 30 secondes
}

// Fonction pour gérer les choix de mise avancés
async function handleRouletteChoice(interaction) {
  const gameId = interaction.customId.split('_')[1];
  const gameState = activeRouletteGames.get(gameId);
  
  if (!gameState) {
    return interaction.reply({ 
      content: '❌ Cette partie est terminée !', 
      ephemeral: true 
    });
  }
  
  if (interaction.user.id !== gameState.userId) {
    return interaction.reply({ 
      content: '❌ Ce n\'est pas votre partie !', 
      ephemeral: true 
    });
  }
  
  // Mettre à jour le choix
  const choice = interaction.values[0];
  gameState.choice = choice;
  gameState.lastAction = Date.now();
  
  // Mettre à jour l'interface
  const embed = createRouletteEmbed(gameState, interaction.user);
  
  await interaction.update({
    embeds: [embed],
    components: [createRouletteComponents(gameId)]
  });
}

// Fonction pour faire tourner la roulette
function spinRoulette() {
  const randomIndex = Math.floor(Math.random() * ROULETTE_NUMBERS.length);
  return ROULETTE_NUMBERS[randomIndex];
}

// Fonction pour calculer les gains
function calculateWinnings(gameState) {
  const { bet, choice, result } = gameState;
  
  // Vérifier le type de pari et calculer les gains
  if (choice === 'red' && NUMBER_TYPES.RED.includes(result)) {
    return bet * (PAYOUTS.EVEN_MONEY + 1);
  }
  
  if (choice === 'black' && NUMBER_TYPES.BLACK.includes(result)) {
    return bet * (PAYOUTS.EVEN_MONEY + 1);
  }
  
  if (choice === 'green' && NUMBER_TYPES.GREEN.includes(result)) {
    return bet * (PAYOUTS.STRAIGHT_UP + 1);
  }
  
  if (choice === 'even' && NUMBER_TYPES.EVEN.includes(result)) {
    return bet * (PAYOUTS.EVEN_MONEY + 1);
  }
  
  if (choice === 'odd' && NUMBER_TYPES.ODD.includes(result)) {
    return bet * (PAYOUTS.EVEN_MONEY + 1);
  }
  
  if (choice === '1to18' && result >= 1 && result <= 18) {
    return bet * (PAYOUTS.EVEN_MONEY + 1);
  }
  
  if (choice === '19to36' && result >= 19 && result <= 36) {
    return bet * (PAYOUTS.EVEN_MONEY + 1);
  }
  
  if (choice === '1st12' && result >= 1 && result <= 12) {
    return bet * (PAYOUTS.DOZEN + 1);
  }
  
  if (choice === '2nd12' && result >= 13 && result <= 24) {
    return bet * (PAYOUTS.DOZEN + 1);
  }
  
  if (choice === '3rd12' && result >= 25 && result <= 36) {
    return bet * (PAYOUTS.DOZEN + 1);
  }
  
  // Vérifier les paris sur des nombres spécifiques
  if (!isNaN(choice)) {
    const number = parseInt(choice, 10);
    if (number === result) {
      return bet * (PAYOUTS.STRAIGHT_UP + 1);
    }
  }
  
  return 0; // Aucun gain
}

// Fonction pour créer l'embed de la roulette
function createRouletteEmbed(gameState, user) {
  const { bet, choice, result, winnings, doubleOrNothingMessage, lossProtectionUsed } = gameState;
  
  const embed = new EmbedBuilder()
    .setTitle('🎡 ROULETTE')
    .setColor(0x0099FF);
    
  if (result === null) {
    // En attente du résultat
    embed.setDescription(
      `**Mise :** ${bet} ${config.currency.emoji}\n` +
      `**Choix :** ${formatChoice(choice)}\n\n` +
      `La roue tourne...`
    );
  } else {
    // Résultat final
    const isWin = winnings > 0;
    const color = getNumberColor(result);
    
    let description =
      `**Résultat :** ${color} **${result}** ${color}\n` +
      `**Mise :** ${bet} ${config.currency.emoji}\n` +
      `**Choix :** ${formatChoice(choice)}\n\n`;

    if (isWin) {
      description += `🎉 **Vous avez gagné ${winnings} ${config.currency.emoji} !**\n`;
    } else {
      description += `😢 **Vous avez perdu ${bet} ${config.currency.emoji}...**\n`;
      if (lossProtectionUsed) {
        description += `🫀 Votre **Cœur de Remplacement** a remboursé votre mise !\n`;
      }
    }

    if (doubleOrNothingMessage) {
      description += `\n${doubleOrNothingMessage}`;
    }

    embed.setDescription(description);
    
    embed.setColor(isWin ? 0x00FF00 : 0xFF0000);
  }
  
  return embed;
}

// Fonction pour créer les composants de la roulette
function createRouletteComponents(gameId) {
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`roulette_${gameId}`)
        .setPlaceholder('Choisissez votre mise')
        .addOptions([
          { label: 'Rouge', value: 'red', emoji: '🔴' },
          { label: 'Noir', value: 'black', emoji: '⚫' },
          { label: 'Vert', value: 'green', emoji: '🟢' },
          { label: 'Pair', value: 'even', emoji: '🔢' },
          { label: 'Impair', value: 'odd', emoji: '🔣' },
          { label: '1 à 18', value: '1to18', emoji: '1️⃣' },
          { label: '19 à 36', value: '19to36', emoji: '2️⃣' },
          { label: '1er 12', value: '1st12', emoji: '🔢' },
          { label: '2ème 12', value: '2nd12', emoji: '🔢' },
          { label: '3ème 12', value: '3rd12', emoji: '🔢' }
        ])
    );
    
  return row;
}

// Fonction utilitaire pour obtenir la couleur d'un numéro
function getNumberColor(number) {
  if (NUMBER_TYPES.RED.includes(number)) return '🔴';
  if (NUMBER_TYPES.BLACK.includes(number)) return '⚫';
  return '🟢'; // Zéro est vert
}

// Fonction utilitaire pour formater le choix
function formatChoice(choice) {
  const choices = {
    'red': 'Rouge',
    'black': 'Noir',
    'green': 'Vert (0)',
    'even': 'Pair',
    'odd': 'Impair',
    '1to18': '1 à 18',
    '19to36': '19 à 36',
    '1st12': '1er 12',
    '2nd12': '2ème 12',
    '3rd12': '3ème 12'
  };
  
  return choices[choice] || choice;
}

// Nettoyer les anciennes parties inactives (appelé périodiquement)
function cleanupOldRouletteGames() {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes d'inactivité
  
  for (const [gameId, game] of activeRouletteGames.entries()) {
    if (now - game.lastAction > timeout) {
      // Rembourser le joueur si la partie est toujours en cours
      if (!game.result) {
        updateUser(game.userId, game.guildId, { balance: ensureUser(game.userId, game.guildId).balance + game.bet });
      }
      activeRouletteGames.delete(gameId);
    }
  }
}

// Nettoyer les anciennes parties toutes les 5 minutes
setInterval(cleanupOldRouletteGames, 5 * 60 * 1000);

module.exports = {
  handleRouletteStart,
  handleRouletteChoice
};
