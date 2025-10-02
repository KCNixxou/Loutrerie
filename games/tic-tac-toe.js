const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ensureUser, updateUser } = require('../database');
const config = require('../config');

// Variables pour stocker les parties en cours
const activeTicTacToeGames = new Map();

// MORPION (TIC-TAC-TOE)
async function handleTicTacToe(interaction) {
  const opponent = interaction.options?.getUser('adversaire');
  const bet = interaction.options?.getInteger('mise') || 0;
  const player1 = interaction.user;
  const isSoloMode = !opponent;
  
  // Mode solo - vérifier si on est dans le salon spécial
  if (isSoloMode) {
    const SPECIAL_CHANNEL_ID = '1378373298861248642'; // ID du salon spécial High Low
    if (interaction.channelId !== SPECIAL_CHANNEL_ID) {
      await interaction.reply({ 
        content: '❌ Le mode solo contre l\'IA est uniquement disponible dans le salon <#1378373298861248642> !', 
        ephemeral: true 
      });
      return;
    }
    
    // Créer un objet utilisateur pour l'IA
    const player2 = {
      id: '0',
      username: 'IA Loutre',
      bot: true,
      toString: () => '<@0>'
    };
    
    // Créer la partie contre l'IA
    await createTicTacToeGame(interaction, player1, player2, bet, true);
    return;
  }
  
  // Mode multijoueur normal
  const player2 = opponent;
  
  // Vérifications initiales
  if (player1.id === player2.id) {
    await interaction.reply({ content: '❌ Tu ne peux pas jouer contre toi-même !', ephemeral: true });
    return;
  }
  
  if (player2.bot) {
    await interaction.reply({ content: '❌ Tu ne peux pas jouer contre un bot !', ephemeral: true });
    return;
  }
  
  // Vérification des fonds si mise
  if (bet > 0) {
    const user1 = ensureUser(player1.id);
    const user2 = ensureUser(player2.id);
    
    if (user1.balance < bet) {
      await interaction.reply({ 
        content: `❌ Tu n'as pas assez de ${config.currency.emoji} pour cette mise !`, 
        ephemeral: true 
      });
      return;
    }
    
    if (user2.balance < bet) {
      await interaction.reply({ 
        content: `❌ ${player2.username} n'a pas assez de ${config.currency.emoji} pour cette mise !`, 
        ephemeral: true 
      });
      return;
    }
    
    // Bloquer les fonds
    updateUser(player1.id, { balance: user1.balance - bet });
    updateUser(player2.id, { balance: user2.balance - bet });
  }
  
  // Créer la partie contre un autre joueur
  await createTicTacToeGame(interaction, player1, player2, bet, false);
}

