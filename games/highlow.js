const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

// Variables pour stocker les parties en cours
const activeHighLowGames = new Map();

// Constantes du jeu
const CARD_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const CARD_SUITS = ['♠', '♥', '♦', '♣'];
const CARD_EMOJIS = {
  '♠': '♠️',
  '♥': '♥️',
  '♦': '♦️',
  '♣': '♣️'
};

// Fonction pour créer un nouveau jeu High Low
async function handleHighLow(interaction) {
  const bet = interaction.options.getInteger('mise');
  const userId = interaction.user.id;
  const user = ensureUser(userId);

  if (bet > user.balance) {
    return interaction.reply({ 
      content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour cette mise !`, 
      flags: 1 << 6 // Utilisation de flags pour rendre le message éphémère
    });
  }

  if (bet > config.casino.maxBet) {
    return interaction.reply({ 
      content: `❌ La mise maximale est de ${config.casino.maxBet} ${config.currency.emoji} !`, 
      flags: 1 << 6 // Utilisation de flags pour rendre le message éphémère
    });
  }

  if (bet < config.casino.minBet) {
    return interaction.reply({ 
      content: `❌ La mise minimale est de ${config.casino.minBet} ${config.currency.emoji} !`, 
      flags: 1 << 6 // Utilisation de flags pour rendre le message éphémère
    });
  }

  // Créer une nouvelle partie
  const gameId = Date.now().toString();
  const firstCard = drawCard();
  
  const gameState = {
    userId,
    bet,
    currentCard: firstCard,
    nextCard: null,
    multiplier: 1.0,
    lastAction: Date.now()
  };

  // Vérifier si l'utilisateur a assez d'argent après la mise à jour
  if (user.balance < bet) {
    return interaction.reply({
      content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour cette mise !`,
      flags: 1 << 6
    });
  }
  
  // Mettre à jour le solde de l'utilisateur
  updateUser(userId, { balance: user.balance - bet });
  
  // Stocker la partie avec la date de création
  gameState.createdAt = Date.now();
  activeHighLowGames.set(gameId, gameState);
  
  // Créer l'embed
  const embed = createHighLowEmbed(gameState, interaction.user);
  const components = createHighLowComponents(gameId, false);
  
  // Envoyer le message
  try {
    await interaction.reply({
      embeds: [embed],
      components: components // Pas besoin de mettre dans un tableau car createHighLowComponents retourne déjà un tableau
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la réponse:', error);
    // Essayer d'envoyer un message d'erreur
    try {
      await interaction.followUp({
        content: 'Une erreur est survenue lors du démarrage du jeu. Veuillez réessayer.',
        flags: 1 << 6 // Message éphémère
      });
    } catch (e) {
      console.error('Impossible d\'envoyer le message d\'erreur:', e);
    }
  }
}

// Fonction pour gérer les actions High Low
async function handleHighLowAction(interaction) {
  const [_, gameId, action] = interaction.customId.split('_');
  const gameState = activeHighLowGames.get(gameId);
  
  if (!gameState) {
    return interaction.update({
      content: '❌ Cette partie est terminée !',
      components: []
    });
  }
  
  if (interaction.user.id !== gameState.userId) {
    return interaction.deferUpdate();
  }
  
  // Mettre à jour le timestamp de la dernière action
  gameState.lastAction = Date.now();
  
  // Tirer une nouvelle carte
  gameState.nextCard = drawCard(gameState.currentCard);
  
  // Vérifier le résultat
  const currentValue = getCardValue(gameState.currentCard);
  const nextValue = getCardValue(gameState.nextCard);
  
  let result;
  if (action === 'higher') {
    result = nextValue > currentValue ? 'win' : nextValue < currentValue ? 'lose' : 'tie';
  } else if (action === 'lower') {
    result = nextValue < currentValue ? 'win' : nextValue > currentValue ? 'lose' : 'tie';
  } else {
    result = nextValue === currentValue ? 'win' : 'lose';
  }
  
  // Mettre à jour la carte précédente
  gameState.previousCard = gameState.currentCard;
  
  if (result === 'win') {
    // Mettre à jour le multiplicateur
    gameState.multiplier = gameState.multiplier > 1 ? gameState.multiplier * 1.5 : 1.5;
    
    // Mettre à jour la carte courante pour le prochain tour
    gameState.currentCard = gameState.nextCard;
    gameState.nextCard = null;
    
    // Afficher les boutons de décision (continuer ou cashout)
    const embed = createHighLowEmbed(gameState, interaction.user, false, true);
    const components = createHighLowComponents(gameId, true);
    
    // Sauvegarder l'état actuel du jeu
    activeHighLowGames.set(gameId, gameState);
    
    try {
      await interaction.update({
        embeds: [embed],
        components: components
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du message (victoire):', error);
      try {
        await interaction.followUp({
          content: 'Une erreur est survenue lors de la mise à jour du jeu. Veuillez réessayer.',
          flags: 1 << 6
        });
      } catch (e) {
        console.error('Impossible d\'envoyer le message d\'erreur:', e);
      }
      return;
    }
    
  } else if (result === 'lose') {
    // Fin de la partie en cas de défaite
    const user = ensureUser(gameState.userId);
    let message = '';
    
    // Mettre à jour la carte courante pour afficher la dernière carte
    gameState.currentCard = gameState.nextCard;
    gameState.nextCard = null;
    
    // Le joueur perd toute sa mise, qui a déjà été déduite au début de la partie
    message = `❌ Dommage ! Vous avez perdu votre mise de ${gameState.bet} ${config.currency.emoji}.`;
    
    if (gameState.multiplier > 1) {
      message += `\n💥 Votre multiplicateur était de x${gameState.multiplier.toFixed(2)}.`;
    }
    
    const embed = createHighLowEmbed(gameState, interaction.user, true, false);
    
    try {
      await interaction.update({
        content: message,
        embeds: [embed],
        components: []
      });
      
      activeHighLowGames.delete(gameId);
    } catch (error) {
      console.error('Erreur lors de la mise à jour du message (défaite):', error);
      try {
        await interaction.followUp({
          content: `Une erreur est survenue lors de la fin de la partie.`,
          flags: 1 << 6
        });
      } catch (e) {
        console.error('Impossible d\'envoyer le message d\'erreur:', e);
      }
      activeHighLowGames.delete(gameId);
    }
    return;
  } else {
    // En cas d'égalité, on ne change pas le multiplicateur
    // mais on met quand même à jour la carte courante
    gameState.currentCard = gameState.nextCard;
    gameState.nextCard = null;
    
    const embed = createHighLowEmbed(gameState, interaction.user, false, false);
    const components = createHighLowComponents(gameId, false);
    
    try {
      await interaction.update({
        embeds: [embed],
        components: components,
        content: '✨ Égalité ! La partie continue avec la même carte.'
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du message (égalité):', error);
      try {
        await interaction.followUp({
          content: 'Une erreur est survenue lors de la mise à jour du jeu. Veuillez réessayer.',
          flags: 1 << 6
        });
      } catch (e) {
        console.error('Impossible d\'envoyer le message d\'erreur:', e);
      }
    }
  }
}

// Fonction pour gérer la décision de continuer ou de s'arrêter
async function handleHighLowDecision(interaction) {
  const [_, __, gameId, action] = interaction.customId.split('_');
  const gameState = activeHighLowGames.get(gameId);
  
  if (!gameState) {
    return interaction.update({
      content: '❌ Cette partie est terminée !',
      components: []
    });
  }
  
  if (interaction.user.id !== gameState.userId) {
    return interaction.deferUpdate();
  }
  
  try {
    if (action === 'stop') {
      // Le joueur choisit de s'arrêter (bouton 'Petite couille')
      const winnings = Math.floor(gameState.bet * gameState.multiplier);
      const user = ensureUser(gameState.userId);
      
      // Calculer le nouveau solde
      const newBalance = user.balance + winnings;
      
      // Mettre à jour le solde du joueur
      updateUser(gameState.userId, { balance: newBalance });
      
      // Créer l'embed de fin de partie
      const embed = new EmbedBuilder()
        .setTitle('🏁 Partie terminée - Cashout réussi !')
        .setColor(0x57F287) // Vert Discord
        .setDescription(
          `✅ **Cashout effectué avec succès !**\n` +
          `💰 **Gains :** ${winnings} ${config.currency.emoji}\n` +
          `📈 **Multiplicateur final :** x${gameState.multiplier.toFixed(2)}\n` +
          `💵 **Nouveau solde :** ${newBalance} ${config.currency.emoji}`
        )
        .setFooter({ 
          text: `Joueur: ${interaction.user.username} | Mise initiale: ${gameState.bet} ${config.currency.emoji}`,
          iconURL: interaction.user.displayAvatarURL()
        });
      
      try {
        // Mettre à jour le message avec les gains
        await interaction.update({
          content: `💰 **${interaction.user.username}** a choisi de s'arrêter et empoche **${winnings}** ${config.currency.emoji} !`,
          embeds: [embed],
          components: []
        });
      } catch (error) {
        console.error('Erreur lors de la mise à jour du message (cashout):', error);
        try {
          await interaction.followUp({
            content: `✅ Cashout réussi ! Vous avez gagné **${winnings}** ${config.currency.emoji}`,
            flags: 1 << 6
          });
        } catch (e) {
          console.error('Impossible d\'envoyer le message de confirmation:', e);
        }
      }
      
      // Supprimer la partie
      activeHighLowGames.delete(gameId);
      
    } else if (action === 'continue') {
      // Le joueur choisit de continuer (bouton 'Envoie la next')
      // Mettre à jour la carte précédente pour l'affichage
      gameState.previousCard = gameState.currentCard;
      
      // Créer l'embed pour le prochain tour
      const embed = createHighLowEmbed(gameState, interaction.user, false, false);
      const components = createHighLowComponents(gameId, false);
      
      // Mettre à jour le message pour le prochain tour
      await interaction.update({
        embeds: [embed],
        components: components,
        content: '🔄 En attente de votre prochain choix...' // Message de transition
      });
      
      // Sauvegarder l'état actuel du jeu
      activeHighLowGames.set(gameId, gameState);
    }
  } catch (error) {
    console.error('Erreur lors de la gestion de la décision:', error);
    // Essayer d'envoyer un message d'erreur
    try {
      await interaction.followUp({
        content: '❌ Une erreur est survenue lors du traitement de votre décision. Veuillez réessayer.',
        flags: 1 << 6
      });
    } catch (e) {
      console.error('Impossible d\'envoyer le message d\'erreur:', e);
    }
  }
}

// Fonction pour formater une carte avec son emoji
function formatCard(card) {
  if (!card) return 'Aucune carte';
  const suitEmoji = CARD_EMOJIS[card.suit] || card.suit;
  return `${card.value}${suitEmoji}`;
}

// Fonction pour obtenir la valeur numérique d'une carte
function getCardValue(card) {
  if (!card) return 0;
  const value = card.value;
  if (value === 'A') return 14;
  if (value === 'K') return 13;
  if (value === 'Q') return 12;
  if (value === 'J') return 11;
  return parseInt(value, 10);
}

// Fonction pour tirer une carte aléatoire
function drawCard(excludeCard = null) {
  let value, suit, card;
  do {
    value = CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)];
    suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
    card = { value, suit };
  } while (excludeCard && card.value === excludeCard.value && card.suit === excludeCard.suit);
  
  return card;
}

// Fonction pour créer l'embed du jeu High Low
function createHighLowEmbed(gameState, user, isGameOver = false, showDecision = false) {
  const embed = new EmbedBuilder()
    .setTitle('🃏 HIGH LOW')
    .setColor(0x0099FF);
    
  const currentCardValue = getCardValue(gameState.currentCard);
  const potentialWinnings = Math.floor(gameState.bet * gameState.multiplier);
  
  if (isGameOver) {
    const user = ensureUser(gameState.userId);
    const newBalance = showDecision 
      ? user.balance + potentialWinnings // Le joueur a gagné
      : user.balance - gameState.bet;    // Le joueur a perdu
    
    if (showDecision) {
      // Le joueur a choisi de s'arrêter
      embed.setDescription(
        `🎉 **${user.username} a choisi de s'arrêter !**\n` +
        `🃏 **Dernière carte :** ${formatCard(gameState.currentCard)}\n` +
        `💰 **Gains :** ${potentialWinnings} ${config.currency.emoji} (x${gameState.multiplier.toFixed(2)})\n` +
        `💳 **Mise initiale :** ${gameState.bet} ${config.currency.emoji}\n` +
        `💵 **Nouveau solde :** ${newBalance} ${config.currency.emoji}`
      );
    } else {
      // Le joueur a perdu
      embed.setDescription(
        `💥 **Dommage !**\n` +
        `🃏 **Dernière carte :** ${formatCard(gameState.currentCard)}\n` +
        `📉 **Multiplicateur final :** x${gameState.multiplier.toFixed(2)}\n` +
        `💸 **Mise perdue :** ${gameState.bet} ${config.currency.emoji}\n` +
        `💵 **Nouveau solde :** ${newBalance} ${config.currency.emoji}`
      );
    }
  } else if (showDecision) {
    // Le joueur doit décider de continuer ou de s'arrêter
    embed.setDescription(
      `🃏 **Dernière carte :** ${formatCard(gameState.currentCard)}\n` +
      `💰 **Gains actuels :** ${potentialWinnings} ${config.currency.emoji}\n` +
      `📈 **Multiplicateur actuel :** x${gameState.multiplier.toFixed(2)}\n\n` +
      `**Que souhaitez-vous faire ?**`
    );
  } else {
    // Nouveau tour
    let description = `🃏 **Carte actuelle :** ${formatCard(gameState.currentCard)}\n` +
      `💰 **Mise :** ${gameState.bet} ${config.currency.emoji}\n` +
      `📊 **Multiplicateur :** x${gameState.multiplier.toFixed(2)}`;
    
    if (gameState.previousCard) {
      const previousValue = getCardValue(gameState.previousCard);
      const currentValue = getCardValue(gameState.currentCard);
      let result;
      
      if (currentValue > previousValue) {
        result = '**↑ Plus haute ↑**';
      } else if (currentValue < previousValue) {
        result = '**↓ Plus basse ↓**';
      } else {
        result = '**= Égale =**';
      }
      
      description += `\n\n${result} (précédente: ${formatCard(gameState.previousCard)})`;
    }
    
    description += '\n\n**Choisissez la prochaine carte :**';
    
    embed.setDescription(description);
  }
  
  // Ajouter un footer avec les informations du joueur
  embed.setFooter({ 
    text: `Joueur: ${user.username} | Mise: ${gameState.bet} ${config.currency.emoji}`,
    iconURL: user.displayAvatarURL()
  });
  
  return embed;
}

// Fonction pour créer les composants du jeu High Low
function createHighLowComponents(gameId, showDecision = false) {
  if (showDecision) {
    // Boutons pour décider de continuer ou de s'arrêter
    return [
      // Première rangée : boutons de décision
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`highlow_${gameId}_continue`)
          .setLabel('Envoie la next')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`highlow_${gameId}_stop`)
          .setLabel('Petite couille')
          .setStyle(ButtonStyle.Danger)
      )
    ];
  } else {
    // Boutons pour choisir plus haut/plus bas/égal
    return [
      // Première rangée : boutons de choix de carte
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`highlow_${gameId}_higher`)
          .setLabel('Haut')
          .setStyle(ButtonStyle.Success), // Vert pour plus haut
        new ButtonBuilder()
          .setCustomId(`highlow_${gameId}_equal`)
          .setLabel('=')
          .setStyle(ButtonStyle.Secondary), // Gris pour égal
        new ButtonBuilder()
          .setCustomId(`highlow_${gameId}_lower`)
          .setLabel('Bas')
          .setStyle(ButtonStyle.Danger) // Rouge pour plus bas
      )
    ];
  }
}

