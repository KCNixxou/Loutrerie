const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

// Objet pour stocker les parties en cours
const activeMultiMinesGames = new Map();

// Constantes du jeu
const GRID_SIZE = 4; // Taille de la grille de jeu (4x4)
const MINE_EMOJI = '💣';
const GEM_EMOJI = '💎';
const HIDDEN_EMOJI = '⬛';
const PLAYER1_EMOJI = '🔴';
const PLAYER2_EMOJI = '🔵';
const WAITING_EMOJI = '⏳';

// Commande pour démarrer une nouvelle partie
async function handleMinesMultiCommand(interaction) {
  const bet = interaction.options.getInteger('mise');
  
  if (!bet || bet <= 0) {
    await interaction.reply({ 
      content: '❌ Veuillez spécifier une mise valide !', 
      ephemeral: true 
    });
    return;
  }
  
  const gameState = await createGame(interaction, bet);
  
  if (!gameState) return;
  
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mines_multi_join_${gameState.id}`)
        .setLabel('Rejoindre la partie')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Primary)
    )
  ];
  const embed = createGameEmbed(gameState);
  
  await interaction.reply({ 
    content: `🎮 **Nouvelle partie de Mines Multijoueur !**\n` +
      `**Mise :** ${bet} ${config.currency.emoji}\n` +
      `Cliquez sur le bouton ci-dessous pour rejoindre la partie contre <@${gameState.player1.id}> !`,
    embeds: [embed],
    components: components
  });
}

// Gérer l'interaction des boutons du jeu
async function handleMinesMultiInteraction(interaction) {
  try {
    console.log('Interaction reçue:', interaction.customId);
    
    console.log(`Custom ID complet: ${interaction.customId}`);
    const parts = interaction.customId.split('_');
    console.log('Parts du custom ID:', parts);
    
    // Vérifier le format du customId
    // Format pour rejoindre: mines_multi_join_<gameId>
    // Format pour cliquer: mines_multi_<gameId>_<x>_<y>
    // Format pour quitter: mines_multi_<gameId>_quit
    
    let action, gameId, x, y, isQuit = false;
    
    if (parts[2] === 'join' && parts.length >= 4) {
      // Format: mines_multi_join_<gameId>
      action = 'join';
      gameId = parts[3];
    } else if (parts.length >= 5) {
      // Format: mines_multi_<gameId>_<x>_<y>
      action = 'click';
      gameId = parts[2];
      x = parseInt(parts[3]);
      y = parseInt(parts[4]);
      
      if (isNaN(x) || isNaN(y)) {
        console.log('Coordonnées de case invalides:', parts[3], parts[4]);
        return;
      }
    } else if (parts.length === 4 && parts[3] === 'quit') {
      // Format: mines_multi_<gameId>_quit
      action = 'quit';
      gameId = parts[2];
      isQuit = true;
    } else {
      console.log('Format de custom ID invalide:', interaction.customId);
      return;
    }
    
    if (!gameId) {
      console.log('Aucun ID de jeu fourni');
      return;
    }
    
    console.log(`Action: ${action}, Game ID: ${gameId} (type: ${typeof gameId})`);
    if (action === 'click') {
      console.log(`Coordonnées: x=${x}, y=${y}`);
    }
    
    // Gérer la demande de rejoindre une partie
    if (action === 'join') {
      console.log(`=== TENTATIVE DE REJOINDRE UNE PARTIE ===`);
      console.log(`Partie ID: ${gameId} (type: ${typeof gameId})`);
      console.log(`Utilisateur: ${interaction.user.username} (${interaction.user.id})`);
      
      // Mettre à jour l'interaction immédiatement pour éviter l'expiration
      try {
        await interaction.deferUpdate();
        console.log('Interaction différée avec succès');
      } catch (error) {
        console.error('Erreur lors du différé de l\'interaction:', error);
        return;
      }
      
      // Vérifier d'abord si la partie existe
      let gameState = activeMultiMinesGames.get(gameId);
      
      // Si la partie n'est pas trouvée directement, essayer de la trouver avec une correspondance de chaîne
      if (!gameState) {
        console.log(`ERREUR: La partie ${gameId} n'existe pas directement dans la Map`);
        console.log('Recherche d\'une correspondance de chaîne...');
        
        for (const [id, game] of activeMultiMinesGames.entries()) {
          if (id.toString() === gameId.toString()) {
            console.log(`Correspondance trouvée avec conversion de type: ${id} (type: ${typeof id})`);
            gameState = game;
            gameId = id; // Mettre à jour gameId avec la version correcte
            break;
          }
        }
        
        if (!gameState) {
          console.log(`AUCUNE CORRESPONDANCE TROUVÉE POUR ${gameId}`);
          console.log('Parties actuellement en mémoire:', Array.from(activeMultiMinesGames.keys()));
          
          try {
            await interaction.followUp({
              content: '❌ Cette partie n\'existe plus ou est déjà terminée !',
              ephemeral: true
            });
          } catch (e) {
            console.error('Impossible d\'envoyer le message d\'erreur:', e);
          }
          return;
        }
      }
      
      console.log(`Partie trouvée, statut: ${gameState.status}`);
      
      // Rejoindre la partie
      console.log('Appel de joinGame...');
      gameState = await joinGame(interaction, gameId);
      
      if (!gameState) {
        console.log('ERREUR: Impossible de rejoindre la partie (retour null de joinGame)');
        try {
          await interaction.followUp({
            content: '❌ Impossible de rejoindre la partie. Veuillez réessayer.',
            ephemeral: true
          });
        } catch (e) {
          console.error('Impossible d\'envoyer le message d\'erreur:', e);
        }
        return;
      }
      
      console.log('Partie rejointe avec succès, préparation de l\'interface...');
      
      try {
        const embed = createGameEmbed(gameState);
        const components = createGridComponents(gameState);
        
        console.log('Mise à jour de l\'interface...');
        await interaction.editReply({
          content: `🎮 **Partie de Mines Multijoueur**\n` +
            `**Joueur 1:** <@${gameState.player1.id}> ${PLAYER1_EMOJI}\n` +
            `**Joueur 2:** <@${gameState.player2.id}> ${PLAYER2_EMOJI}\n` +
            `**Mise par joueur:** ${gameState.bet} ${config.currency.emoji}\n` +
            `**C'est au tour de :** <@${gameState.currentPlayer}>`,
          embeds: [embed],
          components: components
        });
        
        console.log('=== PARTIE REJOINTE AVEC SUCCÈS ===');
      } catch (error) {
        console.error('ERREUR CRITIQUE lors de la mise à jour de l\'interface:', error);
        try {
          await interaction.followUp({
            content: '❌ Une erreur est survenue lors de la mise à jour de la partie.',
            ephemeral: true
          });
        } catch (e) {
          console.error('Impossible d\'envoyer le message d\'erreur:', e);
        }
      }
      
      return;
    }
    
    // Gérer le clic sur une case ou l'abandon
    const gameState = activeMultiMinesGames.get(gameId);
    
    if (!gameState) {
      console.log(`La partie ${gameId} n'existe plus`);
      try {
        await interaction.update({ 
          content: '❌ Cette partie est terminée !', 
          components: [] 
        });
      } catch (error) {
        console.error('Erreur lors de la mise à jour du message:', error);
      }
      return;
    }
    
    // Mettre à jour la dernière activité de la partie
    gameState.lastActivity = Date.now();
    activeMultiMinesGames.set(gameId, gameState);
    
    // Si c'est une action de clic (déjà analysée)
    if (action === 'click') {
      console.log(`=== DÉBUT DU TRAITEMENT DU CLIC ===`);
      console.log(`Clic sur la case (${x}, ${y}) par l'utilisateur ${interaction.user.id}`);
      console.log(`Joueur actuel: ${gameState.currentPlayer}, Statut de la partie: ${gameState.status}`);
      console.log(`Type d'interaction: ${interaction.type}`);
      console.log(`Message ID: ${interaction.message?.id}`);
      console.log(`Composants du message:`, interaction.message?.components?.length || 'inconnu');
      
      // Différer la mise à jour immédiatement pour éviter les erreurs de délai
      try {
        console.log('Tentative de différé de l\'interaction...');
        await interaction.deferUpdate();
        console.log('Interaction différée avec succès');
      } catch (error) {
        console.error('Erreur lors du différé de l\'interaction:', error);
        console.error('Détails de l\'erreur:', error.stack);
        return;
      }
      
      // Vérifier que les coordonnées sont valides
      console.log(`Vérification des coordonnées: x=${x}, y=${y}, GRID_SIZE=${GRID_SIZE}`);
      if (isNaN(x) || isNaN(y) || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
        console.log(`Coordonnées invalides: x=${x}, y=${y}`);
        try {
          await interaction.followUp({
            content: `❌ Coordonnées invalides (${x}, ${y}). Veuillez réessayer.`,
            ephemeral: true
          });
        } catch (e) {
          console.error('Erreur lors de l\'envoi du message d\'erreur:', e);
        }
        return;
      }
      
      console.log(`Traitement du clic sur la case (${x}, ${y})`);
      
      // Vérifier si la case a déjà été révélée
      console.log(`Vérification de l'état de la case (${x}, ${y}):`);
      console.log(`- Révélée: ${gameState.revealed[x][y].revealed}`);
      console.log(`- Marquée par: ${gameState.revealed[x][y].markedBy || 'personne'}`);
      
      if (gameState.revealed[x][y].revealed || gameState.revealed[x][y].markedBy) {
        console.log('Case déjà révélée ou marquée');
        try {
          await interaction.followUp({
            content: '❌ Cette case a déjà été jouée !',
            ephemeral: true
          });
        } catch (e) {
          console.error('Erreur lors de l\'envoi du message d\'erreur:', e);
        }
        return;
      }
      
      // Vérifier que c'est bien le tour du joueur
      console.log(`Vérification du tour: utilisateur=${interaction.user.id}, joueur actuel=${gameState.currentPlayer}`);
      if (interaction.user.id !== gameState.currentPlayer) {
        console.log(`Ce n'est pas le tour de ce joueur (tour de ${gameState.currentPlayer})`);
        try {
          await interaction.followUp({
            content: `❌ Ce n'est pas votre tour ! C'est au tour de <@${gameState.currentPlayer}>.`,
            ephemeral: true
          });
        } catch (e) {
          console.error('Erreur lors de l\'envoi du message d\'erreur:', e);
        }
        return;
      }
      
      // Révéler la case
      console.log('Appel de revealCell...');
      const isSafe = revealCell(gameState, x, y, interaction.user.id);
      console.log(`revealCell retourné: ${isSafe}, Statut de la partie: ${gameState.status}`);

      // Si la partie n'est pas terminée, changer de joueur
      if (gameState.status !== 'finished') {
        gameState.currentPlayer = gameState.currentPlayer === gameState.player1.id 
          ? gameState.player2.id 
          : gameState.player1.id;
        console.log(`Changement de joueur. Prochain joueur: ${gameState.currentPlayer}`);
      }

      // Mettre à jour l'interface du jeu
      await updateGameInterface(interaction, gameState);
      
      // Si un joueur a gagné, mettre à jour les soldes
      if (gameState.status === 'finished' && gameState.winner) {
        console.log(`Fin de partie détectée, vainqueur: ${gameState.winner}`);
        const winner = gameState.winner === gameState.player1.id ? gameState.player1 : gameState.player2;
        
        try {
          // Calculer les gains en fonction du nombre de cases révélées
          const multiplier = MULTIPLIERS[gameState.revealedCount] || 1;
          const winnings = Math.floor(gameState.bet * multiplier);
          const totalWon = winnings + gameState.bet; // Le gagnant récupère sa mise + les gains
          
          // Mettre à jour les soldes dans la base de données
          console.log(`Mise à jour du solde du gagnant (${winner.id})...`);
          await updateUserBalance(winner.id, totalWon);
          console.log('Solde mis à jour avec succès');
          
          // Envoyer un message de fin de partie
          console.log('Envoi du message de félicitations...');
          await interaction.followUp({
            content: `🎉 Félicitations <@${winner.id}> ! Vous avez gagné ${winnings} ${config.currency.emoji} (x${multiplier.toFixed(2)}) !\n💰 Total reçu : ${totalWon} ${config.currency.emoji} (mise incluse)`,
            ephemeral: false
          });
          console.log('Message de félicitations envoyé');
        } catch (error) {
          console.error('Erreur lors de la finalisation de la partie:', error);
          console.error('Détails de l\'erreur:', error.stack);
          
          // Essayer d'envoyer un message d'erreur
          try {
            await interaction.followUp({
              content: '❌ Une erreur est survenue lors de la finalisation de la partie. Veuillez contacter un administrateur.',
              ephemeral: true
            });
          } catch (e) {
            console.error('Impossible d\'envoyer le message d\'erreur:', e);
          }
        }
      }
      
    } else if (action === 'quit') {
      // Gérer l'abandon
      await handleQuitGame(interaction, gameState, gameId);
    } else {
      // Si aucune action valide n'a été traitée
      console.log('Aucune action valide traitée, mise à jour différée');
      await interaction.deferUpdate();
    }
    
  } catch (error) {
    console.error('=== ERREUR DANS handleMinesMultiInteraction ===');
    console.error('Type d\'erreur:', error.name);
    console.error('Message d\'erreur:', error.message);
    console.error('Stack trace:', error.stack);
    console.error('Détails de l\'interaction:', {
      id: interaction.id,
      type: interaction.type,
      customId: interaction.customId,
      user: interaction.user?.id,
      messageId: interaction.message?.id,
      channelId: interaction.channel?.id
    });
    
    try {
      // Essayer de répondre à l'interaction si elle n'a pas encore été répondue
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Une erreur est survenue lors du traitement de votre action. (Erreur 1)',
          ephemeral: true
        });
      } 
      // Si l'interaction a été différée mais pas encore répondue
      else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: '❌ Une erreur est survenue lors du traitement de votre action. (Erreur 2)',
          embeds: [],
          components: []
        });
      }
      // Si l'interaction a déjà reçu une réponse
      else {
        await interaction.followUp({
          content: '❌ Une erreur est survenue lors du traitement de votre action. (Erreur 3)',
          ephemeral: true
        }).catch(console.error);
      }
    } catch (e) {
      console.error('Impossible d\'envoyer le message d\'erreur:', e);
    }
  }
}