// Fonction pour créer une nouvelle partie de morpion
async function createTicTacToeGame(interaction, player1, player2, bet = 0, isSoloMode = false) {
  // Créer la grille de jeu 5x5
  const board = Array(25).fill(null);
  const gameId = `${player1.id}-${player2.id}-${Date.now()}`;
  
  console.log(`[MORPION] Création d'une nouvelle partie: ${gameId}`);
  console.log(`[MORPION] Joueurs: ${player1.username} vs ${player2.username}`);
  
  // Créer les boutons pour la grille 5x5
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 5; j++) {
      const index = i * 5 + j;
      const button = new ButtonBuilder()
        .setCustomId(`ttt_${gameId}_${index}`)
        .setLabel('·') // Point médian comme marqueur visuel
        .setStyle(ButtonStyle.Secondary);
      row.addComponents(button);
    }
    rows.push(row);
  }
  
  // Enregistrer la partie
  activeTicTacToeGames.set(gameId, {
    board,
    players: [player1.id, player2.id],
    player1,  // Stocker l'objet utilisateur complet
    player2,  // Stocker l'objet utilisateur complet
    currentPlayer: 0, // Index du joueur actuel (0 ou 1)
    currentPlayerId: player1.id, // ID du joueur dont c'est le tour
    bet,
    message: null,
    createdAt: Date.now()
  });
  
  // Créer l'embed
  const embed = new EmbedBuilder()
    .setTitle('⭕ Morpion ❌')
    .setDescription(`**${player1.username}** (❌) vs **${player2.username}** (⭕)\n\nC'est au tour de ${player1}`)
    .setColor(0x00ff00)
    .setThumbnail('https://i.imgur.com/undefined');
    
  if (bet > 0) {
    embed.addFields({ name: 'Mise', value: `${bet} ${config.currency.emoji} par joueur` });
  }
  
  // Envoyer le message avec les boutons
  console.log('[MORPION] Envoi du message avec les boutons...');
  try {
    const message = await interaction.reply({ 
      content: `${player1} vs ${player2} - C'est parti pour une partie de morpion !`,
      embeds: [embed],
      components: rows,
      fetchReply: true
    });
    console.log('[MORPION] Message envoyé avec succès');
    
    // Sauvegarder la référence du message
    const game = activeTicTacToeGames.get(gameId);
    game.message = message;
    activeTicTacToeGames.set(gameId, game);
  } catch (error) {
    console.error('[MORPION] Erreur lors de l\'envoi du message:', error);
    throw error;
  }
}

// Vérifier si un joueur a gagné au Morpion 5x5
function checkTicTacToeWinner(board) {
  const size = 5;
  const winLength = 4; // Nombre de symboles alignés nécessaires pour gagner
  
  // Vérifier les lignes
  for (let row = 0; row < size; row++) {
    for (let col = 0; col <= size - winLength; col++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index + 1] && 
          board[index] === board[index + 2] && 
          board[index] === board[index + 3]) {
        return board[index];
      }
    }
  }
  
  // Vérifier les colonnes
  for (let col = 0; col < size; col++) {
    for (let row = 0; row <= size - winLength; row++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index + size] && 
          board[index] === board[index + 2 * size] && 
          board[index] === board[index + 3 * size]) {
        return board[index];
      }
    }
  }
  
  // Vérifier les diagonales descendantes
  for (let row = 0; row <= size - winLength; row++) {
    for (let col = 0; col <= size - winLength; col++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index + size + 1] && 
          board[index] === board[index + 2 * (size + 1)] && 
          board[index] === board[index + 3 * (size + 1)]) {
        return board[index];
      }
    }
  }
  
  // Vérifier les diagonales montantes
  for (let row = winLength - 1; row < size; row++) {
    for (let col = 0; col <= size - winLength; col++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index - (size - 1)] && 
          board[index] === board[index - 2 * (size - 1)] && 
          board[index] === board[index - 3 * (size - 1)]) {
        return board[index];
      }
    }
  }
  
  // Vérifier le match nul
  if (board.every(cell => cell !== null)) return 'tie';
  
  return null; // Pas de gagnant pour l'instant
}

