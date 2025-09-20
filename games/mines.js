const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

// Objet pour stocker les parties en cours
const activeMinesGames = new Map();

// Constantes du jeu
const GRID_SIZE = 5;
const MINE_EMOJI = '💣';
const GEM_EMOJI = '💎';
const HIDDEN_EMOJI = '⬛';
const FLAG_EMOJI = '🚩';
const CASH_OUT_EMBED_COLOR = 0x00FF00;
const GAME_OVER_EMBED_COLOR = 0xFF0000;

// Multiplicateurs en fonction du nombre de mines
const MULTIPLIERS = {
  1: 1.5,
  3: 2,
  5: 3,
  10: 5,
  15: 10
};

// Créer une nouvelle grille de jeu
function createGameGrid(minesCount) {
  // Créer une grille vide
  const grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
  
  // Placer les mines aléatoirement
  let minesPlaced = 0;
  while (minesPlaced < minesCount) {
    const x = Math.floor(Math.random() * GRID_SIZE);
    const y = Math.floor(Math.random() * GRID_SIZE);
    
    if (grid[x][y] !== 'mine') {
      grid[x][y] = 'mine';
      minesPlaced++;
      
      // Incrémenter les compteurs de mines adjacentes
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && grid[nx][ny] !== 'mine') {
            grid[nx][ny]++;
          }
        }
      }
    }
  }
  
  return grid;
}

// Créer les composants de la grille
function createGridComponents(gameState) {
  const rows = [];
  
  for (let i = 0; i < GRID_SIZE; i++) {
    const row = [];
    
    for (let j = 0; j < GRID_SIZE; j++) {
      const cell = gameState.revealed[i][j];
      const cellValue = gameState.grid[i][j];
      
      let emoji = HIDDEN_EMOJI;
      if (cell === 'revealed') {
        emoji = cellValue === 'mine' ? MINE_EMOJI : (cellValue > 0 ? getNumberEmoji(cellValue) : '⬜');
      } else if (cell === 'flagged') {
        emoji = FLAG_EMOJI;
      }
      
      row.push(
        new ButtonBuilder()
          .setCustomId(`mines_${i}_${j}`)
          .setEmoji(emoji)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(gameState.gameOver)
      );
    }
    
    rows.push(new ActionRowBuilder().addComponents(row));
  }
  
  // Ajouter les boutons d'action
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mines_cashout')
      .setLabel('Prendre les gains')
      .setStyle(ButtonStyle.Success)
      .setEmoji('💰')
      .setDisabled(gameState.gameOver),
    new ButtonBuilder()
      .setCustomId('mines_flag')
      .setLabel('Mode Drapeau')
      .setStyle(gameState.flagMode ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setEmoji('🚩')
      .setDisabled(gameState.gameOver)
  );
  
  rows.push(actionRow);
  return rows;
}

// Obtenir l'emoji correspondant au nombre
function getNumberEmoji(number) {
  const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  return numberEmojis[number] || number.toString();
}

// Créer l'embed du jeu
function createGameEmbed(gameState, interaction) {
  const embed = new EmbedBuilder()
    .setTitle('💎 Mines Game')
    .setDescription(`**Mise :** ${gameState.bet} ${config.currency.emoji}\n` +
                   `**Multiplicateur actuel :** x${(MULTIPLIERS[gameState.minesCount] * (1 + gameState.revealedCount * 0.1)).toFixed(2)}\n` +
                   `**Gains potentiels :** ${Math.floor(gameState.bet * MULTIPLIERS[gameState.minesCount] * (1 + gameState.revealedCount * 0.1))} ${config.currency.emoji}\n` +
                   `**Mines restantes :** ${gameState.minesCount - gameState.flaggedCount}`)
    .setColor(0x0099FF)
    .setFooter({ 
      text: `Joueur: ${interaction.user.username}`, 
      iconURL: interaction.user.displayAvatarURL() 
    });
    
  if (gameState.gameOver) {
    if (gameState.won) {
      embed.setTitle('🎉 Victoire !')
           .setDescription(`Vous avez gagné **${gameState.winAmount}** ${config.currency.emoji} !`)
           .setColor(CASH_OUT_EMBED_COLOR);
    } else {
      embed.setTitle('💥 Partie terminée')
           .setDescription(`Vous avez trouvé une mine ! Votre mise est perdue.`)
           .setColor(GAME_OVER_EMBED_COLOR);
    }
  }
  
  return embed;
}

// Gérer la révélation d'une case
function revealCell(gameState, x, y) {
  // Vérifier les limites
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE || gameState.revealed[x][y] !== 'hidden') {
    return false;
  }
  
  // Vérifier si c'est une mine
  if (gameState.grid[x][y] === 'mine') {
    gameState.gameOver = true;
    gameState.won = false;
    return true;
  }
  
  // Révéler la case
  gameState.revealed[x][y] = 'revealed';
  gameState.revealedCount++;
  
  // Si c'est une case vide, révéler récursivement les cases adjacentes
  if (gameState.grid[x][y] === 0) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx !== 0 || dy !== 0) {
          revealCell(gameState, x + dx, y + dy);
        }
      }
    }
  }
  
  return false;
}

