const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser } = require('../database');

// Objet pour stocker les parties en cours
const activeMinesGames = new Map();

// Constantes du jeu
const GRID_SIZE = 4; // Réduit à 4 pour laisser de la place au bouton d'action
const MINE_EMOJI = '💣';
const GEM_EMOJI = '💎';
const HIDDEN_EMOJI = '⬛';
const CASH_OUT_EMBED_COLOR = 0x00FF00;
const GAME_OVER_EMBED_COLOR = 0xFF0000;

// Multiplicateurs de base en fonction du nombre de mines
const MULTIPLIERS = {
  1: 1.05,
  3: 1.15,
  5: 1.25,
  10: 1.5,
  15: 2.0
};

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
  
  // Créer 4 rangées de 4 boutons
  for (let i = 0; i < GRID_SIZE; i++) {
    const row = new ActionRowBuilder();
    
    for (let j = 0; j < GRID_SIZE; j++) {
      const cellValue = gameState.grid[i][j];
      const isRevealed = gameState.revealed[i][j] === 'revealed';
      
      let emoji = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary;

      if (isRevealed || showAll) {
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
          .setCustomId(`mines_${i}_${j}`)
          .setEmoji(emoji)
          .setStyle(style)
          .setDisabled(isRevealed || gameState.gameOver)
      );
    }
    
    // Ajouter le bouton "Prendre les gains" à la dernière rangée
    if (i === GRID_SIZE - 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('mines_cashout')
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
  const winAmount = calculateCurrentWin(gameState);
  const embed = new EmbedBuilder()
    .setTitle('💎 Jeu des Mines')
    .setDescription(`Cliquez sur les cases pour trouver des gemmes !\nChaque gemme augmente vos gains, mais attention aux mines...`)
    .setColor(0x0099FF)
    .addFields(
      { name: 'Mise', value: `${gameState.bet} ${config.currency.emoji}`, inline: true },
      { name: 'Mines', value: `${gameState.minesCount}`, inline: true },
      { name: 'Gemmes trouvées', value: `${gameState.revealedCount}`, inline: true },
      { name: 'Gains potentiels', value: `**${winAmount}** ${config.currency.emoji}` }
    )
    .setFooter({ 
      text: `Joueur: ${interaction.user.username}`, 
      iconURL: interaction.user.displayAvatarURL() 
    });
    
  if (gameState.gameOver) {
    if (gameState.won) {
      embed.setTitle('🎉 Gains récupérés !')
           .setDescription(`Vous avez empoché **${gameState.winAmount}** ${config.currency.emoji} !`)
           .setFields([])
           .setColor(CASH_OUT_EMBED_COLOR);
    } else {
      embed.setTitle('💥 BOOM !')
           .setDescription(`Vous avez cliqué sur une mine ! Votre mise de **${gameState.bet}** ${config.currency.emoji} est perdue.`)
           .setFields([])
           .setColor(GAME_OVER_EMBED_COLOR);
    }
  }
  
  return embed;
}

// Gérer la révélation d'une case
function revealCell(gameState, x, y) {
  if (gameState.revealed[x][y] !== 'hidden') return;
  
  gameState.revealed[x][y] = 'revealed';

  if (gameState.grid[x][y] === 'mine') {
    gameState.gameOver = true;
    gameState.won = false;
    return;
  }
  
  gameState.revealedCount++;
}

// Calculer les gains actuels
function calculateCurrentWin(gameState) {
  if (gameState.revealedCount === 0) return 0;
  const baseMultiplier = MULTIPLIERS[gameState.minesCount] || 1.25;
  const revealedMultiplier = Math.pow(1.15, gameState.revealedCount);
  return Math.floor(gameState.bet * baseMultiplier * revealedMultiplier);
}

// Commande pour démarrer une nouvelle partie
async function handleMinesCommand(interaction) {
  const bet = interaction.options.getInteger('mise');
  const minesCount = interaction.options.getInteger('mines') || 5;

  if (bet < 10) {
    return interaction.reply({ content: `La mise minimale est de 10 ${config.currency.emoji}.`, ephemeral: true });
  }

  const user = ensureUser(interaction.user.id);
  if ((user.balance || 0) < bet) {
    return interaction.reply({ content: `Vous n'avez pas assez de ${config.currency.emoji} pour cette mise.`, ephemeral: true });
  }

  if (minesCount < 1 || minesCount > 15) {
    return interaction.reply({ content: 'Le nombre de mines doit être compris entre 1 et 15.', ephemeral: true });
  }

  if (activeMinesGames.has(interaction.user.id)) {
    return interaction.reply({ content: 'Vous avez déjà une partie en cours. Terminez-la avant d\'en commencer une nouvelle.', ephemeral: true });
  }

  try {
    updateUser(interaction.user.id, { balance: user.balance - bet });

    const gameState = {
      userId: interaction.user.id,
      bet: bet,
      minesCount: minesCount,
      grid: createGameGrid(minesCount),
      revealed: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('hidden')),
      revealedCount: 0,
      gameOver: false,
      won: false
    };

    activeMinesGames.set(interaction.user.id, gameState);

    await interaction.reply({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState)
    });

  } catch (error) {
    console.error('Erreur lors du démarrage du jeu des mines:', error);
    // Rembourser l'utilisateur en cas d'erreur
    updateUser(interaction.user.id, { balance: user.balance });
    interaction.reply({ content: 'Une erreur est survenue lors du démarrage du jeu. Veuillez réessayer.', ephemeral: true });
  }
}

// Gérer l'interaction des boutons du jeu
async function handleMinesButtonInteraction(interaction) {
  const gameState = activeMinesGames.get(interaction.user.id);
  
  if (!gameState) {
    await interaction.update({ content: 'Partie introuvable ou terminée.', components: [] });
    return;
  }

  if (gameState.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Ce n\'est pas votre partie !', ephemeral: true });
  }

  const [_, action, x, y] = interaction.customId.split('_');
  
  if (action === 'cashout') {
    const winAmount = calculateCurrentWin(gameState);
    gameState.gameOver = true;
    gameState.won = true;
    gameState.winAmount = winAmount;
    
    if (winAmount > 0) {
      const user = ensureUser(interaction.user.id);
      updateUser(interaction.user.id, { balance: user.balance + winAmount + gameState.bet });
    }
    
    await interaction.update({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState, true)
    });
    
    activeMinesGames.delete(interaction.user.id);
    return;
  }
  
  const posX = parseInt(x);
  const posY = parseInt(y);
  
  if (gameState.revealed[posX][posY] !== 'hidden') {
    return interaction.deferUpdate();
  }

  revealCell(gameState, posX, posY);
  
  if (gameState.gameOver) {
    await interaction.update({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState, true)
    });
    
    activeMinesGames.delete(interaction.user.id);
    return;
  }

  await interaction.update({
    embeds: [createGameEmbed(gameState, interaction)],
    components: createGridComponents(gameState)
  });
}

module.exports = {
  handleMinesCommand,
  handleMinesButtonInteraction
};