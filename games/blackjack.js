const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

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

// Fonction pour démarrer une nouvelle partie de blackjack
async function handleBlackjackStart(interaction) {
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
  
  // Distribuer les cartes initiales
  const playerHand = [drawCard(), drawCard()];
  const dealerHand = [drawCard(), drawCard()];
  
  const gameState = {
    userId,
    bet,
    playerHand,
    dealerHand,
    playerScore: calculateHandValue(playerHand),
    dealerScore: calculateHandValue([dealerHand[0]]), // Seulement la première carte du croupier est visible
    isPlayerTurn: true,
    isGameOver: false,
    lastAction: Date.now()
  };

  // Mettre à jour le solde de l'utilisateur
  updateUser(userId, { balance: user.balance - bet });
  
  // Vérifier le blackjack immédiat
  if (gameState.playerScore === 21) {
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
  
  // Gérer l'action du joueur
  if (action === 'hit') {
    // Le joueur tire une carte
    gameState.playerHand.push(drawCard());
    gameState.playerScore = calculateHandValue(gameState.playerHand);
    
    // Vérifier si le joueur a dépassé 21
    if (gameState.playerScore > 21) {
      return handleBust(gameState, interaction);
    }
  } 
  else if (action === 'stand') {
    // Le joueur s'arrête, c'est au tour du croupier
    gameState.isPlayerTurn = false;
    await playDealerTurn(gameState, interaction);
    return; // La fonction playDealerTurn gère déjà la mise à jour de l'interaction
  }
  else if (action === 'double') {
    // Le joueur double sa mise et tire une seule carte
    const user = ensureUser(gameState.userId);
    if (user.balance < gameState.bet) {
      return interaction.reply({ 
        content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour doubler !`, 
        ephemeral: true 
      });
    }
    
    // Doubler la mise
    updateUser(gameState.userId, { balance: user.balance - gameState.bet });
    gameState.bet *= 2;
    
    // Tirer une seule carte
    gameState.playerHand.push(drawCard());
    gameState.playerScore = calculateHandValue(gameState.playerHand);
    
    // Vérifier si le joueur a dépassé 21
    if (gameState.playerScore > 21) {
      return handleBust(gameState, interaction);
    }
    
    // Le joueur ne peut plus tirer après avoir doublé
    gameState.isPlayerTurn = false;
    await playDealerTurn(gameState, interaction);
    return; // La fonction playDealerTurn gère déjà la mise à jour de l'interaction
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
  
  // Déterminer le résultat
  gameState.isGameOver = true;
  let result;
  
  if (gameState.dealerScore > 21) {
    result = 'Le croupier a dépassé 21 ! Vous gagnez !';
    const winnings = gameState.bet * 2;
    updateUser(gameState.userId, { balance: ensureUser(gameState.userId).balance + winnings });
  } 
  else if (gameState.dealerScore > gameState.playerScore) {
    result = 'Le croupier gagne avec un meilleur score !';
  } 
  else if (gameState.dealerScore < gameState.playerScore) {
    result = 'Vous gagnez avec un meilleur score !';
    const winnings = gameState.bet * 2;
    updateUser(gameState.userId, { balance: ensureUser(gameState.userId).balance + winnings });
  } 
  else {
    result = 'Égalité ! Votre mise vous est rendue.';
    updateUser(gameState.userId, { balance: ensureUser(gameState.userId).balance + gameState.bet });
  }
  
  // Mettre à jour l'affichage avec le résultat final
  const embed = createBlackjackEmbed(gameState, interaction.user, result);
  
  await interaction.update({
    embeds: [embed],
    components: []
  });
  
  // Supprimer la partie
  activeBlackjackGames.delete(interaction.customId.split('_')[2]);
}

// Fonction pour gérer un blackjack
async function handleBlackjack(gameState, interaction) {
  gameState.isGameOver = true;
  const winnings = Math.floor(gameState.bet * 2.5); // Paiement 3:2 pour un blackjack
  updateUser(gameState.userId, { balance: ensureUser(gameState.userId).balance + winnings });
  
  const embed = createBlackjackEmbed(gameState, interaction.user, 'Blackjack ! Vous gagnez 3:2 !');
  
  await interaction.reply({
    embeds: [embed],
    components: []
  });
}

// Fonction pour gérer un dépassement (bust)
async function handleBust(gameState, interaction) {
  gameState.isGameOver = true;
  gameState.isPlayerTurn = false;
  
  const embed = createBlackjackEmbed(gameState, interaction.user, 'Dépassement ! Vous avez perdu votre mise.');
  
  await interaction.update({
    embeds: [embed],
    components: []
  });
  
  // Supprimer la partie
  activeBlackjackGames.delete(interaction.customId.split('_')[2]);
}

// Fonction pour créer l'embed du blackjack
function createBlackjackEmbed(gameState, user, result = null) {
  const { playerHand, dealerHand, playerScore, dealerScore, bet, isPlayerTurn } = gameState;
  
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
    
  // Afficher la main du joueur
  const playerHandStr = playerHand.map(card => formatCard(card)).join(' ');
  
  // Construire la description
  let description = `**Croupier :** ${dealerHandStr} ${dealerScoreStr}\n`;
  description += `**Votre main :** ${playerHandStr} (${playerScore})\n`;
  description += `**Mise :** ${bet} ${config.currency.emoji}\n\n`;
  
  if (result) {
    description += `**Résultat :** ${result}`;
    if (result.includes('gagnez')) {
      const winnings = result.includes('Blackjack') 
        ? Math.floor(bet * 2.5)
        : bet * 2;
      description += `\n💰 **Gains :** ${winnings} ${config.currency.emoji}`;
    }
  } else if (!isPlayerTurn) {
    description += 'Le croupier joue...';
  } else {
    description += 'Que souhaitez-vous faire ?';
  }
  
  embed.setDescription(description);
  
  // Ajouter une image en fonction du résultat
  if (result) {
    if (result.includes('Blackjack')) {
      embed.setThumbnail('https://i.imgur.com/xyz1234.png'); // Remplacez par une image de blackjack
    } else if (result.includes('gagnez')) {
      embed.setThumbnail('https://i.imgur.com/abc5678.png'); // Remplacez par une image de victoire
    } else {
      embed.setThumbnail('https://i.imgur.com/def9012.png'); // Remplacez par une image de défaite
    }
  }
  
  return embed;
}

// Fonction pour créer les composants du blackjack
function createBlackjackComponents(gameId) {
  return new ActionRowBuilder().addComponents(
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
        updateUser(game.userId, { balance: ensureUser(game.userId).balance + game.bet });
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
      // Rembourser le joueur
      updateUser(gameState.userId, { balance: ensureUser(gameState.userId).balance + gameState.bet });
      activeBlackjackGames.delete(gameId);
      
      return interaction.reply({
        content: 'La partie a été résolue. Votre mise vous a été remboursée.',
        ephemeral: true
      });
    }
    
    return interaction.reply({
      content: 'Aucune partie en cours trouvée.',
      ephemeral: true
    });
  }
};
