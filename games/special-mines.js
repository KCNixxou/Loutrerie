const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser, getSpecialBalance, updateSpecialBalance, addSpecialWagered, addSpecialWinnings } = require('../database');

// Objet pour stocker les parties en cours
const activeSpecialMinesGames = new Map();

// Constantes du jeu (mêmes que pour le jeu des mines normal)
const GRID_SIZE = 4;
const MINE_EMOJI = '💣';
const GEM_EMOJI = '💎';
const HIDDEN_EMOJI = '⬛';
const CASH_OUT_EMBED_COLOR = 0x00FF00;
const GAME_OVER_EMBED_COLOR = 0xFF0000;

// Tableau des multiplicateurs pour chaque gemme trouvée
const MULTIPLIERS = [
  1.00,  // 0 gemme (non utilisé)
  1.15,  // 1 gemme
  1.50,  // 2 gemmes
  2.00,  // 3 gemmes
  2.50,  // 4 gemmes
  3.00,  // 5 gemmes
  3.50,  // 6 gemmes
  4.00,  // 7 gemmes
  4.50,  // 8 gemmes
  5.00,  // 9 gemmes
  5.50,  // 10 gemmes
  6.00,  // 11 gemmes
  6.50,  // 12 gemmes
  7.00,  // 13 gemmes
  7.50,  // 14 gemmes
  8.00   // 15 gemmes
];

// Créer une nouvelle grille de jeu simplifiée
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
function createGridComponents(gameState, showAll = false) {
  const rows = [];
  
  for (let i = 0; i < GRID_SIZE; i++) {
    const row = new ActionRowBuilder();
    
    for (let j = 0; j < GRID_SIZE; j++) {
      const cellValue = gameState.grid[i][j];
      const isRevealed = gameState.revealed[i][j] === 'revealed';
      
      let emoji = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary;

      if (isRevealed || (showAll && gameState.gameOver)) {
        if (cellValue === 'mine') {
          emoji = MINE_EMOJI;
          style = ButtonStyle.Danger;
        } else {
          emoji = GEM_EMOJI;
          style = ButtonStyle.Success;
        }
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`special_mines_${i}_${j}`)
          .setEmoji(emoji)
          .setStyle(style)
          .setDisabled(isRevealed || gameState.gameOver)
      );
    }
    
    if (i === GRID_SIZE - 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('special_mines_cashout')
          .setLabel('Prendre')
          .setStyle(ButtonStyle.Success)
          .setEmoji('💰')
          .setDisabled(gameState.gameOver || gameState.revealedCount === 0)
      );
    }
    
    rows.push(row);
  }
  
  return rows;
}

// Créer l'embed du jeu
function createGameEmbed(gameState, interaction) {
  const embed = new EmbedBuilder()
    .setTitle('💎 Mines Spéciales')
    .setColor(0x00FFFF)
    .addFields(
      { name: 'Mise', value: `${gameState.bet} ${config.currency.emoji}`, inline: true },
      { name: 'Multiplicateur actuel', value: `x${MULTIPLIERS[gameState.revealedCount].toFixed(2)}`, inline: true },
      { name: 'Gains potentiels', value: `${Math.floor(gameState.bet * MULTIPLIERS[gameState.revealedCount])} ${config.currency.emoji}`, inline: true },
      { name: 'Gemmes trouvées', value: `${gameState.revealedCount} / ${GRID_SIZE * GRID_SIZE - gameState.minesCount}`, inline: true },
      { name: 'Mines restantes', value: `${gameState.minesCount - gameState.minesFound}`, inline: true }
    )
    .setFooter({ text: `Joueur: ${interaction.user.username}` })
    .setTimestamp();

  if (gameState.gameOver) {
    if (gameState.won) {
      embed.setDescription('🎉 **Félicitations !** Vous avez gagné !');
      embed.setColor(CASH_OUT_EMBED_COLOR);
    } else {
      embed.setDescription('💥 **Perdu !** Vous avez trouvé une mine !');
      embed.setColor(GAME_OVER_EMBED_COLOR);
    }
  }

  return embed;
}

// Gérer la révélation d'une case
function revealCell(gameState, x, y) {
  if (gameState.revealed[x][y] === 'revealed') {
    return { gameOver: false, won: false };
  }

  gameState.revealed[x][y] = 'revealed';
  
  if (gameState.grid[x][y] === 'mine') {
    gameState.gameOver = true;
    gameState.won = false;
    return { gameOver: true, won: false };
  }

  gameState.revealedCount++;
  
  // Vérifier si le joueur a gagné
  const totalGems = (GRID_SIZE * GRID_SIZE) - gameState.minesCount;
  if (gameState.revealedCount === totalGems) {
    gameState.gameOver = true;
    gameState.won = true;
    return { gameOver: true, won: true };
  }
  
  return { gameOver: false, won: false };
}

// Calculer les gains actuels
function calculateCurrentWin(gameState) {
  const multiplier = MULTIPLIERS[gameState.revealedCount];
  return Math.floor(gameState.bet * multiplier);
}

