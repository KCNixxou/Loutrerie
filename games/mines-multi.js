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
    
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const gameId = parts[2];
    const rest = parts.slice(3);
    
    if (!gameId) {
      console.log('Aucun ID de jeu fourni');
      return;
    }
    
    // Gérer la demande de rejoindre une partie
    if (action === 'join') {
      console.log(`=== TENTATIVE DE REJOINDRE UNE PARTIE ===`);
      console.log(`Partie ID: ${gameId}`);
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
      if (!gameState) {
        console.log(`ERREUR: La partie ${gameId} n'existe plus dans activeMultiMinesGames`);
        console.log(`Parties actuellement en mémoire:`, Array.from(activeMultiMinesGames.keys()));
        
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
        const components = createGridComponents(gameState, interaction);
        
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
      await interaction.update({ 
        content: '❌ Cette partie est terminée !', 
        components: [] 
      }).catch(console.error);
      return;
    }
    
    // Mettre à jour la dernière activité de la partie
    gameState.lastActivity = Date.now();
    activeMultiMinesGames.set(gameId, gameState);
    
    // Vérifier si c'est un abandon
    if (rest[0] === 'quit') {
      await handleQuitGame(interaction, gameState, gameId);
      return;
    }
    
    // Gérer le clic sur une case
    const x = parseInt(rest[0]);
    const y = parseInt(rest[1]);
    
    if (isNaN(x) || isNaN(y) || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
      await interaction.deferUpdate();
      return;
    }
    
    // Vérifier si la case a déjà été révélée
    if (gameState.revealed[x][y].revealed || gameState.revealed[x][y].markedBy) {
      await interaction.deferUpdate();
      return;
    }
    
    // Vérifier que c'est bien le tour du joueur
    if (interaction.user.id !== gameState.currentPlayer) {
      await interaction.deferUpdate();
      return;
    }
    
    // Marquer la case comme révélée par le joueur actuel
    gameState.revealed[x][y].markedBy = interaction.user.id;
    
    // Révéler la case
    const isSafe = revealCell(gameState, x, y, interaction.user.id);
    
    // Mettre à jour l'affichage
    const embed = createGameEmbed(gameState);
    const components = createGridComponents(gameState, interaction);
    
    if (gameState.status === 'finished') {
      // La partie est terminée, désactiver tous les boutons
      for (const row of components) {
        for (const component of row.components) {
          component.setDisabled(true);
        }
      }
      
      await interaction.update({
        embeds: [embed],
        components: components
      });
      
      // Supprimer la partie après un délai
      setTimeout(() => {
        activeMultiMinesGames.delete(gameId);
      }, 30000); // 30 secondes
    } else {
      // Continuer la partie
      await interaction.update({
        content: `🎮 **Partie de Mines Multijoueur**\n` +
          `**Joueur 1:** <@${gameState.player1.id}> ${PLAYER1_EMOJI}\n` +
          `**Joueur 2:** <@${gameState.player2.id}> ${PLAYER2_EMOJI}\n` +
          `**Mise par joueur:** ${gameState.bet} ${config.currency.emoji}\n` +
          `**C'est au tour de :** <@${gameState.currentPlayer}>`,
        embeds: [embed],
        components: components
      });
    }
    
  } catch (error) {
    console.error('Erreur dans handleMinesMultiInteraction:', error);
    try {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du traitement de votre action.',
        ephemeral: true
      }).catch(console.error);
    } catch (e) {
      console.error('Impossible d\'envoyer le message d\'erreur:', e);
    }
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
    const components = createGridComponents(gameState, interaction);
    
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
  const grid = createGameGrid(5); // 5 mines par défaut
  
  const gameState = {
    id: gameId,
    player1: { id: userId, username: interaction.user.username, balance: user.balance },
    player2: null,
    bet: bet,
    grid: grid,
    revealed: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill({ revealed: false, markedBy: null })),
    revealedCount: 0,
    status: 'waiting', // waiting, playing, finished
    currentPlayer: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  
  // Stocker la partie avec l'ID comme clé
  activeMultiMinesGames.set(gameId, gameState);
  console.log(`Nouvelle partie créée avec l'ID: ${gameId}`);
  console.log(`Nombre total de parties actives: ${activeMultiMinesGames.size}`);
  console.log(`Détails de la partie créée:`, {
    id: gameState.id,
    player1: gameState.player1.username,
    status: gameState.status,
    lastActivity: new Date(gameState.lastActivity).toISOString()
  });
  
  // Nettoyer les anciennes parties (désactivé temporairement pour le débogage)
  // cleanupOldGames(userId);
  
  return gameState;
}

