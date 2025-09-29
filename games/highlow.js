const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

// Stockage des parties en cours
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

// Fonction utilitaire pour clôturer une partie High Low
function endHighLowGame(gameId, interaction, isAdmin = false) {
  const game = activeHighLowGames.get(gameId);
  if (!game) {
    if (interaction) {
      interaction.reply({ 
        content: '❌ Partie introuvable ou déjà terminée.', 
        ephemeral: true 
      });
    }
    return false;
  }

  const user = ensureUser(game.userId);
  const netWinnings = game.totalWon - game.initialBet;
  
  // Créditer les gains totaux
  updateUser(game.userId, { balance: user.balance + game.totalWon });
  
  // Supprimer la partie
  activeHighLowGames.delete(gameId);
  
  if (interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🎴 High Low - Partie clôturée' + (isAdmin ? ' (par un administrateur)' : ''))
      .setDescription(`La partie a été clôturée avec un gain net de **${netWinnings} ${config.currency.emoji}** !\n(Mise initiale: ${game.initialBet} + Gains: ${netWinnings})` )
      .setColor(0xf1c40f);
    
    interaction.update({ 
      embeds: [embed], 
      components: [] 
    });
  }
  
  return true;
}

// Fonction utilitaire pour créer un jeu de cartes
function createDeck() {
  const deck = [];
  for (const suit of CARD_SUITS) {
    for (const value of CARD_VALUES) {
      deck.push({ value, suit });
    }
  }
  // Mélanger le jeu
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Fonction pour comparer deux cartes
function compareCards(card1, card2, action) {
  const value1 = getCardValue(card1);
  const value2 = getCardValue(card2);
  
  if (action === 'same') {
    return { result: value1 === value2, sameCard: true };
  } else if (action === 'higher') {
    return { result: value2 > value1, sameCard: false };
  } else { // lower
    return { result: value2 < value1, sameCard: false };
  }
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

// Fonction pour formater une carte avec son emoji
function formatCard(card) {
  if (!card) return 'Aucune carte';
  const suitEmoji = CARD_EMOJIS[card.suit] || card.suit;
  return `${card.value}${suitEmoji}`;
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

// Fonction utilitaire pour formater un montant avec l'emoji de la devise
function formatCurrency(amount) {
  return `${amount} ${config.currency.emoji}`;
}

// Fonction utilitaire pour créer un champ de gain formaté
function createWinningsField(label, amount, inline = true) {
  return { 
    name: label, 
    value: formatCurrency(amount), 
    inline: inline 
  };
}

// Gestion du jeu High Low
// Gérer les actions du jeu High Low
async function handleHighLowAction(interaction) {
  console.log('[HighLow] handleHighLowAction called');
  console.log('[HighLow] Interaction customId:', interaction.customId);
  
  // Vérifier si c'est une interaction spéciale
  const isSpecial = interaction.customId.startsWith('special_highlow_');
  const prefix = isSpecial ? 'special_highlow_' : 'highlow_';
  
  // Extraire l'action (lower/same/higher) et l'ID de jeu complet
  const actionMatch = interaction.customId.match(new RegExp(`^${prefix}(lower|same|higher)_(.*)`));
  if (!actionMatch) {
    console.error('[HighLow] Invalid customId format:', interaction.customId);
    return interaction.reply({ content: '❌ Format de commande invalide.', ephemeral: true });
  }
  
  const action = actionMatch[1];
  const gameId = actionMatch[2];
  console.log('[HighLow] Action:', action, 'Game ID:', gameId);
  
  const game = activeHighLowGames.get(gameId);
  console.log('[HighLow] Game found:', !!game);
  
  if (!game) {
    return interaction.update({
      content: '❌ Partie introuvable ou expirée.',
      components: []
    });
  }
  
  if (game.userId !== interaction.user.id) {
    // Vérifier si c'est un administrateur qui tente de clôturer la partie
    if (interaction.customId && interaction.customId.startsWith('admin_close_')) {
      const { specialHighLow } = require('./config');
      if (!specialHighLow.isAdmin(interaction.user.id)) {
        console.log(`[Security] Tentative d'accès non autorisée à la commande admin par ${interaction.user.id}`);
        return interaction.reply({
          content: '❌ Vous n\'avez pas la permission de clôturer cette partie.',
          ephemeral: true
        });
      }
      // L'admin peut clôturer la partie
      return endHighLowGame(gameId, interaction, true);
    }
    
    // Pour le High Low spécial, vérifier les permissions spéciales
    if (game.isSpecial) {
      const { specialHighLow } = require('./config');
      const isAdminOrSpecialUser = specialHighLow.isAdmin(interaction.user.id) || 
                                 interaction.user.id === specialHighLow.specialUserId;
      
      if (!isAdminOrSpecialUser) {
        console.log(`[Security] Tentative d'accès non autorisée au High Low spécial par ${interaction.user.id}`);
        return interaction.reply({
          content: '❌ Vous n\'avez pas la permission d\'interagir avec cette partie.',
          ephemeral: true
        });
      }
    }
    
    return interaction.reply({
      content: '❌ Ce n\'est pas votre partie !',
      ephemeral: true
    });
  }
  
  // Tirer une nouvelle carte
  console.log('[HighLow] Current card:', game.currentCard);
  const newCard = game.deck.pop();
  console.log('[HighLow] New card drawn:', newCard);
  
  // Utiliser la fonction compareCards pour gérer les comparaisons
  const { result: userWon, sameCard } = compareCards(game.currentCard, newCard, action);
  
  // Déterminer le résultat pour l'affichage
  const currentValue = getCardValue(game.currentCard);
  const newValue = getCardValue(newCard);
  let result;
  
  if (newValue > currentValue) result = 'higher';
  else if (newValue < currentValue) result = 'lower';
  else result = 'same';
  
  console.log(`[HighLow] Current: ${game.currentCard.value} (${currentValue}), New: ${newCard.value} (${newValue}), Action: ${action}, Result: ${result}, Same: ${sameCard}`);
  console.log('[HighLow] User won:', userWon, 'Same card:', sameCard);
  
  // Calculer les gains
  if (userWon) {
    let multiplier;
    
    // Utiliser le multiplicateur actuel s'il existe, sinon initialiser
    const currentMultiplier = game.currentMultiplier || 1.0;
    
    if (sameCard) {
      // Multiplicateur spécial pour un pari sur "égal"
      multiplier = 13.0;
    } else {
      // Si le multiplicateur actuel est 13.0 (suite à un "égal"), on continue à partir de 13.0
      if (currentMultiplier >= 13.0) {
        multiplier = currentMultiplier + 3.0;
      } else {
        // Définir les multiplicateurs pour les premiers tours
        const multipliers = [1.5, 1.75, 2.0, 2.5, 4.0]; // Multiplicateurs pour les 5 premiers tours
        const round = game.round || 1; // Commence à 1
        
        // Si on est dans les 5 premiers tours, prendre la valeur du tableau
        // Sinon, continuer à ajouter 0.5 au dernier multiplicateur
        if (round <= multipliers.length) {
          multiplier = multipliers[round - 1];
        } else {
          const lastMultiplier = 4.0; // Dernier multiplicateur fixé à 4.0
          multiplier = lastMultiplier + (0.5 * (round - multipliers.length));
        }
      }
    }
    
    // Mettre à jour le multiplicateur dans l'objet de jeu
    game.currentMultiplier = multiplier;
    
    // Calculer le gain potentiel total (sans créditer encore)
    const potentialWinnings = Math.floor(game.currentBet * multiplier);
    game.totalWon = potentialWinnings; // Mettre à jour le total potentiel
    
    // Sauvegarder la carte actuelle avant de la remplacer
    game.previousCard = game.currentCard;
    // Mettre à jour le jeu avec la nouvelle carte
    game.currentCard = newCard;
    game.currentMultiplier = multiplier;
    // Ne pas incrémenter le round si on est déjà en mode multiplicateur élevé
    if (currentMultiplier < 13.0) {
      game.round = (game.round || 1) + 1;
    }
    game.potentialWinnings = potentialWinnings; // Stocker les gains potentiels
    console.log('[HighLow] Game updated - New multiplier:', multiplier, 'Total won:', game.totalWon);
    
    // Créer les boutons pour continuer ou s'arrêter
    const buttonPrefix = game.isSpecial ? 'special_highlow_' : 'highlow_';
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`${buttonPrefix}stop_${gameId}`)
          .setLabel('🏁 Petite couille')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑'),
        new ButtonBuilder()
          .setCustomId(`${buttonPrefix}continue_${gameId}`)
          .setLabel('ENVOIE LA NEXT')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎲')
      );
    
    // Créer l'embed de résultat
    const resultEmbed = new EmbedBuilder()
      .setTitle('🎴 High Low - Résultat')
      .setDescription(`**Carte précédente:** ${formatCard(game.previousCard)}\n**Nouvelle carte:** ${formatCard(newCard)}\n\n✅ **Vous avez gagné !**`)
      .addFields(
        { name: 'Multiplicateur', value: `${multiplier.toFixed(2)}x`, inline: true },
        { name: 'Gains potentiels', value: formatCurrency(potentialWinnings), inline: true },
        { name: 'Mise initiale', value: formatCurrency(game.initialBet), inline: true }
      )
      .setColor(0x57F287); // Vert pour la victoire
    
    // Mettre à jour le message avec les boutons
    await interaction.update({
      embeds: [resultEmbed],
      components: [row]
    });
    
  } else {
    // Le joueur a perdu
    const user = ensureUser(game.userId);
    const updatedBalance = user.balance - game.currentBet;
    
    // Mettre à jour le solde de l'utilisateur
    updateUser(game.userId, { balance: updatedBalance });
    
    const lossEmbed = new EmbedBuilder()
      .setTitle('🎴 High Low - Partie terminée')
      .setDescription(`**Dernière carte:** ${formatCard(game.currentCard)}\n**Nouvelle carte:** ${formatCard(newCard)}\n\n❌ **Vous avez perdu !**`)
      .addFields(
        { name: 'Mise perdue', value: formatCurrency(game.currentBet), inline: true },
        { name: 'Gains totaux', value: formatCurrency(0), inline: true },
        { name: 'Nouveau solde', value: formatCurrency(updatedBalance), inline: false }
      )
      .setColor(0xED4245) // Rouge pour la défaite
      .setFooter({ 
        text: `Solde mis à jour: ${formatCurrency(updatedBalance)}`,
        iconURL: interaction.user.displayAvatarURL() 
      });
    
    // Supprimer la partie
    activeHighLowGames.delete(gameId);
    
    // Mettre à jour le message final
    await interaction.update({
      embeds: [lossEmbed],
      components: []
    });
  }
}

// Gestion des interactions de boutons pour High Low (gère à la fois les actions et les décisions)
async function handleHighLowInteraction(interaction) {
  console.log('[HighLow] handleHighLowInteraction called');
  console.log('[HighLow] Interaction customId:', interaction.customId);
  
  // Vérifier si c'est une interaction spéciale (highlow spécial)
  const isSpecial = interaction.customId.startsWith('special_highlow_');
  const prefix = isSpecial ? 'special_highlow_' : 'highlow_';
  
  // Vérifier le type d'interaction (action ou décision)
  if (interaction.customId.startsWith(`${prefix}stop_`) || interaction.customId.startsWith(`${prefix}continue_`)) {
    // C'est une décision (continuer ou s'arrêter)
    return handleHighLowDecision(interaction);
  } else {
    // C'est une action (plus haut/plus bas/égal)
    return handleHighLowAction(interaction);
  }
}

// Fonction pour gérer la décision de continuer ou de s'arrêter
async function handleHighLowDecision(interaction) {
  console.log('[HighLow] handleHighLowDecision called');
  console.log('[HighLow] Interaction customId:', interaction.customId);
  
  // Vérifier si c'est une interaction spéciale
  const isSpecial = interaction.customId.startsWith('special_highlow_');
  const prefix = isSpecial ? 'special_highlow_' : 'highlow_';
  
  // Extraire l'action (stop/continue) et l'ID de jeu complet
  const actionMatch = interaction.customId.match(new RegExp(`^${prefix}(stop|continue)_(.*)`));
  if (!actionMatch) {
    console.error('[HighLow] Invalid customId format in decision:', interaction.customId);
    return interaction.reply({ content: '❌ Format de commande invalide.', ephemeral: true });
  }
  
  const action = actionMatch[1];
  const gameId = actionMatch[2];
  console.log('[HighLow] Decision action:', action, 'Game ID:', gameId);
  
  const gameState = activeHighLowGames.get(gameId);
  console.log('[HighLow] Game state found:', !!gameState);
  
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
      const winnings = Math.floor(gameState.currentBet * gameState.currentMultiplier);
      const user = ensureUser(gameState.userId);
      
      // Calculer le nouveau solde
      const newBalance = user.balance + (gameState.totalWon || winnings);
      
      // Mettre à jour le solde du joueur
      updateUser(gameState.userId, { balance: newBalance });
      
      // Créer l'embed de fin de partie
      const embed = new EmbedBuilder()
        .setTitle('🏁 High Low - Partie terminée')
        .setColor(0x57F287) // Vert Discord
        .setDescription(
          `✅ **Cashout effectué avec succès !**\n` +
          `💰 **Gains :** ${winnings} ${config.currency.emoji}\n` +
          `📈 **Multiplicateur final :** x${gameState.currentMultiplier.toFixed(2)}\n` +
          `💵 **Nouveau solde :** ${newBalance} ${config.currency.emoji}`
        )
        .setFooter({ 
          text: `Joueur: ${interaction.user.username} | Mise initiale: ${gameState.initialBet} ${config.currency.emoji}`,
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
      const embed = new EmbedBuilder()
        .setTitle('🎴 High Low - Tour suivant')
        .setDescription(`**Carte actuelle:** ${formatCard(gameState.currentCard)}\n\nChoisissez si la prochaine carte sera plus haute, plus basse ou égale.`)
        .addFields(
          { name: 'Mise', value: formatCurrency(gameState.currentBet), inline: true },
          { name: 'Multiplicateur actuel', value: `${gameState.currentMultiplier.toFixed(2)}x`, inline: true },
          { name: 'Gains potentiels', value: formatCurrency(Math.floor(gameState.currentBet * gameState.currentMultiplier)), inline: true }
        )
        .setColor(0x3498DB); // Bleu pour le tour suivant
      
      // Créer les boutons d'action
      const buttonPrefix = gameState.isSpecial ? 'special_highlow_' : 'highlow_';
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`${buttonPrefix}lower_${gameState.id}`)
            .setLabel('Plus bas')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⬇️'),
          new ButtonBuilder()
            .setCustomId(`${buttonPrefix}same_${gameState.id}`)
            .setLabel('Égal')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🟰'),
          new ButtonBuilder()
            .setCustomId(`${buttonPrefix}higher_${gameState.id}`)
            .setLabel('Plus haut')
            .setStyle(ButtonStyle.Success)
            .setEmoji('⬆️')
        );
      
      // Mettre à jour l'état du jeu avant de sauvegarder
      gameState.lastAction = Date.now();
      
      // Sauvegarder l'état actuel du jeu AVANT de mettre à jour le message
      activeHighLowGames.set(gameId, gameState);
      
      console.log(`[HighLow] Game ${gameId} updated for next round`);
      
      // Mettre à jour le message pour le prochain tour
      try {
        await interaction.update({
          embeds: [embed],
          components: [row],
          content: '🔄 En attente de votre prochain choix...' // Message de transition
        });
      } catch (error) {
        console.error('Erreur lors de la mise à jour du message pour le prochain tour:', error);
        // Essayer de récupérer l'erreur
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ Une erreur est survenue lors de la préparation du prochain tour. Veuillez réessayer.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Une erreur est survenue lors de la préparation du prochain tour. Veuillez réessayer.',
            ephemeral: true
          });
        }
      }
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