// Gérer les mouvements du Morpion
async function handleTicTacToeMove(interaction) {
  console.log('[MORPION] Nouvelle interaction reçue:', interaction.customId);
  const [_, gameId, index] = interaction.customId.split('_');
  console.log('[MORPION] ID de jeu:', gameId, 'Index:', index);
  
  const game = activeTicTacToeGames.get(gameId);
  console.log('[MORPION] Partie trouvée:', game ? 'Oui' : 'Non');
  
  if (!game) {
    await interaction.update?.({ components: [] });
    return interaction.followUp?.({ content: '❌ Cette partie de morpion est terminée ou introuvable !', ephemeral: true });
  }
  
  // Vérifier si c'est bien le tour du joueur qui interagit
  const currentPlayerId = game.players[game.currentPlayer];
  if (interaction.user && interaction.user.id !== currentPlayerId) {
    console.log('[MORPION] Mauvais tour: ce n\'est pas au tour de ce joueur');
    return interaction.reply?.({ 
      content: '❌ Ce n\'est pas à ton tour de jouer !', 
      ephemeral: true 
    });
  }
  
  const playerIndex = game.currentPlayer;
  const symbol = playerIndex === 0 ? 'X' : 'O';
  
  // Vérifier si la case est déjà prise
  if (game.board[index] !== null) {
    console.log('[MORPION] Case déjà prise:', index);
    if (interaction.reply) {
      return interaction.reply({ 
        content: '❌ Cette case est déjà prise !', 
        ephemeral: true 
      });
    }
    return;
  }
  
  // Mettre à jour le plateau
  game.board[index] = symbol;
  console.log('[MORPION] Plateau mis à jour:', game.board);
  
  // Vérifier s'il y a un gagnant
  const winner = checkTicTacToeWinner(game.board);
  const isDraw = !winner && game.board.every(cell => cell !== null);
  
  // Mettre à jour l'interface
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 5; j++) {
      const cellIndex = i * 5 + j;
      const button = new ButtonBuilder()
        .setCustomId(`ttt_${gameId}_${cellIndex}`)
        .setLabel(game.board[cellIndex] || '·')
        .setStyle(game.board[cellIndex] ? 
          (game.board[cellIndex] === 'X' ? ButtonStyle.Danger : ButtonStyle.Primary) : 
          ButtonStyle.Secondary
        )
        .setDisabled(!!(winner || isDraw || game.board[cellIndex] !== null)); // Désactiver si partie terminée ou case déjà prise
      
      row.addComponents(button);
    }
    rows.push(row);
  }
  
  // Mettre à jour le message
  const player1 = game.player1 || interaction.client.users.cache.get(game.players[0]);
  const player2 = game.player2 || interaction.client.users.cache.get(game.players[1]);
  
  console.log('[MORPION] Joueurs - Player1:', player1?.username, 'Player2:', player2?.username);
  
  const embed = new EmbedBuilder()
    .setTitle('⭕ Morpion ❌')
    .setColor(0x00ff00)
    .setThumbnail('https://i.imgur.com/undefined');
    
  if (game.bet > 0) {
    embed.addFields({ name: 'Mise', value: `${game.bet} ${config.currency.emoji} par joueur` });
  }
  
  if (isDraw) {
    embed.setDescription('**Match nul !**\nPersonne ne remporte la partie.');
    
    // Rembourser les mises en cas d'égalité
    if (game.bet > 0) {
      const user1 = ensureUser(game.players[0]);
      const user2 = ensureUser(game.players[1]);
      updateUser(game.players[0], { balance: user1.balance + game.bet });
      updateUser(game.players[1], { balance: user2.balance + game.bet });
      embed.addFields({ name: 'Remboursement', value: `Chaque joueur récupère sa mise de ${game.bet} ${config.currency.emoji}` });
    }
    
    // Désactiver tous les boutons
    rows.forEach(row => {
      row.components.forEach(button => button.setDisabled(true));
    });
    
    activeTicTacToeGames.delete(gameId);
  } else if (winner) {
    const winnerIndex = winner === 'X' ? 0 : 1;
    const winnerUser = winnerIndex === 0 ? player1 : player2;
    
    embed.setDescription(`**${winnerUser.username} a gagné !** 🎉`);
    
    // Distribuer les gains (remboursement de la mise + gain de la mise adverse)
    if (game.bet > 0) {
      const winnings = game.bet * 2; // Le gagnant récupère sa mise + la mise de l'adversaire
      const winnerData = ensureUser(winnerUser.id);
      updateUser(winnerUser.id, { balance: winnerData.balance + winnings });
      embed.addFields({ name: 'Gains', value: `${winnerUser} remporte ${winnings} ${config.currency.emoji} !` });
    }
    
    // Désactiver tous les boutons
    rows.forEach(row => {
      row.components.forEach(button => button.setDisabled(true));
    });
    
    activeTicTacToeGames.delete(gameId);
  } else {
    // Passer au joueur suivant
    game.currentPlayer = game.currentPlayer === 0 ? 1 : 0;
    game.currentPlayerId = game.players[game.currentPlayer];
    
    // Récupérer les informations du prochain joueur
    const nextPlayer = interaction.client.users.cache.get(game.currentPlayerId);
    const currentSymbol = game.currentPlayer === 0 ? '❌' : '⭕';
    
    console.log('[MORPION] Tour suivant - Joueur:', nextPlayer?.username, '(ID:', game.currentPlayerId, 'Index:', game.currentPlayer, ')');
    activeTicTacToeGames.set(gameId, game);
    
    embed.setDescription(
      `**${player1.username}** (❌) vs **${player2.username}** (⭕)\n\n` +
      `C'est au tour de ${nextPlayer} (${currentSymbol})`
    );
  }
  
  try {
    const isGameOver = winner || isDraw;
    const content = isGameOver 
      ? (winner 
          ? `🎉 **${winner === 'X' ? player1.username : player2.username}** a gagné la partie !`  
          : '🤝 Match nul !')
      : `${player1} vs ${player2} - Partie en cours`;
    
    console.log('[MORPION] Mise à jour du message avec contenu:', content);
    console.log('[MORPION] Nombre de rangées de boutons:', rows.length);
    
    await interaction.update({ 
      embeds: [embed],
      components: rows,
      content: content
    });
    
    console.log('[MORPION] Message mis à jour avec succès');
  } catch (error) {
    console.error('Erreur lors de la mise à jour du message:', error);
  }
}