// Mettre à jour le solde d'un utilisateur
async function updateUserBalance(userId, amount) {
  try {
    const user = ensureUser(userId);
    const newBalance = user.balance + amount;
    
    // Mettre à jour la base de données via la fonction updateUser
    await updateUser(userId, { balance: newBalance });
    
    // Mettre à jour l'objet utilisateur localement
    user.balance = newBalance;
    
    console.log(`[DB] Solde mis à jour pour l'utilisateur ${userId}: ${newBalance} ${config.currency.emoji}`);
    
    return newBalance;
  } catch (error) {
    console.error(`Erreur lors de la mise à jour du solde de l'utilisateur ${userId}:`, error);
    throw error;
  }
}

// Gérer l'abandon d'une partie
async function handleQuitGame(interaction, gameState, gameId) {
  try {
    const userId = interaction.user.id;
    
    // Marquer la partie comme terminée
    gameState.status = 'finished';
    gameState.winner = userId === gameState.player1.id ? gameState.player2.id : gameState.player1.id;
    
    const winner = gameState.winner === gameState.player1.id ? gameState.player1 : gameState.player2;
    const winnings = Math.floor(gameState.bet * 2); // Le gagnant récupère sa mise + celle de l'adversaire
    
    // Mettre à jour le solde du gagnant
    updateUser(winner.id, { balance: winner.balance + winnings });
    
    // Mettre à jour l'affichage
    const embed = createGameEmbed(gameState);
    const components = createGridComponents(gameState);
    
    // Désactiver tous les boutons
    for (const row of components) {
      for (const component of row.components) {
        component.setDisabled(true);
      }
    }
    
    await interaction.update({
      content: `🏳️ **<@${userId}> a abandonné la partie !**\n` +
        `🎉 **<@${gameState.winner}> gagne ${winnings} ${config.currency.emoji} !**`,
      embeds: [embed],
      components: components
    });
    
    // Supprimer la partie après un délai
    setTimeout(() => {
      activeMultiMinesGames.delete(gameId);
    }, 30000); // 30 secondes
    
  } catch (error) {
    console.error('Erreur lors de l\'abandon de la partie:', error);
    try {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors de l\'abandon de la partie.',
        ephemeral: true
      }).catch(console.error);
    } catch (e) {
      console.error('Impossible d\'envoyer le message d\'erreur:', e);
    }
  }
}