// Fonction pour tirer une carte aléatoire
function drawCard(excludeCard = null) {
  let value, suit;
  let card;
  
  do {
    value = CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)];
    suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
    card = { value, suit };
  } while (excludeCard && areCardsEqual(card, excludeCard));
  
  return card;
}

// Fonction pour obtenir la valeur numérique d'une carte
function getCardValue(card) {
  const value = card.value;
  if (value === 'A') return 14;
  if (value === 'K') return 13;
  if (value === 'Q') return 12;
  if (value === 'J') return 11;
  return parseInt(value, 10);
}

// Fonction pour formater une carte en texte
function formatCard(card) {
  return `${card.value}${CARD_EMOJIS[card.suit] || card.suit}`;
}

// Fonction pour comparer deux cartes
function areCardsEqual(card1, card2) {
  return card1.value === card2.value && card1.suit === card2.suit;
}

// Nettoyer les anciennes parties inactives (appelé périodiquement)
function cleanupOldHighLowGames() {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes d'inactivité
  
  for (const [gameId, game] of activeHighLowGames.entries()) {
    if (now - game.lastAction > timeout) {
      // Rembourser le joueur si la partie est toujours en cours
      if (game.multiplier > 1.0) {
        const winnings = Math.floor(game.bet * game.multiplier);
        updateUser(game.userId, { balance: ensureUser(game.userId).balance + winnings });
      } else {
        updateUser(game.userId, { balance: ensureUser(game.userId).balance + game.bet });
      }
      activeHighLowGames.delete(gameId);
    }
  }
}

// Nettoyer les anciennes parties toutes les 5 minutes
setInterval(cleanupOldHighLowGames, 5 * 60 * 1000);

// Alias pour la compatibilité avec le code existant
const handleSpecialHighLow = handleHighLow;

// Débogage
console.log('[HighLow] Exportation des fonctions:');
console.log('- handleHighLow:', typeof handleHighLow);
console.log('- handleSpecialHighLow:', typeof handleSpecialHighLow);
console.log('- handleHighLowAction:', typeof handleHighLowAction);
console.log('- handleHighLowDecision:', typeof handleHighLowDecision);

const exportsObj = {
  handleHighLow,
  handleSpecialHighLow,
  handleHighLowAction,
  handleHighLowDecision
};

console.log('[HighLow] Objet d\'exportation:', Object.keys(exportsObj));

module.exports = exportsObj;
