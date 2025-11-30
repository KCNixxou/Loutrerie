const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { 
  getGameConfig, 
  formatCurrency, 
  ensureUser, 
  updateUser, 
  calculateEffectMultiplier, 
  checkLossProtection,
  addUserEffect,
  getUserEffects,
  updateMissionProgress
} = require('../database');
const { 
  handleGameWin, 
  handleGameLose, 
  MISSION_EVENTS 
} = require('../utils/missionUtils');

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
      message: '🔪 **Double ou Crève** a réussi : vos gains ont été **doublés** sur cette main.'
    };
  }

  return {
    winnings: 0,
    message: '🔪 **Double ou Crève** a échoué : vous perdez **tous vos gains** sur cette main.'
  };
}

// Fonction pour démarrer une nouvelle partie de blackjack
async function handleBlackjackStart(interaction) {
  const bet = interaction.options.getInteger('mise');
  const perfectPairsBet = interaction.options.getInteger('perfect_pairs') || 0;
  const side21Bet = interaction.options.getInteger('side_21_3') || 0;
  const userId = interaction.user.id;
  const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
  const user = ensureUser(userId, guildId);

  const totalCost = bet + perfectPairsBet + side21Bet;

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

  // Mettre à jour les statistiques de jeu pour les missions
  const { updateUserGameStats } = require('../utils/missionUtils');
  updateUserGameStats(userId, 'blackjack');
  
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
    perfectPairsBet,
    perfectPairsResult: null,
    perfectPairsPayout: 0,
    side21Bet,
    side21Result: null,
    side21Payout: 0,
    insuranceBet: 0,
    insuranceResult: null,
    insurancePayout: 0
  };

  // Mettre à jour le solde de l'utilisateur (mise principale + side bet)
  updateUser(userId, guildId, { balance: user.balance - totalCost });

  // Résoudre immédiatement le side bet Perfect Pairs
  if (perfectPairsBet > 0) {
    const [card1, card2] = initialHand;
    let multiplier = 0;
    let resultLabel = 'Aucune paire';

    if (card1.value === card2.value) {
      const redSuits = ['H', 'D'];
      const isRed1 = redSuits.includes(card1.suit);
      const isRed2 = redSuits.includes(card2.suit);

      if (card1.suit === card2.suit) {
        // Paire parfaite (même valeur, même couleur) - payout classique 25:1
        multiplier = 25;
        resultLabel = 'Paire parfaite (25:1)';
      } else if ((isRed1 && isRed2) || (!isRed1 && !isRed2)) {
        // Paire de couleur (même valeur, même couleur rouge/noir) - payout classique 12:1
        multiplier = 12;
        resultLabel = 'Paire de couleur (12:1)';
      } else {
        // Paire mixte (même valeur, couleurs différentes) - payout classique 6:1
        multiplier = 6;
        resultLabel = 'Paire mixte (6:1)';
      }
    }

    if (multiplier > 0) {
      const sideWinnings = perfectPairsBet * multiplier;
      const current = ensureUser(userId, guildId);
      updateUser(userId, guildId, { balance: current.balance + sideWinnings });
      gameState.perfectPairsPayout = sideWinnings;
      gameState.perfectPairsResult = resultLabel;
    } else {
      gameState.perfectPairsResult = 'Perdu';
    }
  }

  // Résoudre immédiatement le side bet 21+3 (joueur + carte visible du croupier)
  if (side21Bet > 0) {
    const comboCards = [...initialHand, dealerHand[0]];
    const { multiplier: comboMult, label: comboLabel } = evaluate21Plus3(comboCards);
    if (comboMult > 0) {
      const sideWinnings = side21Bet * comboMult;
      const current = ensureUser(userId, guildId);
      updateUser(userId, guildId, { balance: current.balance + sideWinnings });
      gameState.side21Payout = sideWinnings;
      gameState.side21Result = comboLabel;
    } else {
      gameState.side21Result = 'Perdu';
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
  const components = createBlackjackComponents(gameId, gameState);
  
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

    // Créer deux mains séparées (deuxième main gratuite, pas de mise supplémentaire débitée)
    const hand1 = [card1, drawCard()];
    const hand2 = [card2, drawCard()];

    gameState.playerHands = [hand1, hand2];
    gameState.bets = [gameState.baseBet, 0]; // Deuxième main gratuite
    gameState.handStatuses = ['playing', 'playing'];
    gameState.activeHandIndex = 0;
    gameState.hasSplit = true;
  }
  else if (action === 'insurance') {
    // Achat de l'assurance : 50% de la mise de base
    if (gameState.insuranceBet > 0 || !gameState.isPlayerTurn) {
      return interaction.deferUpdate();
    }

    const user = ensureUser(gameState.userId, gameState.guildId);
    const maxInsurance = Math.floor(gameState.baseBet / 2);
    if (maxInsurance <= 0 || user.balance < maxInsurance) {
      return interaction.reply({
        content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour l'assurance.`,
        ephemeral: true
      });
    }

    updateUser(gameState.userId, gameState.guildId, { balance: user.balance - maxInsurance });
    gameState.insuranceBet = maxInsurance;
  }
  
  // Mettre à jour l'affichage
  const embed = createBlackjackEmbed(gameState, interaction.user);
  const components = createBlackjackComponents(gameId, gameState);
  
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
  let doubleOrNothingMessages = [];

  // Utiliser la mise de la première main pour le calcul des gains de toutes les mains
  const baseBet = gameState.bets[0];
  
  gameState.playerHands.forEach((hand, index) => {
    const status = gameState.handStatuses[index];
    const bet = baseBet; // Toujours utiliser la mise de la première main
    const score = calculateHandValue(hand);

    if (status === 'bust') {
      // Vérifier la protection contre les pertes
      const hasProtection = checkLossProtection(gameState.userId, gameState.guildId, bet);
      if (hasProtection) {
        totalWinnings += bet; // Rembourser la mise
        resultLines.push(`Main ${index + 1}: **BUST** → 🫀 Cœur de Remplacement activé ! (mise remboursée)`);
      } else {
        resultLines.push(`Main ${index + 1}: **BUST** (perdu)`);
        // Mettre à jour les missions pour la défaite
        handleGameLose(gameState.userId, 'blackjack', gameState.guildId);
      }
      return;
    }

    if (gameState.dealerScore > 21) {
      // Croupier bust: joueur gagne 1:1
      let winnings = bet * 2; // mise retournée + gain égal à la mise
      winnings = Math.floor(winnings * effectMultiplier);

      const doubleResult = applyDoubleOrNothing(gameState.userId, gameState.guildId, winnings);
      winnings = doubleResult.winnings;
      if (doubleResult.message) {
        doubleOrNothingMessages.push(`Main ${index + 1}: ${doubleResult.message}`);
      }

      totalWinnings += winnings;
      const bonusText = effectMultiplier > 1 ? ` (x${effectMultiplier.toFixed(2)})` : '';
      resultLines.push(`Main ${index + 1}: Croupier BUST → gagné (+${winnings} ${config.currency.emoji}${bonusText})`);
      // Mettre à jour les missions pour la victoire
      handleGameWin(gameState.userId, 'blackjack', gameState.guildId, winnings);
    } else if (score > gameState.dealerScore) {
      // Joueur gagne 1:1
      let winnings = bet * 2;
      winnings = Math.floor(winnings * effectMultiplier);

      const doubleResult = applyDoubleOrNothing(gameState.userId, gameState.guildId, winnings);
      winnings = doubleResult.winnings;
      if (doubleResult.message) {
        doubleOrNothingMessages.push(`Main ${index + 1}: ${doubleResult.message}`);
      }
      
      // Mettre à jour les missions
      handleGameWin(gameState.userId, 'blackjack', gameState.guildId, winnings);

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
        // Mettre à jour les missions pour la défaite
        handleGameLose(gameState.userId, 'blackjack', gameState.guildId);
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

  let result = resultLines.join('\n');

  if (doubleOrNothingMessages.length > 0) {
    result += `\n\n${doubleOrNothingMessages.join('\n')}`;
  }
  
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
  let winnings = bet + Math.floor(bet * 1.5); // 3:2 = mise + 1.5x mise
  const effectMultiplier = calculateEffectMultiplier(gameState.userId, gameState.guildId);
  winnings = Math.floor(winnings * effectMultiplier);

  const doubleResult = applyDoubleOrNothing(gameState.userId, gameState.guildId, winnings);
  winnings = doubleResult.winnings;
  const user = ensureUser(gameState.userId, gameState.guildId);
  updateUser(gameState.userId, gameState.guildId, { balance: user.balance + winnings });
  
  let resultText = 'Blackjack ! Vous gagnez 3:2 !';
  if (doubleResult.message) {
    resultText += `\n${doubleResult.message}`;
  }

  const embed = createBlackjackEmbed(gameState, interaction.user, resultText);
  
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
  const {
    playerHands,
    dealerHand,
    dealerScore,
    bets,
    isPlayerTurn,
    activeHandIndex,
    handStatuses,
    perfectPairsBet,
    perfectPairsResult,
    perfectPairsPayout,
    side21Bet,
    side21Result,
    side21Payout,
    insuranceBet,
    insuranceResult,
    insurancePayout
  } = gameState;
  
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
  
  if (perfectPairsBet && perfectPairsBet > 0) {
    description += `**Side bet Perfect Pairs :** ${perfectPairsBet} ${config.currency.emoji}`;
    if (perfectPairsResult) {
      description += `\nRésultat Perfect Pairs : ${perfectPairsResult}`;
      if (perfectPairsPayout && perfectPairsPayout > 0) {
        description += ` (+${perfectPairsPayout} ${config.currency.emoji})`;
      }
    }
    description += '\n\n';
  }

  if (insuranceBet && insuranceBet > 0) {
    description += `**Assurance :** ${insuranceBet} ${config.currency.emoji}`;
    if (insuranceResult) {
      description += `\nRésultat assurance : ${insuranceResult}`;
      if (insurancePayout && insurancePayout > 0) {
        description += ` (+${insurancePayout} ${config.currency.emoji})`;
      }
    }
    description += '\n\n';
  }

  if (side21Bet && side21Bet > 0) {
    description += `**Side bet 21+3 :** ${side21Bet} ${config.currency.emoji}`;
    if (side21Result) {
      description += `\nRésultat 21+3 : ${side21Result}`;
      if (side21Payout && side21Payout > 0) {
        description += ` (+${side21Payout} ${config.currency.emoji})`;
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

// Évaluation du side bet 21+3 (3-card poker à partir des 2 cartes joueur + 1 carte croupier)
function evaluate21Plus3(cards) {
  // cards: [{ value, suit }, ...] longueur 3
  if (!cards || cards.length !== 3) {
    return { multiplier: 0, label: 'Aucune combinaison' };
  }

  const values = cards.map(c => c.value);
  const suits = cards.map(c => c.suit);

  // Convertir en rangs pour détecter les suites
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const ranks = values.map(v => order.indexOf(v)).sort((a, b) => a - b);

  const allSameSuit = suits.every(s => s === suits[0]);
  const isThreeOfKind = values[0] === values[1] && values[1] === values[2];

  // Gérer A, 2, 3 comme suite
  let isStraight = false;
  if (ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2]) {
    isStraight = true;
  } else {
    // Cas spécial A, Q, K etc non considérés comme suite ici
    isStraight = false;
  }

  // Straight Flush
  if (allSameSuit && isStraight) {
    return { multiplier: 40, label: 'Straight Flush (40:1)' };
  }

  // Three of a kind
  if (isThreeOfKind) {
    return { multiplier: 30, label: 'Brelan (30:1)' };
  }

  // Straight
  if (isStraight) {
    return { multiplier: 10, label: 'Suite (10:1)' };
  }

  // Flush
  if (allSameSuit) {
    return { multiplier: 5, label: 'Couleur (5:1)' };
  }

  return { multiplier: 0, label: 'Aucune combinaison' };
}

// Fonction pour créer les composants du blackjack
function createBlackjackComponents(gameId, gameState) {
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

  // Bouton de split uniquement si la main en cours est splittable
  const { playerHands, activeHandIndex, hasSplit } = gameState;
  const currentHand = playerHands[activeHandIndex || 0];
  if (!hasSplit && playerHands.length === 1 && currentHand.length === 2) {
    const [c1, c2] = currentHand;
    const v1 = CARD_VALUES[c1.value];
    const v2 = CARD_VALUES[c2.value];
    if (v1 === v2) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`blackjack_split_${gameId}`)
          .setLabel('Split')
          .setStyle(ButtonStyle.Secondary)
      );
    }
  }

  // Bouton d'assurance si le croupier montre un As et que l'assurance n'est pas encore prise
  if (gameState.isPlayerTurn && gameState.insuranceBet === 0 && gameState.dealerHand && gameState.dealerHand[0]?.value === 'A') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`blackjack_insurance_${gameId}`)
        .setLabel('Assurance')
        .setStyle(ButtonStyle.Secondary)
    );
  }

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