// Exporter les fonctions
module.exports = {
  handleMinesMultiCommand,
  handleMinesMultiInteraction
};

// Nettoyer les anciennes parties
function cleanupOldGames(userId) {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes d'inactivité
  
  // Créer une copie de la map pour éviter les problèmes d'itération
  const games = new Map(activeMultiMinesGames);
  
  for (const [gameId, game] of games.entries()) {
    try {
      // Ignorer les parties récentes (moins de 5 minutes)
      if (now - game.lastActivity < 300000) { // 5 minutes de grâce
        console.log(`Partie ${gameId} trop récente pour être nettoyée (créée il y a ${Math.floor((now - game.lastActivity) / 1000)} secondes)`);
        continue;
      }
      
      // Ne pas nettoyer les parties en cours
      if (game.status === 'playing') {
        console.log(`Partie ${gameId} en cours, non nettoyée`);
        continue;
      }
      
      // Supprimer uniquement les parties en attente du même utilisateur
      if (game.status === 'waiting' && game.player1?.id === userId) {
        console.log(`Nettoyage de l'ancienne partie en attente ${gameId} de l'utilisateur ${userId}`);
        // Rembourser le joueur pour les parties en attente
        const player = ensureUser(game.player1.id);
        updateUser(game.player1.id, { balance: player.balance + game.bet });
        console.log(`Remboursement de ${game.bet} à ${game.player1.username}`);
        activeMultiMinesGames.delete(gameId);
      }
      // Supprimer les parties inactives depuis plus de 30 minutes
      else if (now - game.lastActivity > timeout) {
        console.log(`Nettoyage de la partie ${gameId} inutilisée depuis plus de 30 minutes`);
        // Rembourser les joueurs si la partie n'a pas commencé
        if (game.status === 'waiting' && game.player1) {
          const player = ensureUser(game.player1.id);
          updateUser(game.player1.id, { balance: player.balance + game.bet });
          console.log(`Remboursement de ${game.bet} à ${game.player1.username}`);
        }
        activeMultiMinesGames.delete(gameId);
      }
    } catch (error) {
      console.error(`Erreur lors du nettoyage de la partie ${gameId}:`, error);
    }
  }
}