// Commande pour démarrer une nouvelle partie
async function handleSpecialMinesCommand(interaction) {
  const bet = interaction.options.getInteger('mise');
  const minesCount = 3; // Nombre fixe de 3 mines, comme dans le jeu classique
  const userId = interaction.user.id;
  
  // Vérifier si l'utilisateur a déjà une partie en cours
  cleanupOldGames(userId);
  if (activeSpecialMinesGames.has(userId)) {
    return interaction.reply({ 
      content: 'Vous avez déjà une partie en cours ! Terminez-la d\'abord.',
      ephemeral: true 
    });
  }
  
  // Vérifier le solde spécial
  const specialBalance = getSpecialBalance(userId);
  if (bet > specialBalance) {
    return interaction.reply({ 
      content: `❌ Solde spécial insuffisant ! Vous avez ${specialBalance} ${config.currency.emoji}`,
      ephemeral: true 
    });
  }
  
  // Vérifier la mise maximale
  const { specialHighLow } = require('../config');
  if (bet > specialHighLow.maxBet) {
    return interaction.reply({ 
      content: `❌ Mise maximale: ${specialHighLow.maxBet} ${config.currency.emoji} pour le salon spécial.`,
      ephemeral: true 
    });
  }
  
  // Déduire la mise du solde spécial
  updateSpecialBalance(userId, -bet);
  addSpecialWagered(userId, bet);
  
  // Créer une nouvelle partie
  const gameState = {
    userId,
    bet,
    minesCount,
    grid: createGameGrid(minesCount),
    revealed: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('hidden')),
    revealedCount: 0,
    minesFound: 0,
    gameOver: false,
    won: false,
    startTime: Date.now(),
    isSpecial: true
  };
  
  // Enregistrer la partie
  activeSpecialMinesGames.set(userId, gameState);
  
  // Créer et envoyer le message du jeu
  const embed = createGameEmbed(gameState, interaction);
  const components = createGridComponents(gameState);
  
  await interaction.reply({ 
    content: '💎 **Mines Spéciales** - Trouvez les gemmes et évitez les mines !',
    embeds: [embed],
    components 
  });
}

// Nettoyer les anciennes parties
function cleanupOldGames(userId) {
  const now = Date.now();
  const gameState = activeSpecialMinesGames.get(userId);
  
  if (gameState && (now - gameState.startTime) > 3600000) { // 1 heure d'inactivité
    activeSpecialMinesGames.delete(userId);
  }
}

// Gérer l'interaction des boutons du jeu
async function handleSpecialMinesInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('special_mines_')) return;
  
  const userId = interaction.user.id;
  const gameState = activeSpecialMinesGames.get(userId);
  
  // Vérifier si l'utilisateur a une partie en cours
  if (!gameState) {
    return interaction.reply({ 
      content: 'Aucune partie en cours. Utilisez `/special-mines` pour commencer une nouvelle partie.',
      ephemeral: true 
    });
  }
  
  // Vérifier si c'est bien le bon utilisateur
  if (gameState.userId !== userId) {
    return interaction.reply({ 
      content: 'Ce n\'est pas votre partie !',
      ephemeral: true 
    });
  }
  
  // Vérifier si la partie est terminée
  if (gameState.gameOver) {
    return interaction.update({ 
      content: 'Cette partie est déjà terminée. Utilisez `/special-mines` pour recommencer.',
      components: [] 
    });
  }
  
  // Gérer les actions
  if (interaction.customId === 'special_mines_cashout') {
    // Le joueur prend ses gains
    const winnings = calculateCurrentWin(gameState);
    updateSpecialBalance(userId, winnings);
    addSpecialWinnings(userId, winnings - gameState.bet);
    
    gameState.gameOver = true;
    gameState.won = true;
    
    const embed = createGameEmbed(gameState, interaction);
    const components = createGridComponents(gameState, true);
    
    await interaction.update({ 
      content: `🎉 Vous avez pris vos gains de **${winnings}** ${config.currency.emoji} !`,
      embeds: [embed],
      components 
    });
    
    // Supprimer la partie
    activeSpecialMinesGames.delete(userId);
    return;
  }
  
  // Gérer le clic sur une case
  const coords = interaction.customId.replace('special_mines_', '').split('_');
  const x = parseInt(coords[0]);
  const y = parseInt(coords[1]);
  
  const result = revealCell(gameState, x, y);
  
  if (result.gameOver) {
    if (result.won) {
      // Le joueur a gagné en trouvant toutes les gemmes
      const winnings = calculateCurrentWin(gameState);
      updateSpecialBalance(userId, winnings);
      addSpecialWinnings(userId, winnings - gameState.bet);
      
      const embed = createGameEmbed(gameState, interaction);
      const components = createGridComponents(gameState, true);
      
      await interaction.update({ 
        content: `🎉 Félicitations ! Vous avez trouvé toutes les gemmes et gagné **${winnings}** ${config.currency.emoji} !`,
        embeds: [embed],
        components 
      });
    } else {
      // Le joueur a perdu en trouvant une mine
      const embed = createGameEmbed(gameState, interaction);
      const components = createGridComponents(gameState, true);
      
      await interaction.update({ 
        content: `💥 Dommage ! Vous avez trouvé une mine et perdu votre mise de ${gameState.bet} ${config.currency.emoji}.`,
        embeds: [embed],
        components 
      });
    }
    
    // Supprimer la partie dans tous les cas
    activeSpecialMinesGames.delete(userId);
    return;
  }
  
  // Mettre à jour l'affichage
  const embed = createGameEmbed(gameState, interaction);
  const components = createGridComponents(gameState);
  
  await interaction.update({ 
    embeds: [embed],
    components 
  });
}

module.exports = {
  handleSpecialMinesCommand,
  handleSpecialMinesInteraction
};
