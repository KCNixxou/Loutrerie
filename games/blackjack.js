const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser, getUserEffects, useEffect, hasActiveEffect } = require('../database');

// Variables pour stocker les parties en cours
const activeBlackjackGames = new Map();

// Constantes du jeu
const CARD_VALUES = {
  'A': 11, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10
};

const CARD_EMOJIS = {
  'S': '♠️', // Piques
  'H': '♥️', // Cœurs
  'D': '♦️', // Carreaux
  'C': '♣️'  // Trèfles
};

// Fonctions pour les effets temporaires
function calculateEffectMultiplier(userId, guildId) {
  const effects = getUserEffects(userId, guildId);
  let multiplier = 1.0;
  
  effects.forEach(effect => {
    switch (effect.effect) {
      case 'casino_bonus':
        multiplier *= (1 + effect.value); // +15% par défaut
        break;
      case 'double_winnings':
        multiplier *= effect.value; // x2 par défaut
        break;
    }
  });
  
  return multiplier;
}

function checkLossProtection(userId, guildId, lossAmount) {
  if (hasActiveEffect(userId, 'loss_protection', guildId)) {
    useEffect(userId, 'loss_protection', guildId);
    return true;
  }
  return false;
}

// Fonction pour démarrer une nouvelle partie de blackjack
async function handleBlackjackStart(interaction) {
  const bet = interaction.options.getInteger('mise');
  const sideBet = interaction.options.getInteger('sidebet') || 0;
  const userId = interaction.user.id;
  const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
  const user = ensureUser(userId, guildId);

  const totalCost = bet + sideBet;

  if (totalCost > user.balance) {
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
  
  // Distribuer les cartes initiales
  const initialHand = [drawCard(), drawCard()];
  const dealerHand = [drawCard(), drawCard()];

  const gameState = {
    userId,
    guildId,
    baseBet: bet,
    playerHands: [initialHand],
    bets: [bet],
    handStatuses: ['playing'], // playing | bust | stand | win | lose | push
    activeHandIndex: 0,
    dealerHand,
    dealerScore: null,
    isPlayerTurn: true,
    isGameOver: false,
    hasSplit: false,
    lastAction: Date.now(),
    sideBet,
    sideBetResult: null,
    sideBetPayout: 0
  };

  // Mettre à jour le solde de l'utilisateur (mise principale + side bet)
  updateUser(userId, guildId, { balance: user.balance - totalCost });

  // Résoudre immédiatement le side bet Perfect Pairs
  if (sideBet > 0) {
    const [card1, card2] = initialHand;
    let multiplier = 0;
    let resultLabel = 'Aucune paire';

    if (card1.value === card2.value) {
      const redSuits = ['H', 'D'];
      const isRed1 = redSuits.includes(card1.suit);
      const isRed2 = redSuits.includes(card2.suit);

      if (card1.suit === card2.suit) {
        // Paire parfaite (même valeur, même couleur)
        multiplier = 25;
        resultLabel = 'Paire parfaite (25:1)';
      } else if ((isRed1 && isRed2) || (!isRed1 && !isRed2)) {
        // Paire de couleur (même valeur, même couleur rouge/noir)
        multiplier = 12;
        resultLabel = 'Paire de couleur (12:1)';
      } else {
        // Paire mixte (même valeur, couleurs différentes)
        multiplier = 6;
        resultLabel = 'Paire mixte (6:1)';
      }
    }

    if (multiplier > 0) {
      const sideWinnings = sideBet * multiplier;
      const current = ensureUser(userId, guildId);
      updateUser(userId, guildId, { balance: current.balance + sideWinnings });
      gameState.sideBetPayout = sideWinnings;
      gameState.sideBetResult = resultLabel;
    } else {
      gameState.sideBetResult = 'Perdu';
    }
  }
  
  // Vérifier le blackjack immédiat (21 sur la main initiale)
  const playerScore = calculateHandValue(initialHand);
  if (playerScore === 21) {
    return handleBlackjack(gameState, interaction);
  }
  
  // Stocker la partie
  activeBlackjackGames.set(gameId, gameState);
  
  // Créer l'embed et les composants
  const embed = createBlackjackEmbed(gameState, interaction.user);
  const components = createBlackjackComponents(gameId);
  
  // Envoyer le message
  await interaction.reply({
    embeds: [embed],
    components: [components]
  });
}

// Fonction pour gérer les actions du blackjack
async function handleBlackjackAction(interaction) {
  const [_, action, gameId] = interaction.customId.split('_');
  const gameState = activeBlackjackGames.get(gameId);
  
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

  const currentIndex = gameState.activeHandIndex;
  const currentHand = gameState.playerHands[currentIndex];

  // Gérer l'action du joueur
  if (action === 'hit') {
    // Le joueur tire une carte sur la main en cours
    currentHand.push(drawCard());
    const score = calculateHandValue(currentHand);
    
    // Vérifier si la main dépasse 21
    if (score > 21) {
      gameState.handStatuses[currentIndex] = 'bust';
      
      const nextIndex = gameState.handStatuses.findIndex((status, i) => status === 'playing' && i > currentIndex);
      if (nextIndex !== -1) {
        gameState.activeHandIndex = nextIndex;
      } else {
        // Toutes les mains sont résolues, c'est au tour du croupier
        gameState.isPlayerTurn = false;
        await playDealerTurn(gameState, interaction);
        return;
      }
    }
  } 
  else if (action === 'stand') {
    // Le joueur s'arrête sur la main en cours
    gameState.handStatuses[currentIndex] = 'stand';
    
    const nextIndex = gameState.handStatuses.findIndex((status, i) => status === 'playing' && i > currentIndex);
    if (nextIndex !== -1) {
      gameState.activeHandIndex = nextIndex;
    } else {
      // Toutes les mains sont résolues, c'est au tour du croupier
      gameState.isPlayerTurn = false;
      await playDealerTurn(gameState, interaction);
      return;
    }
  }
  else if (action === 'double') {
    // Le joueur double la mise sur la main en cours et tire une seule carte
    const user = ensureUser(gameState.userId, gameState.guildId);
    const currentBet = gameState.bets[currentIndex];
    if (user.balance < currentBet) {
      return interaction.reply({ 
        content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour doubler !`, 
        ephemeral: true 
      });
    }
    
    // Doubler la mise de cette main
    updateUser(gameState.userId, gameState.guildId, { balance: user.balance - currentBet });
    gameState.bets[currentIndex] = currentBet * 2;
    
    // Tirer une seule carte
    currentHand.push(drawCard());
    const score = calculateHandValue(currentHand);
    
    if (score > 21) {
      gameState.handStatuses[currentIndex] = 'bust';
    } else {
      // Après un double, le joueur doit rester sur cette main
      gameState.handStatuses[currentIndex] = 'stand';
    }

    const nextIndex = gameState.handStatuses.findIndex((status, i) => status === 'playing' && i > currentIndex);
    if (nextIndex !== -1) {
      gameState.activeHandIndex = nextIndex;
    } else {
      gameState.isPlayerTurn = false;
      await playDealerTurn(gameState, interaction);
      return;
    }
  }
  else if (action === 'split') {
    // Le joueur sépare sa main en deux (un seul split autorisé)
    if (gameState.hasSplit || gameState.playerHands.length !== 1 || currentHand.length !== 2) {
      return interaction.deferUpdate();
    }

    const [card1, card2] = currentHand;
    const value1 = CARD_VALUES[card1.value];
    const value2 = CARD_VALUES[card2.value];

    // Autoriser le split seulement si les cartes ont la même valeur de jeu
    if (value1 !== value2) {
      return interaction.reply({
        content: '❌ Vous ne pouvez splitter que deux cartes de même valeur.',
        ephemeral: true
      });
    }

    const user = ensureUser(gameState.userId);
    if (user.balance < gameState.baseBet) {
      return interaction.reply({
        content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour splitter !`,
        ephemeral: true
      });
    }

    // Débiter la deuxième mise
    updateUser(gameState.userId, gameState.guildId, { balance: user.balance - gameState.baseBet });

    // Créer deux mains séparées
    const hand1 = [card1, drawCard()];
    const hand2 = [card2, drawCard()];

    gameState.playerHands = [hand1, hand2];
    gameState.bets = [gameState.baseBet, gameState.baseBet];
    gameState.handStatuses = ['playing', 'playing'];
    gameState.activeHandIndex = 0;
    gameState.hasSplit = true;
  }
  
  // Mettre à jour l'affichage
  const embed = createBlackjackEmbed(gameState, interaction.user);
  const components = createBlackjackComponents(gameId);
  
  await interaction.update({
    embeds: [embed],
    components: [components]
  });
}

// Fonction pour gérer le tour du croupier
async function playDealerTurn(gameState, interaction) {
  // Révéler la deuxième carte du croupier
  gameState.dealerScore = calculateHandValue(gameState.dealerHand);
  
  // Le croupier tire des cartes jusqu'à atteindre au moins 17
  while (gameState.dealerScore < 17) {
    gameState.dealerHand.push(drawCard());
    gameState.dealerScore = calculateHandValue(gameState.dealerHand);
  }
  
  // Déterminer le résultat pour chaque main
  gameState.isGameOver = true;
  let totalWinnings = 0;
  let resultLines = [];
  const effectMultiplier = calculateEffectMultiplier(gameState.userId, gameState.guildId);

  gameState.playerHands.forEach((hand, index) => {
    const status = gameState.handStatuses[index];
    const bet = gameState.bets[index];
    const score = calculateHandValue(hand);

    if (status === 'bust') {
      // Vérifier la protection contre les pertes
      const hasProtection = checkLossProtection(gameState.userId, gameState.guildId, bet);
      if (hasProtection) {
        totalWinnings += bet; // Rembourser la mise
        resultLines.push(`Main ${index + 1}: **BUST** → 🫀 Cœur de Remplacement activé ! (mise remboursée)`);
      } else {
        resultLines.push(`Main ${index + 1}: **BUST** (perdu)`);
      }
      return;
    }

    if (gameState.dealerScore > 21) {
      // Croupier bust: joueur gagne 1:1
      let winnings = bet * 2; // mise retournée + gain égal à la mise
      winnings = Math.floor(winnings * effectMultiplier);
      totalWinnings += winnings;
      const bonusText = effectMultiplier > 1 ? ` (x${effectMultiplier.toFixed(2)})` : '';
      resultLines.push(`Main ${index + 1}: Croupier BUST → gagné (+${winnings} ${config.currency.emoji}${bonusText})`);
    } else if (score > gameState.dealerScore) {
      // Joueur gagne 1:1
      let winnings = bet * 2;
      winnings = Math.floor(winnings * effectMultiplier);
      totalWinnings += winnings;
      const bonusText = effectMultiplier > 1 ? ` (x${effectMultiplier.toFixed(2)})` : '';
      resultLines.push(`Main ${index + 1}: ${score} contre ${gameState.dealerScore} → gagné (+${winnings} ${config.currency.emoji}${bonusText})`);
    } else if (score < gameState.dealerScore) {
      // Vérifier la protection contre les pertes
      const hasProtection = checkLossProtection(gameState.userId, gameState.guildId, bet);
      if (hasProtection) {
        totalWinnings += bet; // Rembourser la mise
        resultLines.push(`Main ${index + 1}: ${score} contre ${gameState.dealerScore} → 🫀 Cœur de Remplacement activé ! (mise remboursée)`);
      } else {
        resultLines.push(`Main ${index + 1}: ${score} contre ${gameState.dealerScore} → perdu`);
      }
    } else {
      // Égalité: on rend la mise (push)
      totalWinnings += bet;
      resultLines.push(`Main ${index + 1}: ${score} contre ${gameState.dealerScore} → égalité (mise rendue)`);
    }
  });

  if (totalWinnings > 0) {
    const user = ensureUser(gameState.userId, gameState.guildId);
    updateUser(gameState.userId, gameState.guildId, { balance: user.balance + totalWinnings });
  }

  const result = resultLines.join('\n');
  
  // Mettre à jour l'affichage avec le résultat final
  const embed = createBlackjackEmbed(gameState, interaction.user, result);
  
  await interaction.update({
    embeds: [embed],
    components: []
  });
  
  // Supprimer la partie
  activeBlackjackGames.delete(gameIdFromInteraction(interaction));
}

// Fonction pour gérer un blackjack
async function handleBlackjack(gameState, interaction) {
  gameState.isGameOver = true;
  const bet = gameState.baseBet;
  const winnings = bet + Math.floor(bet * 1.5); // 3:2 = mise + 1.5x mise
  const user = ensureUser(gameState.userId, gameState.guildId);
  updateUser(gameState.userId, gameState.guildId, { balance: user.balance + winnings });
  
  const embed = createBlackjackEmbed(gameState, interaction.user, 'Blackjack ! Vous gagnez 3:2 !');
  
  await interaction.reply({
    embeds: [embed],
    components: []
  });
}

// Fonction utilitaire pour extraire l'ID de partie depuis une interaction
function gameIdFromInteraction(interaction) {
  const parts = interaction.customId.split('_');
  return parts[parts.length - 1];
}

// Fonction pour créer l'embed du blackjack
function createBlackjackEmbed(gameState, user, result = null) {
  const { playerHands, dealerHand, dealerScore, bets, isPlayerTurn, activeHandIndex, handStatuses, sideBet, sideBetResult, sideBetPayout } = gameState;
  
  const embed = new EmbedBuilder()
    .setTitle('🃏 BLACKJACK')
    .setColor(0x0099FF);
    
  // Afficher la main du croupier
  let dealerHandStr = isPlayerTurn 
    ? `${formatCard(dealerHand[0])} 🂠` // Cacher la deuxième carte si c'est le tour du joueur
    : dealerHand.map(card => formatCard(card)).join(' ');
    
  const dealerScoreStr = isPlayerTurn 
    ? `(${calculateHandValue([dealerHand[0]])}+?)` 
    : `(${dealerScore})`;
    
  // Construire la description
  let description = `**Croupier :** ${dealerHandStr} ${dealerScoreStr}\n\n`;

  playerHands.forEach((hand, index) => {
    const score = calculateHandValue(hand);
    const status = handStatuses[index];
    const bet = bets[index];
    const isActive = isPlayerTurn && index === activeHandIndex;

    let line = `**Main ${index + 1}${isActive ? ' (en cours)' : ''} :** ${hand.map(card => formatCard(card)).join(' ')} (${score})`;

    if (status === 'bust') {
      line += ' — **BUST**';
    }

    line += `\nMise : ${bet} ${config.currency.emoji}\n\n`;
    description += line;
  });
  
  if (sideBet && sideBet > 0) {
    description += `**Side bet Perfect Pairs :** ${sideBet} ${config.currency.emoji}`;
    if (sideBetResult) {
      description += `\nRésultat side bet : ${sideBetResult}`;
      if (sideBetPayout && sideBetPayout > 0) {
        description += ` (+${sideBetPayout} ${config.currency.emoji})`;
      }
    }
    description += '\n\n';
  }

  if (result) {
    description += `**Résultat :**\n${result}`;
  } else if (!isPlayerTurn) {
    description += 'Le croupier joue...';
  } else {
    description += 'Que souhaitez-vous faire ?';
  }
  
  // Ajouter le solde actuel du joueur
  const userData = ensureUser(gameState.userId, gameState.guildId);
  description += `\n**Solde actuel :** ${userData.balance} ${config.currency.emoji}`;

  embed.setDescription(description);
  
  // Ajouter une image en fonction du résultat
  if (result) {
    if (result.includes('Blackjack')) {
      embed.setThumbnail('https://imgur.com/gallery/easy-blackjack-OnJrGU9#bTwtAYh'); // Remplacez par une image de blackjack
    } else if (result.includes('gagn')) { // "gagnez" ou "gagné"
      embed.setThumbnail('https://imgur.com/gallery/finished-project-with-this-much-yarn-left-HUz1E#xuVfb2r'); // Remplacez par une image de victoire
    } else {
      embed.setThumbnail('https://imgur.com/gallery/face-of-defeat-lhajGzo'); // Remplacez par une image de défaite
    }
  }
  
  return embed;
}

// Fonction pour créer les composants du blackjack
function createBlackjackComponents(gameId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`blackjack_hit_${gameId}`)
      .setLabel('Tirer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`blackjack_stand_${gameId}`)
      .setLabel('Rester')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`blackjack_double_${gameId}`)
      .setLabel('Doubler')
      .setStyle(ButtonStyle.Danger)
  );

  // Bouton de split (sera simplement ignoré côté handler si non valide)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`blackjack_split_${gameId}`)
      .setLabel('Split')
      .setStyle(ButtonStyle.Secondary)
  );

  return row;
}