// Calculer les gains actuels
function calculateCurrentWin(gameState) {
  return Math.floor(gameState.bet * MULTIPLIERS[gameState.minesCount] * (1 + gameState.revealedCount * 0.1));
}

// Initialiser une nouvelle partie
function initGame(interaction, bet, minesCount) {
  const gameState = {
    userId: interaction.user.id,
    bet: bet,
    minesCount: minesCount,
    grid: createGameGrid(minesCount),
    revealed: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('hidden')),
    revealedCount: 0,
    flaggedCount: 0,
    flagMode: false,
    gameOver: false,
    won: false,
    message: null
  };
  
  activeMinesGames.set(interaction.user.id, gameState);
  return gameState;
}

// Gérer l'interaction d'un bouton
async function handleButtonInteraction(interaction) {
  const [_, action, x, y] = interaction.customId.split('_');
  const gameState = activeMinesGames.get(interaction.user.id);
  
  if (!gameState) {
    await interaction.update({ content: 'Partie introuvable ou terminée.', components: [] });
    return;
  }
  
  if (action === 'cashout') {
    // Le joueur prend les gains
    const winAmount = calculateCurrentWin(gameState);
    gameState.gameOver = true;
    gameState.won = true;
    gameState.winAmount = winAmount;
    
    // Mettre à jour le solde de l'utilisateur
    const user = ensureUser(interaction.user.id);
    updateUser(interaction.user.id, { balance: (user.balance || 0) + winAmount });
    
    // Mettre à jour le message
    await interaction.update({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState)
    });
    
    // Supprimer la partie
    activeMinesGames.delete(interaction.user.id);
    return;
  }
  
  if (action === 'flag') {
    // Basculer le mode drapeau
    gameState.flagMode = !gameState.flagMode;
    
    await interaction.update({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState)
    });
    return;
  }
  
  // Gérer le clic sur une case
  const posX = parseInt(x);
  const posY = parseInt(y);
  
  if (gameState.flagMode) {
    // Mode drapeau : marquer/démarquer une case
    if (gameState.revealed[posX][posY] === 'hidden') {
      gameState.revealed[posX][posY] = 'flagged';
      gameState.flaggedCount++;
    } else if (gameState.revealed[posX][posY] === 'flagged') {
      gameState.revealed[posX][posY] = 'hidden';
      gameState.flaggedCount--;
    }
  } else {
    // Mode normal : révéler une case
    if (gameState.revealed[posX][posY] === 'flagged') {
      // Ne rien faire si la case est marquée
      await interaction.deferUpdate();
      return;
    }
    
    const isMine = revealCell(gameState, posX, posY);
    
    if (isMine) {
      // Le joueur a perdu
      gameState.gameOver = true;
      gameState.won = false;
      
      // Révéler toutes les mines
      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          if (gameState.grid[i][j] === 'mine') {
            gameState.revealed[i][j] = 'revealed';
          }
        }
      }
    } else if (gameState.revealedCount === (GRID_SIZE * GRID_SIZE - gameState.minesCount)) {
      // Toutes les cases non-minées ont été révélées
      const winAmount = calculateCurrentWin(gameState);
      gameState.gameOver = true;
      gameState.won = true;
      gameState.winAmount = winAmount;
      
      // Mettre à jour le solde de l'utilisateur
      const user = ensureUser(interaction.user.id);
      updateUser(interaction.user.id, { balance: (user.balance || 0) + winAmount });
    }
  }
  
  // Mettre à jour le message
  await interaction.update({
    embeds: [createGameEmbed(gameState, interaction)],
    components: createGridComponents(gameState)
  });
  
  // Supprimer la partie si elle est terminée
  if (gameState.gameOver) {
    activeMinesGames.delete(interaction.user.id);
  }
}

// Commande pour démarrer une nouvelle partie
async function handleMinesCommand(interaction) {
  const bet = interaction.options.getInteger('mise');
  const minesCount = interaction.options.getInteger('mines') || 5;
  
  // Vérifier la mise minimale
  if (bet < 10) {
    return interaction.reply({
      content: `La mise minimale est de 10 ${config.currency.emoji}.`,
      ephemeral: true
    });
  }
  
  // Vérifier le solde de l'utilisateur
  const user = ensureUser(interaction.user.id);
  if ((user.balance || 0) < bet) {
    return interaction.reply({
      content: `Vous n'avez pas assez de ${config.currency.emoji} pour cette mise.`,
      ephemeral: true
    });
  }
  
  // Vérifier le nombre de mines
  if (minesCount < 1 || minesCount > 15) {
    return interaction.reply({
      content: 'Le nombre de mines doit être compris entre 1 et 15.',
      ephemeral: true
    });
  }
  
  // Vérifier si l'utilisateur a déjà une partie en cours
  if (activeMinesGames.has(interaction.user.id)) {
    return interaction.reply({
      content: 'Vous avez déjà une partie en cours. Terminez-la avant d\'en commencer une nouvelle.',
      ephemeral: true
    });
  }
  
  try {
    // Retirer la mise du solde de l'utilisateur
    updateUser(interaction.user.id, { balance: (user.balance || 0) - bet });
    
    // Initialiser la partie
    const gameState = initGame(interaction, bet, minesCount);
    
    // Envoyer le message de jeu
    const message = await interaction.reply({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState),
      fetchReply: true
    });
    
    // Stocker le message dans l'état du jeu
    gameState.message = message;
    
  } catch (error) {
    console.error('Erreur lors du démarrage du jeu des mines:', error);
    interaction.reply({
      content: 'Une erreur est survenue lors du démarrage du jeu. Veuillez réessayer.',
      ephemeral: true
    });
  }
}