// Fonction pour démarrer une nouvelle partie de High Low
async function handleHighLow(interaction, isSpecial = false) {
  const bet = parseInt(interaction.options.getInteger('mise'));
  const userId = interaction.user.id;
  
  // Vérifier la mise minimale
  if (bet < 10) {
    return interaction.reply({
      content: '❌ La mise minimale est de 10 ' + config.currency.emoji,
      ephemeral: true
    });
  }
  
  // Vérifier le solde du joueur
  const user = ensureUser(userId);
  
  if (isSpecial) {
    const { getSpecialBalance, updateSpecialBalance } = require('./database');
    const specialBalance = getSpecialBalance(userId);
    
    if (specialBalance < bet) {
      return interaction.reply({
        content: `❌ Vous n'avez pas assez de solde spécial pour cette mise. (Solde: ${specialBalance} ${config.currency.emoji})`,
        ephemeral: true
      });
    }
    
    // Déduire la mise du solde spécial
    updateSpecialBalance(userId, -bet);
  } else {
    if (user.balance < bet) {
      return interaction.reply({
        content: `❌ Vous n'avez pas assez de solde pour cette mise. (Solde: ${user.balance} ${config.currency.emoji})`,
        ephemeral: true
      });
    }
    
    // Déduire la mise du solde normal
    updateUser(userId, { balance: user.balance - bet });
  }
  
  // Créer un nouvel ID de partie
  const gameId = `${userId}-${Date.now()}`;
  
  // Créer un nouveau jeu
  const game = {
    id: gameId,
    userId,
    isSpecial,
    deck: createDeck(),
    currentBet: bet,
    initialBet: bet,
    totalWon: 0,
    currentMultiplier: 1.0,
    round: 1,
    createdAt: Date.now(),
    lastAction: Date.now()
  };
  
  // Tirer la première carte
  game.currentCard = game.deck.pop();
  game.previousCard = null;
  
  // Stocker la partie
  activeHighLowGames.set(gameId, game);
  
  // Créer les boutons d'action
  const buttonPrefix = isSpecial ? 'special_highlow_' : 'highlow_';
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${buttonPrefix}lower_${gameId}`)
        .setLabel('Plus bas')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⬇️'),
      new ButtonBuilder()
        .setCustomId(`${buttonPrefix}same_${gameId}`)
        .setLabel('Égal')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🟰'),
      new ButtonBuilder()
        .setCustomId(`${buttonPrefix}higher_${gameId}`)
        .setLabel('Plus haut')
        .setStyle(ButtonStyle.Success)
        .setEmoji('⬆️')
    );
  
  // Créer l'embed de la partie
  const embed = new EmbedBuilder()
    .setTitle('🎴 High Low' + (isSpecial ? ' Spécial' : '') + ' - Nouvelle partie')
    .setDescription(`**Carte actuelle:** ${formatCard(game.currentCard)}\n\nChoisissez si la prochaine carte sera plus haute, plus basse ou égale.`)
    .addFields(
      { name: 'Mise', value: formatCurrency(bet), inline: true },
      { name: 'Multiplicateur', value: '1.00x', inline: true },
      { name: 'Gains potentiels', value: formatCurrency(bet), inline: true }
    )
    .setFooter({ 
      text: `Joueur: ${interaction.user.username} | Utilisez les boutons ci-dessous pour jouer`,
      iconURL: interaction.user.displayAvatarURL()
    })
    .setColor(isSpecial ? 0x9B59B6 : 0x3498DB); // Violet pour le mode spécial, bleu pour le mode normal
  
  // Répondre avec l'embed et les boutons
  await interaction.reply({
    embeds: [embed],
    components: [row]
  });
}

// Fonction pour vérifier si l'utilisateur a accès au High Low spécial
function hasSpecialAccess(userId, channelId) {
  const { specialHighLow } = require('./config');
  
  // Vérifier si l'utilisateur est un administrateur
  if (specialHighLow.isAdmin(userId)) {
    return true;
  }
  
  // Vérifier si l'utilisateur est l'utilisateur spécial
  if (userId === specialHighLow.specialUserId) {
    return true;
  }
  
  // Vérifier si le canal est autorisé
  if (specialHighLow.allowedChannels && specialHighLow.allowedChannels.includes(channelId)) {
    return true;
  }
  
  return false;
}

// Gestion du High Low spécial
async function handleSpecialHighLow(interaction) {
  // Vérifier si l'utilisateur a accès au High Low spécial
  if (!hasSpecialAccess(interaction.user.id, interaction.channelId)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas accès au High Low Spécial.',
      ephemeral: true
    });
  }
  
  // Déléguer à la fonction handleHighLow avec isSpecial = true
  return handleHighLow(interaction, true);
}

// Nettoyer les anciennes parties inactives toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes d'inactivité
  
  for (const [gameId, game] of activeHighLowGames.entries()) {
    if (now - (game.lastAction || game.createdAt) > timeout) {
      console.log(`[HighLow] Nettoyage de la partie inactive: ${gameId}`);
      
      // Rembourser le joueur s'il y a des gains non réclamés
      if (game.totalWon > 0) {
        if (game.isSpecial) {
          const { addSpecialWinnings } = require('./database');
          addSpecialWinnings(game.userId, game.totalWon);
          console.log(`[HighLow] Remboursement spécial de ${game.totalWon} à l'utilisateur ${game.userId}`);
        } else {
          const user = ensureUser(game.userId);
          updateUser(game.userId, { balance: user.balance + game.totalWon });
          console.log(`[HighLow] Remboursement de ${game.totalWon} à l'utilisateur ${game.userId}`);
        }
      }
      
      // Supprimer la partie
      activeHighLowGames.delete(gameId);
    }
  }
}, 5 * 60 * 1000);

// Alias pour la compatibilité avec le code existant
const handleSpecialHighLowAlias = handleHighLow;

// Exporter les fonctions nécessaires
module.exports = {
  handleHighLow,
  handleSpecialHighLow: handleSpecialHighLowAlias,
  handleHighLowAction: handleHighLowInteraction,
  handleHighLowDecision,
  hasSpecialAccess
};