// Fonction pour obtenir les statistiques d'un joueur
function getTicTacToeStats(userId) {
  const stmt = db.prepare(`
    SELECT * FROM tic_tac_toe_stats 
    WHERE user_id = ?
  `);
  
  const stats = stmt.get(userId) || {
    user_id: userId,
    wins: 0,
    losses: 0,
    draws: 0,
    games_played: 0
  };
  
  return stats;
}

// Fonction pour mettre à jour les statistiques d'une partie
function updateTicTacToeStats(winnerId, loserId, isDraw = false) {
  if (isDraw) {
    // Mettre à jour les matchs nuls pour les deux joueurs
    db.prepare(`
      INSERT INTO tic_tac_toe_stats (user_id, draws, games_played)
      VALUES (?, 1, 1)
      ON CONFLICT(user_id) DO UPDATE SET 
        draws = draws + 1,
        games_played = games_played + 1
    `).run(winnerId);
    
    db.prepare(`
      INSERT INTO tic_tac_toe_stats (user_id, draws, games_played)
      VALUES (?, 1, 1)
      ON CONFLICT(user_id) DO UPDATE SET 
        draws = draws + 1,
        games_played = games_played + 1
    `).run(loserId);
  } else {
    // Mettre à jour la victoire pour le gagnant
    db.prepare(`
      INSERT INTO tic_tac_toe_stats (user_id, wins, games_played)
      VALUES (?, 1, 1)
      ON CONFLICT(user_id) DO UPDATE SET 
        wins = wins + 1,
        games_played = games_played + 1
    `).run(winnerId);
    
    // Mettre à jour la défaite pour le perdant
    db.prepare(`
      INSERT INTO tic_tac_toe_stats (user_id, losses, games_played)
      VALUES (?, 1, 1)
      ON CONFLICT(user_id) DO UPDATE SET 
        losses = losses + 1,
        games_played = games_played + 1
    `).run(loserId);
  }
}

// Fonction pour obtenir le classement du morpion
function getTicTacToeLeaderboard(limit = 10) {
  const stmt = db.prepare(`
    SELECT user_id, wins, losses, draws,
           (wins * 1.0 / CASE WHEN (wins + losses + draws) > 0 THEN (wins + losses + draws) ELSE 1 END) as win_rate
    FROM tic_tac_toe_stats
    WHERE games_played > 0
    ORDER BY win_rate DESC, wins DESC
    LIMIT ?
  `);
  
  return stmt.all(limit);
}