// Gérer l'interaction des boutons du jeu des mines
async function handleMinesButtonInteraction(interaction) {
  // Vérifier si c'est une interaction valide
  if (!interaction.isButton()) return;
  
  // Extraire l'ID du jeu et les coordonnées de la cellule (si applicable)
  const gameId = interaction.message.id;
  const game = activeMinesGames.get(gameId);
  
  // Vérifier si la partie existe
  if (!game) {
    await interaction.update({
      content: '⚠️ Partie introuvable ou expirée. Utilisez la commande `/mines` pour commencer une nouvelle partie.',
      components: []
    });
    return;
  }
  
  // Vérifier que l'utilisateur est bien le joueur de la partie
  if (game.userId !== interaction.user.id) {
    await interaction.reply({
      content: '❌ Vous ne pouvez pas interagir avec cette partie.',
      ephemeral: true
    });
    return;
  }
  
  // Gérer l'interaction en fonction du bouton cliqué
  if (interaction.customId === 'mines_cashout') {
    // Le joueur choisit de prendre les gains
    await handleCashOut(game, interaction);
  } else if (interaction.customId === 'mines_flag') {
    // Le joueur active/désactive le mode drapeau
    game.flagMode = !game.flagMode;
    
    // Mettre à jour le message avec le nouvel état
    const components = createGridComponents(game);
    const embed = createGameEmbed(game, interaction);
    
    await interaction.update({
      embeds: [embed],
      components: components
    });
  } else if (interaction.customId.startsWith('mines_')) {
    // Le joueur a cliqué sur une cellule
    const [_, x, y] = interaction.customId.split('_');
    const row = parseInt(x);
    const col = parseInt(y);
    
    // Vérifier si la cellule est déjà révélée
    if (game.revealed[row][col] === 'revealed') {
      await interaction.deferUpdate();
      return;
    }
    
    // Gérer le mode drapeau
    if (game.flagMode) {
      // Basculer l'état du drapeau
      game.revealed[row][col] = game.revealed[row][col] === 'flagged' ? 'hidden' : 'flagged';
      
      // Mettre à jour le message
      const components = createGridComponents(game);
      const embed = createGameEmbed(game, interaction);
      
      await interaction.update({
        embeds: [embed],
        components: components
      });
    } else {
      // Révéler la cellule
      await revealCell(game, row, col, interaction);
    }
  }
}

// Gérer l'action de prise des gains
async function handleCashOut(game, interaction) {
  // Calculer les gains
  const winAmount = calculateCurrentWin(game);
  
  // Mettre à jour le solde de l'utilisateur
  const user = ensureUser(game.userId);
  updateUser(game.userId, { balance: user.balance + winAmount });
  
  // Marquer la partie comme terminée
  game.gameOver = true;
  
  // Mettre à jour le message avec le résultat
  const embed = new EmbedBuilder()
    .setTitle('🏆 Gains récupérés !')
    .setDescription(`Vous avez gagné **${winAmount}** ${config.currency.emoji} !`)
    .setColor(CASH_OUT_EMBED_COLOR)
    .setFooter({ text: `Nouveau solde: ${user.balance + winAmount} ${config.currency.emoji}` });
  
  // Afficher toutes les mines
  const components = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const row = [];
    for (let j = 0; j < GRID_SIZE; j++) {
      const cell = game.grid[i][j];
      const isRevealed = game.revealed[i][j] === 'revealed';
      const isFlagged = game.revealed[i][j] === 'flagged';
      
      let emoji = HIDDEN_EMOJI;
      if (isRevealed) {
        emoji = cell === 'mine' ? MINE_EMOJI : (cell > 0 ? getNumberEmoji(cell) : '⬜');
      } else if (isFlagged) {
        emoji = FLAG_EMOJI;
      } else if (cell === 'mine') {
        emoji = MINE_EMOJI;
      }
      
      row.push(
        new ButtonBuilder()
          .setCustomId(`mines_${i}_${j}`)
          .setEmoji(emoji)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
    }
    components.push(new ActionRowBuilder().addComponents(row));
  }
  
  // Ajouter un bouton pour rejouer
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mines_play_again')
      .setLabel('Rejouer')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄')
  );
  components.push(actionRow);
  
  await interaction.update({
    embeds: [embed],
    components: components
  });
  
  // Supprimer la partie de la mémoire
  activeMinesGames.delete(interaction.message.id);
}

module.exports = {
  handleMinesCommand,
  handleMinesButtonInteraction
};