// Créer une nouvelle partie
async function createGame(interaction, bet) {
  const userId = interaction.user.id;
  const user = ensureUser(userId);
  
  if (bet > user.balance) {
    await interaction.reply({ 
      content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour cette mise !`, 
      ephemeral: true 
    });
    return null;
  }
  
  if (bet > config.casino.maxBet) {
    await interaction.reply({ 
      content: `❌ La mise maximale est de ${config.casino.maxBet} ${config.currency.emoji} !`, 
      ephemeral: true 
    });
    return null;
  }
  
  if (bet < config.casino.minBet) {
    await interaction.reply({ 
      content: `❌ La mise minimale est de ${config.casino.minBet} ${config.currency.emoji} !`, 
      ephemeral: true 
    });
    return null;
  }
  
  // Bloquer la mise du joueur
  updateUser(userId, { balance: user.balance - bet });
  
  const gameId = Date.now().toString();
  const grid = createGameGrid(3); // 3 mines par défaut
  
  const gameState = {
    id: gameId,
    player1: { id: userId, username: interaction.user.username, balance: user.balance },
    player2: null,
    bet: bet,
    minesCount: 3, // 3 mines par défaut
    grid: grid,
    revealed: Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null).map(() => ({ revealed: false, markedBy: null }))),
    revealedCount: 0,
    status: 'waiting', // waiting, playing, finished
    currentPlayer: userId, // Définir le créateur de la partie comme joueur actuel par défaut
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  
  // Stocker la partie avec l'ID comme clé
  activeMultiMinesGames.set(gameId, gameState);
  
  // Vérifier que la partie est bien stockée
  const storedGame = activeMultiMinesGames.get(gameId);
  
  console.log(`=== NOUVELLE PARTIE CRÉÉE ===`);
  console.log(`ID de la partie: ${gameId} (type: ${typeof gameId})`);
  console.log(`Nombre total de parties actives: ${activeMultiMinesGames.size}`);
  console.log(`Clés des parties actives:`, Array.from(activeMultiMinesGames.keys()));
  console.log(`Partie stockée avec succès:`, storedGame ? 'OUI' : 'NON');
  
  if (storedGame) {
    console.log(`Détails de la partie stockée:`, {
      id: storedGame.id,
      player1: storedGame.player1?.username || 'inconnu',
      status: storedGame.status,
      lastActivity: new Date(storedGame.lastActivity).toISOString()
    });
  }
  
  // Nettoyer les anciennes parties (désactivé temporairement pour le débogage)
  // cleanupOldGames(userId);
  
  return gameState;
}

// Rejoindre une partie existante
async function joinGame(interaction, gameId) {
  console.log(`=== TENTATIVE DE REJOINDRE UNE PARTIE ===`);
  console.log(`ID de la partie à rejoindre: ${gameId} (type: ${typeof gameId})`);
  console.log(`Utilisateur: ${interaction.user.username} (${interaction.user.id})`);
  
  // Afficher des informations sur la Map activeMultiMinesGames
  console.log(`Nombre total de parties actives: ${activeMultiMinesGames.size}`);
  
  // Afficher toutes les clés dans la Map pour le débogage
  const allKeys = Array.from(activeMultiMinesGames.keys());
  console.log('Clés des parties actives:', allKeys);
  
  // Afficher les détails de chaque partie active
  console.log('Détails des parties actives:');
  activeMultiMinesGames.forEach((game, id) => {
    console.log(`- ID: ${id} (type: ${typeof id})`);
    console.log(`  Statut: ${game.status}`);
    console.log(`  Joueur 1: ${game.player1?.username || 'inconnu'} (${game.player1?.id || 'N/A'})`);
    console.log(`  Dernière activité: ${new Date(game.lastActivity).toISOString()}`);
  });
  
  // Essayer de récupérer la partie avec l'ID fourni
  console.log(`Tentative de récupération de la partie avec l'ID: ${gameId}`);
  let gameState = activeMultiMinesGames.get(gameId);
  
  if (!gameState) {
    console.log('ERREUR: La partie n\'a pas été trouvée dans la Map');
    
    // Essayer de trouver la partie avec une correspondance de chaîne
    console.log('Recherche d\'une correspondance de chaîne...');
    let found = false;
    
    for (const [id, game] of activeMultiMinesGames.entries()) {
      if (id.toString() === gameId.toString()) {
        console.log(`Correspondance trouvée avec conversion de type: ${id} (type: ${typeof id})`);
        found = true;
        gameState = game;
        gameId = id; // Mettre à jour gameId avec la version correcte
        break;
      }
    }
    
    if (!found) {
      console.log('AUCUNE CORRESPONDANCE TROUVÉE, MÊME AVEC CONVERSION DE TYPE');
      console.log('Toutes les clés disponibles:', allKeys.map(k => `${k} (${typeof k})`));
      
      await interaction.reply({ 
        content: '❌ Cette partie n\'existe plus ou est déjà terminée !', 
        ephemeral: true 
      });
      return null;
    }
  }
  
  console.log(`Détails de la partie trouvée:`, {
    id: gameState.id,
    player1: gameState.player1?.username,
    player2: gameState.player2 ? 'déjà présent' : 'absent',
    status: gameState.status,
    lastActivity: new Date(gameState.lastActivity).toISOString()
  });
  
  if (gameState.status !== 'waiting') {
    console.log('Partie déjà commencée ou terminée');
    await interaction.reply({ 
      content: '❌ Cette partie a déjà commencé !', 
      ephemeral: true 
    });
    return null;
  }
  
  const userId = interaction.user.id;
  
  if (gameState.player1.id === userId) {
    console.log('Tentative de rejoindre sa propre partie');
    await interaction.reply({ 
      content: '❌ Vous ne pouvez pas rejoindre votre propre partie !', 
      ephemeral: true 
    });
    return null;
  }
  
  const user = ensureUser(userId);
  
  if (gameState.bet > user.balance) {
    console.log('Solde insuffisant pour rejoindre la partie');
    await interaction.reply({ 
      content: `❌ Vous n'avez pas assez de ${config.currency.emoji} pour rejoindre cette partie !`, 
      ephemeral: true 
    });
    return null;
  }
  
  try {
    // Bloquer la mise du joueur 2
    updateUser(userId, { balance: user.balance - gameState.bet });
    
    // Mettre à jour l'état de la partie avec le solde mis à jour du joueur 2
    gameState.player2 = { 
      id: userId,
      username: interaction.user.username,
      balance: ensureUser(userId).balance // Récupérer le solde mis à jour
    };
    gameState.status = 'playing';
    gameState.currentPlayer = Math.random() < 0.5 ? gameState.player1.id : gameState.player2.id; // Premier joueur aléatoire
    gameState.lastActivity = Date.now();
    
    // Mettre à jour la partie dans la Map
    activeMultiMinesGames.set(gameId, gameState);
    
    console.log(`Joueur ${interaction.user.username} a rejoint la partie ${gameId}`);
    console.log('État de la partie après ajout du joueur 2:', gameState);
    
    return gameState;
  } catch (error) {
    console.error('Erreur lors de la jonction à la partie:', error);
    await interaction.reply({ 
      content: '❌ Une erreur est survenue lors de la jonction à la partie.', 
      ephemeral: true 
    });
    return null;
  }
}

// Tableau des multiplicateurs pour chaque case révélée
const MULTIPLIERS = {
  0: 1.0, 1: 1.15, 2: 1.50, 3: 2.00, 4: 2.50,
  5: 3.00, 6: 3.50, 7: 4.00, 8: 4.50, 9: 5.00,
  10: 5.50, 11: 6.00, 12: 6.50, 13: 7.00, 14: 7.50, 15: 8.00
};

// Créer l'embed du jeu
function createGameEmbed(gameState) {
  const embed = new EmbedBuilder()
    .setTitle('💎 MINES MULTIJOUEUR')
    .setColor(0x00AE86);
    
  // Informations de base
  let description = `**Mise par joueur:** ${gameState.bet} ${config.currency.emoji}\n`;
  
  // Afficher les informations des joueurs
  description += `\n**👤 Joueur 1:** <@${gameState.player1.id}> ${PLAYER1_EMOJI}`;
  
  if (gameState.player2) {
    description += `\n**👥 Joueur 2:** <@${gameState.player2.id}> ${PLAYER2_EMOJI}`;
  }
  
  if (gameState.status === 'waiting') {
    description += `\n\n🕒 **En attente d'un deuxième joueur...**`;
    description += `\n\nCliquez sur le bouton ci-dessous pour rejoindre la partie !`;
  } 
  else if (gameState.status === 'playing') {
    const currentPlayer = gameState.currentPlayer === gameState.player1.id ? 
      gameState.player1 : gameState.player2;
    
    description += `\n\n🎮 **TOUR ACTUEL**`;
    description += `\n> 👤 **${currentPlayer.username}** (${currentPlayer.id === gameState.player1.id ? 'Joueur 1' : 'Joueur 2'})`;
    description += `\n> ⏳ À vous de jouer !`;
    
    // Afficher le multiplicateur actuel
    if (gameState.revealedCount > 0) {
      description += `\n\n💰 **Multiplicateur actuel:** ${MULTIPLIERS[gameState.revealedCount]?.toFixed(2)}x`;
    }
  } 
  else if (gameState.status === 'finished') {
    if (gameState.winner) {
      const winner = gameState.winner === gameState.player1.id ? gameState.player1 : gameState.player2;
      const loser = gameState.winner === gameState.player1.id ? gameState.player2 : gameState.player1;
      
      const winnings = Math.floor(gameState.bet * MULTIPLIERS[gameState.revealedCount]);
      const totalWon = winnings + gameState.bet;
      
      description += `\n\n🏆 **PARTIE TERMINÉE**`;
      description += `\n> 🎉 **${winner.username} a gagné !**`;
      description += `\n> 💰 Gains: ${winnings} ${config.currency.emoji} (${MULTIPLIERS[gameState.revealedCount]?.toFixed(2)}x)`;
      description += `\n> 💵 Total gagné: ${totalWon} ${config.currency.emoji}`;
      description += `\n> 😢 ${loser.username} a perdu sa mise de ${gameState.bet} ${config.currency.emoji}`;
      
      updateUser(winner.id, { balance: winner.balance + totalWon });
    } else {
      description += `\n\n🤝 **MATCH NUL**`;
      description += `\n> Aucun gagnant cette fois-ci.`;
      description += `\n> Chaque joueur récupère sa mise de ${gameState.bet} ${config.currency.emoji}`;
    }
  }
  
  embed.setDescription(description);
  
  return embed;
}

// Gérer la révélation d'une case
function revealCell(gameState, x, y, userId) {
  console.log(`Révélation de la case (${x}, ${y}) par l'utilisateur ${userId}`);
  
  // Vérifier si la case est déjà révélée
  if (gameState.revealed[x][y].revealed) {
    console.log(`La case (${x}, ${y}) est déjà révélée`);
    return true; // La case est déjà révélée, on ne fait rien
  }

  // Marquer la case comme révélée
  gameState.revealed[x][y].revealed = true;
  gameState.revealed[x][y].markedBy = userId;
  
  // Vérifier si c'est une mine
  if (gameState.grid[x][y] === 'mine') {
    console.log(`La case (${x}, ${y}) est une mine !`);
    // Le joueur a trouvé une mine, il a perdu
    gameState.status = 'finished';
    gameState.winner = userId === gameState.player1.id ? gameState.player2.id : gameState.player1.id;
    console.log(`La partie est terminée, le gagnant est: ${gameState.winner}`);
    
    // Révéler toutes les mines pour la fin de partie
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (gameState.grid[i][j] === 'mine' && !gameState.revealed[i][j].revealed) {
          gameState.revealed[i][j].revealed = true;
          gameState.revealed[i][j].markedBy = gameState.winner;
        }
      }
    }
    
    return false;
  }
  
  // Si c'est une case sûre, incrémenter le compteur
  gameState.revealedCount++;
  console.log(`Case sûre révélée. Total révélé: ${gameState.revealedCount}`);
  
  // Vérifier si le joueur a gagné (toutes les cases non-mines ont été révélées)
  const totalSafeCells = GRID_SIZE * GRID_SIZE - gameState.minesCount;
  console.log(`Cases sûres totales: ${totalSafeCells}, révélées: ${gameState.revealedCount}`);
  
  if (gameState.revealedCount >= totalSafeCells) {
    console.log(`Toutes les cases sûres ont été révélées ! Le joueur ${userId} a gagné !`);
    gameState.status = 'finished';
    gameState.winner = userId; // Le joueur actuel gagne
    
    // Révéler toutes les mines restantes
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (gameState.grid[i][j] === 'mine' && !gameState.revealed[i][j].revealed) {
          gameState.revealed[i][j].revealed = true;
          gameState.revealed[i][j].markedBy = userId;
        }
      }
    }
    
    return true;
  }
  
  // Ne plus révéler automatiquement les cases adjacentes
  // Chaque joueur révèle une seule case par tour
  
  return true;
}