// Rejoindre une partie existante
async function joinGame(interaction, gameId) {
  console.log(`Tentative de rejoindre la partie ${gameId} par ${interaction.user.username}`);
  console.log(`Nombre total de parties actives: ${activeMultiMinesGames.size}`);
  
  // Afficher toutes les parties actives pour le débogage
  console.log('Liste des parties actives:');
  activeMultiMinesGames.forEach((game, id) => {
    console.log(`- ${id}: ${game.status} (créée par ${game.player1?.username || 'inconnu'}, dernière activité: ${new Date(game.lastActivity).toISOString()})`);
  });
  
  const gameState = activeMultiMinesGames.get(gameId);
  
  if (!gameState) {
    console.log('Partie non trouvée dans la Map activeMultiMinesGames');
    await interaction.reply({ 
      content: '❌ Cette partie n\'existe plus ou est déjà terminée !', 
      ephemeral: true 
    });
    return null;
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
    .setColor(0x0099FF);
    
  if (gameState.status === 'waiting') {
    embed.setDescription(`\n${WAITING_EMOJI} En attente d'un deuxième joueur...\n\n` +
      `**Mise :** ${gameState.bet} ${config.currency.emoji}\n` +
      `**Créateur :** <@${gameState.player1.id}>\n\n` +
      `Cliquez sur le bouton ci-dessous pour rejoindre la partie !`);
  } else if (gameState.status === 'playing') {
    const currentPlayer = gameState.currentPlayer === gameState.player1.id ? 
      `${PLAYER1_EMOJI} <@${gameState.player1.id}>` : 
      `${PLAYER2_EMOJI} <@${gameState.player2.id}>`;
      
    const player1Status = gameState.currentPlayer === gameState.player1.id ? '🟢' : '⚫';
    const player2Status = gameState.currentPlayer === gameState.player2.id ? '🟢' : '⚫';
    
    embed.setDescription(
      `**${player1Status} Joueur 1:** <@${gameState.player1.id}>\n` +
      `**${player2Status} Joueur 2:** <@${gameState.player2.id}>\n\n` +
      `**Tour de :** ${currentPlayer}\n` +
      `**Mise par joueur :** ${gameState.bet} ${config.currency.emoji}\n` +
      `**Multiplicateur actuel :** ${MULTIPLIERS[gameState.revealedCount]?.toFixed(2)}x`
    );
  } else if (gameState.status === 'finished') {
    if (gameState.winner) {
      const winner = gameState.winner === gameState.player1.id ? gameState.player1 : gameState.player2;
      const loser = gameState.winner === gameState.player1.id ? gameState.player2 : gameState.player1;
      // Calculer les gains : (mise du perdant * multiplicateur) + mise du gagnant
      const winnings = Math.floor(gameState.bet * MULTIPLIERS[gameState.revealedCount]);
      const totalWon = winnings + gameState.bet; // Le gagnant récupère sa mise + les gains
      
      embed.setDescription(
        `🎉 **<@${winner.id}> a gagné !**\n\n` +
        `**Gains :** ${winnings} ${config.currency.emoji} (${MULTIPLIERS[gameState.revealedCount].toFixed(2)}x)\n` +
        `**Total gagné :** ${totalWon} ${config.currency.emoji} (mise incluse)\n` +
        `**Cases révélées :** ${gameState.revealedCount}\n\n` +
        `😢 <@${loser.id}> a perdu sa mise de ${gameState.bet} ${config.currency.emoji}`
      );
      
      // Mettre à jour les soldes
      // Le gagnant récupère sa mise + les gains (mise du perdant * multiplicateur)
      updateUser(winner.id, { balance: winner.balance + totalWon });
      // Le perdant ne récupère rien (sa mise a déjà été déduite)
    } else {
      embed.setDescription(
        `🤝 **Match nul !**\n\n` +
        `**Remboursement :** ${gameState.bet} ${config.currency.emoji} pour chaque joueur`
      );
    }
  }
  
  return embed;
}

// Gérer la révélation d'une case
function revealCell(gameState, x, y, userId) {
  if (gameState.grid[x][y] === 'mine') {
    // Le joueur a trouvé une mine, il a perdu
    gameState.status = 'finished';
    gameState.winner = userId === gameState.player1.id ? gameState.player2.id : gameState.player1.id;
    // Révéler toutes les mines
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (gameState.grid[i][j] === 'mine') {
          gameState.revealed[i][j].revealed = true;
        }
      }
    }
    return false;
  } else {
    // Case sûre, continuer le jeu
    gameState.revealed[x][y].revealed = true;
    gameState.revealedCount++;
    
    // Changer de joueur
    gameState.currentPlayer = gameState.currentPlayer === gameState.player1.id ? 
      gameState.player2.id : gameState.player1.id;
    
    return true;
  }
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

// Créer les composants de la grille (boutons)
function createGridComponents(gameState, interaction = null) {
  const components = [];
  
  for (let x = 0; x < GRID_SIZE; x++) {
    const row = new ActionRowBuilder();
    
    for (let y = 0; y < GRID_SIZE; y++) {
      const cell = gameState.revealed[x][y];
      const isMine = gameState.grid[x][y] === 'mine';
      let emoji = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary;
      
      if (cell.revealed) {
        emoji = isMine ? MINE_EMOJI : GEM_EMOJI;
        style = isMine ? ButtonStyle.Danger : ButtonStyle.Success;
      } else if (cell.markedBy) {
        emoji = cell.markedBy === gameState.player1.id ? PLAYER1_EMOJI : PLAYER2_EMOJI;
        style = ButtonStyle.Primary;
      }
      
      // Ne pas désactiver les boutons si la partie est en attente d'un deuxième joueur
      const shouldDisable = gameState.status === 'finished' || 
                          (gameState.status === 'playing' && 
                           gameState.currentPlayer !== interaction?.user?.id);
      
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`mines_multi_${gameState.id}_${x}_${y}`)
          .setEmoji(emoji)
          .setStyle(style)
          .setDisabled(shouldDisable)
      );
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