// Fonction pour afficher le classement du morpion
async function handleTicTacToeLeaderboard(interaction) {
  try {
    const limit = interaction.options?.getInteger('limite') || 10;
    const leaderboard = getTicTacToeLeaderboard(limit);
    
    if (leaderboard.length === 0) {
      await interaction.reply({
        content: 'Aucune donnée de classement disponible pour le moment.',
        ephemeral: true
      });
      return;
    }
    
    // Récupérer les informations des utilisateurs
    const userPromises = leaderboard.map(async (entry, index) => {
      try {
        const user = await interaction.client.users.fetch(entry.user_id);
        const winRate = (entry.win_rate * 100).toFixed(1);
        return {
          rank: index + 1,
          username: user.username,
          wins: entry.wins,
          losses: entry.losses,
          draws: entry.draws,
          winRate
        };
      } catch (error) {
        console.error(`Erreur lors de la récupération de l'utilisateur ${entry.user_id}:`, error);
        return null;
      }
    });
    
    const leaderboardData = (await Promise.all(userPromises)).filter(Boolean);
    
    // Créer l'embed
    const embed = new EmbedBuilder()
      .setTitle('🏆 Classement du Morpion')
      .setColor(0x00ff00)
      .setDescription(`Top ${leaderboardData.length} des meilleurs joueurs de morpion`)
      .setTimestamp();
    
    // Ajouter les champs au classement
    const leaderboardFields = leaderboardData.map(entry => {
      return {
        name: `#${entry.rank} - ${entry.username}`,
        value: `✅ ${entry.wins} victoires | ❌ ${entry.losses} défaites | 🤝 ${entry.draws} matchs nuls\n📊 Taux de victoire: ${entry.winRate}%`,
        inline: false
      };
    });
    
    // Ajouter les champs par lots de 25 (limite de Discord)
    for (let i = 0; i < leaderboardFields.length; i += 25) {
      const fieldsBatch = leaderboardFields.slice(i, i + 25);
      embed.addFields(fieldsBatch);
    }
    
    // Afficher les statistiques de l'utilisateur actuel s'il n'est pas dans le top
    const currentUserStats = getTicTacToeStats(interaction.user.id);
    if (currentUserStats.games_played > 0) {
      const currentUserRank = leaderboard.findIndex(entry => entry.user_id === interaction.user.id);
      
      if (currentUserRank === -1) {
        const winRate = (currentUserStats.wins / currentUserStats.games_played * 100).toFixed(1);
        embed.addFields({
          name: '\u200B',
          value: `\nVotre classement: Hors du top ${limit}\n`  +
                 `✅ ${currentUserStats.wins} victoires | ❌ ${currentUserStats.losses} défaites | 🤝 ${currentUserStats.draws} matchs nuls\n`  +
                 `📊 Taux de victoire: ${winRate}%`
        });
      }
    }
    
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur lors de la génération du classement du morpion:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: 'Une erreur est survenue lors de la génération du classement.',
        ephemeral: true
      });
    }
  }
}

// Fonction pour réinitialiser les statistiques du morpion
function resetTicTacToeStats(userId = null) {
  if (userId) {
    return db.prepare(`
      DELETE FROM tic_tac_toe_stats
      WHERE user_id = ?
    `).run(userId);
  } else {
    return db.prepare(`
      DELETE FROM tic_tac_toe_stats
    `).run();
  }
}

// Exporter les fonctions
module.exports = {
  handleTicTacToe,
  handleTicTacToeMove,
  handleTicTacToeLeaderboard,
  getTicTacToeLeaderboard,
  resetTicTacToeStats,
  activeTicTacToeGames
};