// Compter les mines adjacentes à une case
function countAdjacentMines(gameState, x, y) {
  let count = 0;
  for (let i = Math.max(0, x - 1); i <= Math.min(GRID_SIZE - 1, x + 1); i++) {
    for (let j = Math.max(0, y - 1); j <= Math.min(GRID_SIZE - 1, y + 1); j++) {
      if (i === x && j === y) continue; // Ne pas compter la case elle-même
      if (gameState.grid[i][j] === 'mine') {
        count++;
      }
    }
  }
  return count;
}

// Révéler une seule case adjacente à une case vide
function revealAdjacentCells(gameState, x, y, userId) {
  // Créer une liste de toutes les cases adjacentes non révélées
  const adjacentCells = [];
  for (let i = Math.max(0, x - 1); i <= Math.min(GRID_SIZE - 1, x + 1); i++) {
    for (let j = Math.max(0, y - 1); j <= Math.min(GRID_SIZE - 1, y + 1); j++) {
      if ((i !== x || j !== y) && !gameState.revealed[i][j].revealed) {
        adjacentCells.push({x: i, y: j});
      }
    }
  }
  
  // Si aucune case adjacente n'est disponible, ne rien faire
  if (adjacentCells.length === 0) return;
  
  // Choisir une case adjacente au hasard
  const randomIndex = Math.floor(Math.random() * adjacentCells.length);
  const cell = adjacentCells[randomIndex];
  
  // Révéler la case choisie
  console.log(`Révélation d'une case adjacente: (${cell.x}, ${cell.y})`);
  revealCell(gameState, cell.x, cell.y, userId);
}