// Fonction pour tirer une carte aléatoire
function drawCard() {
  const values = Object.keys(CARD_VALUES);
  const suits = Object.keys(CARD_EMOJIS);
  
  const value = values[Math.floor(Math.random() * values.length)];
  const suit = suits[Math.floor(Math.random() * suits.length)];
  
  return { value, suit };
}

// Fonction pour calculer la valeur d'une main
function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;
  
  // Compter les cartes normales et les as
  for (const card of hand) {
    if (card.value === 'A') {
      aces++;
      value += 11; // Compter les As comme 11 par défaut
    } else {
      value += CARD_VALUES[card.value];
    }
  }
  
  // Ajuster la valeur des As si nécessaire
  while (value > 21 && aces > 0) {
    value -= 10; // Compter un As comme 1 au lieu de 11
    aces--;
  }
  
  return value;
}

// Fonction pour formater une carte
function formatCard(card) {
  return `${card.value}${CARD_EMOJIS[card.suit]}`;
}

// Nettoyer les anciennes parties inactives (appelé périodiquement)
function cleanupOldBlackjackGames() {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes d'inactivité
  
  for (const [gameId, game] of activeBlackjackGames.entries()) {
    if (now - game.lastAction > timeout) {
      // Rembourser le joueur si la partie n'est pas terminée
      if (!game.isGameOver) {
        updateUser(game.userId, game.guildId, { balance: ensureUser(game.userId, game.guildId).balance + game.bet });
      }
      activeBlackjackGames.delete(gameId);
    }
  }
}

// Nettoyer les anciennes parties toutes les 5 minutes
setInterval(cleanupOldBlackjackGames, 5 * 60 * 1000);

module.exports = {
  handleBlackjackStart,
  handleBlackjackAction,
  resolveBlackjack: (interaction) => {
    // Cette fonction est un placeholder et peut être implémentée plus tard
    // pour résoudre les problèmes de parties bloquées
    const gameId = interaction.customId.split('_')[1];
    const gameState = activeBlackjackGames.get(gameId);
    
    if (gameState) {
      // Rembourser le joueur (total des mises de toutes les mains)
      const totalBets = gameState.bets.reduce((sum, bet) => sum + bet, 0);
      updateUser(gameState.userId, { balance: ensureUser(gameState.userId).balance + totalBets });
      activeBlackjackGames.delete(gameId);
      
      return interaction.reply({
        content: `La partie a été résolue. Vos mises (${totalBets} ${config.currency.emoji}) vous ont été remboursées.`,
        ephemeral: true
      });
    }
    
    return interaction.reply({
      content: 'Aucune partie en cours trouvée.',
      ephemeral: true
    });
  }
};