// Créer une nouvelle grille de jeu
function createGameGrid(minesCount) {
  const grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('gem'));
  let minesPlaced = 0;
  
  while (minesPlaced < minesCount) {
    const x = Math.floor(Math.random() * GRID_SIZE);
    const y = Math.floor(Math.random() * GRID_SIZE);
    if (grid[x][y] !== 'mine') {
      grid[x][y] = 'mine';
      minesPlaced++;
    }
  }
  
  return grid;
}

// Mettre à jour l'interface du jeu
async function updateGameInterface(interaction, gameState) {
  try {
    console.log('=== MISE À JOUR DE L\'INTERFACE ===');
    console.log(`- ID de l'interaction: ${interaction.id}`);
    console.log(`- Utilisateur: ${interaction.user.id} (${interaction.user.username})`);
    console.log(`- Type d'interaction: ${interaction.type}`);
    console.log(`- Message ID: ${interaction.message?.id || 'non disponible'}`);
    
    // Créer l'embed avec les informations de la partie
    const embed = createGameEmbed(gameState);
    
    // Préparer le contenu du message avec une mise en forme claire
    let content = `🎮 **Partie de Mines Multijoueur**\n`;
    
    // Ajouter les informations des joueurs avec mise en forme
    content += `\n**Joueur 1:** <@${gameState.player1.id}> ${PLAYER1_EMOJI}`;
    
    if (gameState.player2) {
      content += `\n**Joueur 2:** <@${gameState.player2.id}> ${PLAYER2_EMOJI}`;
    } else {
      content += '\n🕒 **En attente du deuxième joueur...**';
    }
    
    // Ajouter la mise
    content += `\n\n💰 **Mise par joueur:** ${gameState.bet} ${config.currency.emoji}`;
    
    // Créer les composants de la grille
    const components = createGridComponents(gameState);
    
    if (gameState.status === 'finished') {
      // La partie est terminée
      content += `\n\n🏆 **PARTIE TERMINÉE**`;
      
      if (gameState.winner) {
        const winner = gameState.winner === gameState.player1.id ? gameState.player1 : gameState.player2;
        const loser = gameState.winner === gameState.player1.id ? gameState.player2 : gameState.player1;
        const multiplier = MULTIPLIERS[gameState.revealedCount] || 1;
        const winnings = Math.floor(gameState.bet * multiplier);
        const totalWon = winnings + gameState.bet;
        
        content += `\n> 🎉 **${winner.username} a gagné !**`;
        content += `\n> 💰 Gains: ${winnings} ${config.currency.emoji} (x${multiplier.toFixed(2)})`;
        content += `\n> 💵 Total reçu: ${totalWon} ${config.currency.emoji} (mise incluse)`;
        content += `\n> 😢 ${loser.username} a perdu sa mise de ${gameState.bet} ${config.currency.emoji}`;
      } else {
        content += `\n> 🤝 **Match nul !**`;
        content += `\n> Chaque joueur récupère sa mise de ${gameState.bet} ${config.currency.emoji}`;
      }
      
      // Désactiver tous les boutons
      for (const row of components) {
        for (const component of row.components) {
          component.setDisabled(true);
        }
      }
      
      // Mettre à jour le message
      await interaction.editReply({
        content: content,
        embeds: [embed],
        components: components
      });
      
      // Supprimer la partie après un délai
      setTimeout(() => {
        activeMultiMinesGames.delete(gameState.id);
      }, 30000); // 30 secondes
    } else {
      // La partie continue
      const currentPlayerObj = gameState.currentPlayer === gameState.player1.id ? 
        { id: gameState.player1.id, username: gameState.player1.username } : 
        { id: gameState.player2.id, username: gameState.player2.username };
      
      const isCurrentUserTurn = interaction.user.id === gameState.currentPlayer;
      
      if (isCurrentUserTurn) {
        content += `\n\n✅ **C'EST À VOTRE TOUR !**`;
        content += `\nCliquez sur une case pour jouer.`;
      } else {
        content += `\n\n⏳ **En attente du tour de <@${currentPlayerObj.id}>...**`;
      }
      
      // Mettre à jour le message
      await interaction.editReply({
        content: content,
        embeds: [embed],
        components: components
      });
    }
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'interface:', error);
    
    // En cas d'erreur, essayer de mettre à jour avec un message d'erreur
    try {
      await interaction.editReply({
        content: '❌ Une erreur est survenue lors de la mise à jour du jeu. Veuillez réessayer.',
        embeds: [],
        components: []
      });
    } catch (e) {
      console.error('Impossible de mettre à jour le message d\'erreur:', e);
    }
  }
}

// Créer les composants de la grille (boutons)
function createGridComponents(gameState) {
  console.log('=== CRÉATION DES COMPOSANTS DE GRILLE ===');
  console.log(`- ID du joueur actuel: ${gameState.currentPlayer} (type: ${typeof gameState.currentPlayer})`);
  console.log(`- Statut de la partie: ${gameState.status}`);
  console.log(`- Joueur 1: ${gameState.player1.id} (type: ${typeof gameState.player1.id})`);
  console.log(`- Joueur 2: ${gameState.player2?.id || 'non défini'}`);
  
  const components = [];
  const currentPlayerId = gameState.currentPlayer;
  
  for (let x = 0; x < GRID_SIZE; x++) {
    const row = new ActionRowBuilder();
    
    for (let y = 0; y < GRID_SIZE; y++) {
      const cell = gameState.revealed[x][y];
      const isMine = gameState.grid[x][y] === 'mine';
      let emoji = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary;
      
      // Désactiver le bouton si :
      // 1. La partie est terminée
      // 2. La case est déjà révélée
      // 3. Ce n'est pas le tour du joueur actuel
      const shouldDisable = 
        gameState.status === 'finished' || 
        cell.revealed || 
        (gameState.status === 'playing' && gameState.currentPlayer !== currentPlayerId);
      
      if (cell.revealed) {
        emoji = isMine ? MINE_EMOJI : GEM_EMOJI;
        style = isMine ? ButtonStyle.Danger : ButtonStyle.Success;
        console.log(`Case (${x}, ${y}): Révélée (${isMine ? 'Mine' : 'Sûre'})`);
      } else if (cell.markedBy) {
        emoji = cell.markedBy === gameState.player1.id ? PLAYER1_EMOJI : PLAYER2_EMOJI;
        style = ButtonStyle.Primary;
        console.log(`Case (${x}, ${y}): Marquée par ${cell.markedBy}`);
      } else {
        console.log(`Case (${x}, ${y}): Cachée`);
      }
      
      // Déterminer le style du bouton en fonction de l'état
      let buttonLabel = '❓';
      let buttonStyle = ButtonStyle.Secondary;
      
      if (cell.revealed) {
        buttonLabel = isMine ? '💣' : '💎';
        buttonStyle = isMine ? ButtonStyle.Danger : ButtonStyle.Success;
      } else if (cell.markedBy) {
        buttonLabel = cell.markedBy === gameState.player1.id ? '1️⃣' : '2️⃣';
        buttonStyle = ButtonStyle.Primary;
      } else {
        buttonLabel = '❔';
        buttonStyle = ButtonStyle.Secondary;
      }

      console.log(`Case (${x}, ${y}):`);
      console.log(`- Statut: ${gameState.status}`);
      console.log(`- Révélée: ${cell.revealed}`);
      console.log(`- Tour du joueur: ${gameState.currentPlayer} (${gameState.currentPlayer === gameState.player1.id ? 'Joueur 1' : 'Joueur 2'})`);
      console.log(`- Désactivée: ${shouldDisable}`);
      
      const button = new ButtonBuilder()
        .setCustomId(`mines_multi_${gameState.id}_${x}_${y}`)
        .setLabel(buttonLabel)
        .setStyle(buttonStyle)
        .setDisabled(shouldDisable);
        
      // Ajouter un style pour les cases non révélées
      if (!cell.revealed && !cell.markedBy) {
        button.setStyle(ButtonStyle.Primary);
      }
      
      row.addComponents(button);
    }
    
    components.push(row);
  }
  
  // Ajouter le bouton pour quitter la partie si la partie est en cours
  if (gameState.status === 'playing' || gameState.status === 'waiting') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mines_multi_${gameState.id}_quit`)
          .setLabel('Abandonner')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🏳️')
          .setDisabled(gameState.status === 'finished')
      )
    );
  }
  
  return components;
}
