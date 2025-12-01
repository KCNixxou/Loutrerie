const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { ensureUser, updateUser, getUserEffects, useEffect, hasActiveEffect, calculateEffectMultiplier, applyDoubleOrNothing, checkLossProtection } = require('../database');
const { updateUserGameStats, handleGameWin, handleGameLose } = require('../utils/missionUtils');

// Objet pour stocker les parties en cours
// Utilise l'ID du message comme clé pour permettre plusieurs parties en même temps
const activeMinesGames = new Map();

// Constantes du jeu
const GRID_SIZE = 4; // Réduit à 4 pour laisser de la place au bouton d'action
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

// Fonction pour afficher la grille dans la console (pour le débogage)
function logMinesGrid(grid, userId) {
  console.log(`\n[MINES] Grille des mines pour l'utilisateur ${userId}:`);
  console.log('  0 1 2 3');
  for (let i = 0; i < GRID_SIZE; i++) {
    let row = `${i} `;
    for (let j = 0; j < GRID_SIZE; j++) {
      row += grid[i][j] === 'mine' ? '💣 ' : '💎 ';
    }
    console.log(row);
  }
  console.log('');
}

// Créer une nouvelle grille de jeu simplifiée
function createGameGrid(minesCount, userId) {
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
  
  // Afficher la grille dans la console
  logMinesGrid(grid, userId);
  
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
      
      // Toujours utiliser l'émoji caché au démarrage, sauf si la case est révélée
      let emoji = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary;

      // Afficher le contenu uniquement si la case est révélée ou si on force l'affichage
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
  const guildId = gameState.guildId || interaction.guildId || null;
  
  console.log(`[MINES] createGameEmbed - userId: ${gameState.userId}, guildId: ${guildId}`);
  
  // Test direct pour voir tous les effets de l'utilisateur
  let effects = [];
  try {
    effects = getUserEffects(gameState.userId, guildId) || [];
    console.log(`[MINES] Effets trouvés (${effects.length}):`, effects);
    console.log(`[MINES] Type de effects:`, typeof effects, Array.isArray(effects));
    
    // Vérifier spécifiquement le casino_bonus
    const casinoBonus = effects.filter(e => e.effect === 'casino_bonus');
    console.log(`[MINES] Effets casino_bonus:`, casinoBonus);
  } catch (error) {
    console.error('[MINES] Erreur getUserEffects:', error);
    effects = [];
  }
  
  const effectMultiplier = calculateEffectMultiplier(gameState.userId, guildId);
  console.log(`[MINES] Multiplicateur calculé: ${effectMultiplier}`);
  
  const embed = new EmbedBuilder()
    .setTitle('💎 Jeu des Mines')
    .setDescription(`Cliquez sur les cases pour trouver des gemmes !\nChaque gemme augmente vos gains, mais attention aux mines...`)
    .setColor(0x0099FF)
    .addFields(
      { name: 'Mise', value: `${gameState.originalBet || gameState.bet} ${config.currency.emoji}`, inline: true },
      { name: 'Mines', value: `${gameState.minesCount}`, inline: true },
      { name: 'Gemmes trouvées', value: `${gameState.revealedCount}`, inline: true },
      { name: 'Gains potentiels', value: `**${winAmount}** ${config.currency.emoji}` }
    )
    .setFooter({ 
      text: `Joueur: ${interaction.user.username}`, 
      iconURL: interaction.user.displayAvatarURL() 
    });
  
  // Ajouter les effets actifs s'il y en a
  if (effects.length > 0) {
    const effectDescriptions = effects.map(effect => {
      const timeLeft = effect.expires_at ? Math.floor((effect.expires_at - Date.now()) / 1000 / 60) : null;
      const timeText = timeLeft ? ` (${timeLeft}min)` : '';
      const usesText = effect.uses > 0 ? ` (${effect.uses}x)` : '';
      return `🔮 ${effect.description || effect.effect}${timeText}${usesText}`;
    }).join('\n');
    
    embed.addFields({
      name: '💊 Effets actifs',
      value: effectDescriptions,
      inline: false
    });
    
    // Ajouter le multiplicateur total si > 1
    if (effectMultiplier > 1.0) {
      embed.addFields({
        name: '✨ Multiplicateur total',
        value: `x${effectMultiplier.toFixed(2)}`,
        inline: true
      });
    }
  }
    
  if (gameState.gameOver) {
    // Récupérer le solde actuel de l'utilisateur
    const guildId = gameState.guildId || interaction.guildId || null;
  const user = ensureUser(gameState.userId, guildId);
    
    if (gameState.won) {
      // Pour un cashout, les gains sont déjà crédités
      embed.setTitle('🎉 Gains récupérés !')
           .setDescription(
             `Vous avez empoché **${gameState.winAmount}** ${config.currency.emoji} !\n` +
             `💵 Votre solde actuel : **${user.balance}** ${config.currency.emoji}`
           )
           .setFields([])
           .setColor(CASH_OUT_EMBED_COLOR);
    } else {
      // En cas de perte, vérifier la protection contre les pertes
      const originalBet = gameState.originalBet || gameState.bet;
      const guildId = gameState.guildId || interaction.guildId || null;
      const currentUser = ensureUser(gameState.userId, guildId);
      
      // Consommer une utilisation de l'effet double_winnings si actif (à chaque partie, win or lose)
      const effectMultiplier = calculateEffectMultiplier(gameState.userId, guildId);
      if (effectMultiplier > 1.0) {
        const effectUsed = useEffect(gameState.userId, 'double_winnings', guildId);
        console.log(`[Mines] Effet double_winnings consommé (perte): ${effectUsed}`);
      }
      
      // Vérifier si l'utilisateur a une protection contre les pertes
      const hasProtection = checkLossProtection(gameState.userId, guildId, originalBet);
      
      if (hasProtection) {
        // Protection appliquée : rembourser la mise
        updateUser(gameState.userId, guildId, { balance: currentUser.balance + originalBet });
        
        embed.setTitle('🫀 Cœur de Remplacement Activé !')
             .setDescription(
               `💥 BOOM ! Vous avez cliqué sur une mine, mais votre **Cœur de Remplacement** a protégé votre mise !\n` +
               `💰 Votre mise de **${originalBet}** ${config.currency.emoji} a été remboursée.\n` +
               `💵 Votre solde actuel : **${currentUser.balance + originalBet}** ${config.currency.emoji}`
             )
             .setColor(0xFF6B6B); // Couleur spéciale pour la protection
      } else {
        embed.setTitle('💥 BOOM !')
             .setDescription(
               `Vous avez cliqué sur une mine ! Votre mise de **${originalBet}** ${config.currency.emoji} est perdue.\n` +
               `💵 Votre solde actuel : **${currentUser.balance}** ${config.currency.emoji}`
             )
             .setColor(GAME_OVER_EMBED_COLOR);
      }
    }
  }
  
  return embed;
}

// Gérer la révélation d'une case
function revealCell(gameState, x, y) {
  console.log('Révélation de la case:', {x, y, currentState: gameState.revealed[x][y]});
  
  if (gameState.revealed[x][y] !== 'hidden') {
    console.log('Case déjà révélée ou invalide');
    return;
  }
  
  // Marquer la case comme révélée
  gameState.revealed[x][y] = 'revealed';
  console.log('Nouvel état de la case:', gameState.revealed[x][y]);

  // Vérifier si c'est une mine
  if (gameState.grid[x][y] === 'mine') {
    console.log('Mine trouvée! Fin de la partie.');
    gameState.gameOver = true;
    gameState.won = false;
    
    // Mettre à jour les statistiques de jeu pour les missions
    updateUserGameStats(gameState.userId, 'mines');
    
    // Mettre à jour les statistiques de défaite pour les missions
    handleGameLose(gameState.userId, 'mines', gameState.guildId);
    
    // La mise a déjà été déduite au début de la partie, donc pas besoin de la déduire à nouveau
    // On marque simplement la partie comme perdue
    return;
  }
  
  // Incrémenter le compteur de cases révélées
  gameState.revealedCount++;
  console.log('Nombre de cases révélées:', gameState.revealedCount);
}



// Calculer les gains actuels avec effets
function calculateCurrentWin(gameState) {
  if (gameState.revealedCount === 0) return 0;
  
  // Utiliser le multiplicateur du tableau s'il existe, sinon continuer avec +0.5 par gemme supplémentaire
  let multiplier;
  if (gameState.revealedCount < MULTIPLIERS.length) {
    multiplier = MULTIPLIERS[gameState.revealedCount];
  } else {
    // Au-delà de la liste, on continue avec +0.5 par gemme
    const baseIndex = MULTIPLIERS.length - 1;
    const additionalGems = gameState.revealedCount - baseIndex;
    multiplier = MULTIPLIERS[baseIndex] + (additionalGems * 0.5);
  }
  
  // Appliquer les effets temporaires avec fallback sécurisé
  const guildId = gameState.guildId || null;
  const effectMultiplier = calculateEffectMultiplier(gameState.userId, guildId);
  const finalMultiplier = multiplier * effectMultiplier;
  
  console.log(`[MINES] calculateCurrentWin - base: ${multiplier}, effect: ${effectMultiplier}, final: ${finalMultiplier}`);
  
  return Math.floor(gameState.bet * finalMultiplier);
}

// Commande pour démarrer une nouvelle partie
async function handleMinesCommand(interaction) {
  const bet = interaction.options.getInteger('mise');
  const minesCount = 3; // Nombre fixe de mines
  const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || null;
  console.log(`[MINES] guildId utilisé: ${guildId} pour ${interaction.user.tag} sur le serveur ${interaction.guild?.name || 'inconnu'}`);

  if (bet < 10) {
    return interaction.reply({ content: `La mise minimale est de 10 ${config.currency.emoji}.`, ephemeral: true });
  }

  const user = ensureUser(interaction.user.id, guildId);
  console.log(`[MINES] solde lu: ${user.balance} pour ${interaction.user.tag} avec guildId=${guildId}`);
  if ((user.balance || 0) < bet) {
    return interaction.reply({ content: `Vous n'avez pas assez de ${config.currency.emoji} pour cette mise.`, ephemeral: true });
  }


  try {
    // Calculer la contribution au pot (1% de la mise, minimum 1)
    const potContribution = Math.max(1, Math.floor(bet * 0.01));
    const userBet = bet - potContribution;
    
    // Mettre à jour le solde de l'utilisateur (soustraire la mise complète)
    updateUser(interaction.user.id, guildId, { balance: user.balance - bet });
    
    // Ajouter la contribution au pot commun
    const { addToPot } = require('../database');
    addToPot(potContribution, interaction.user.id);

    // Mettre à jour les statistiques de jeu pour les missions
    updateUserGameStats(interaction.user.id, 'mines');
    
    // Créer la grille de jeu
    const grid = createGameGrid(minesCount, interaction.user.id);
    
    // Créer un nouvel état de jeu avec la mise réelle (après prélèvement)
    const gameState = {
      userId: interaction.user.id,
      guildId,
      bet: userBet,  // Utiliser la mise après prélèvement du pot commun
      originalBet: bet,  // Conserver la mise originale pour l'affichage
      minesCount,
      grid: grid,
      revealed: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('hidden')),
      revealedCount: 0,
      gameOver: false,
      won: false,
      messageId: null,
      // Ajout d'un timestamp pour le nettoyage automatique
      createdAt: Date.now()
    };

    // Envoyer le message de jeu d'abord
    const message = await interaction.reply({
      embeds: [createGameEmbed(gameState, interaction)],
      components: createGridComponents(gameState),
      fetchReply: true
    });

    // Stocker l'ID du message comme clé
    gameState.messageId = message.id;
    activeMinesGames.set(message.id, gameState);
    
    // Nettoyer les anciennes parties du même utilisateur
    cleanupOldGames(interaction.user.id);

  } catch (error) {
    console.error('Erreur lors du démarrage du jeu des mines:', error);
    // Rembourser l'utilisateur en cas d'erreur
    updateUser(interaction.user.id, guildId, { balance: user.balance });
    interaction.reply({ content: 'Une erreur est survenue lors du démarrage du jeu. Veuillez réessayer.', ephemeral: true });
  }
}

// Nettoyer les anciennes parties
function cleanupOldGames(userId) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000; // 1 heure en millisecondes
  
  for (const [messageId, game] of activeMinesGames.entries()) {
    if ((game.userId === userId && now - game.createdAt > ONE_HOUR) || game.gameOver) {
      activeMinesGames.delete(messageId);
    }
  }
}

// Gérer l'interaction des boutons du jeu
async function handleMinesButtonInteraction(interaction) {
  // Répondre immédiatement à l'interaction pour éviter l'erreur "interaction failed"
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(console.error);
  }

  try {
    console.log('Bouton cliqué:', interaction.customId);
    console.log('Message ID:', interaction.message.id);
    console.log('Parties actives:', Array.from(activeMinesGames.keys()));
    
    // Trouver la partie par l'ID du message
    const gameState = activeMinesGames.get(interaction.message.id);
    
    if (!gameState) {
      console.log('Partie non trouvée pour le message:', interaction.message.id);
      console.log('Contenu de activeMinesGames:', activeMinesGames);
      
      if (interaction.deferred) {
        await interaction.editReply({ content: 'Partie introuvable ou terminée. Utilisez la commande /mines pour commencer une nouvelle partie.', components: [] });
      } else {
        await interaction.update({ content: 'Partie introuvable ou terminée. Utilisez la commande /mines pour commencer une nouvelle partie.', components: [] });
      }
      return;
    }

    if (gameState.userId !== interaction.user.id) {
      console.log('Tentative d\'accès à une partie qui ne vous appartient pas');
      if (interaction.deferred) {
        return interaction.editReply({ content: 'Ce n\'est pas votre partie !', ephemeral: true });
      } else {
        return interaction.reply({ content: 'Ce n\'est pas votre partie !', ephemeral: true });
      }
    }

    const parts = interaction.customId.split('_');
    const action = parts[1];
    
    console.log('Action:', action, 'Custom ID:', interaction.customId);
    
    if (action === 'cashout') {
      console.log('Cashout demandé');
      let winAmount = calculateCurrentWin(gameState);
      console.log(`[MINES] Cashout - winAmount calculé: ${winAmount}`);

      const guildId = gameState.guildId || interaction.guildId || null;
      const doubleResult = applyDoubleOrNothing(gameState.userId, guildId, winAmount);
      winAmount = doubleResult.winnings;
      gameState.gameOver = true;
      gameState.won = true;
      gameState.winAmount = winAmount;
      
      // Récupérer le solde actuel de l'utilisateur
      const user = ensureUser(interaction.user.id, guildId);
      console.log(`[MINES] Cashout - solde avant: ${user.balance}, guildId: ${guildId}`);
      
      // Les gains sont déjà calculés dans winAmount (qui inclut la mise initiale)
      console.log(`Cashout: Gains de ${winAmount} (déjà inclus la mise initiale)`);
      
      // Consommer une utilisation de l'effet double_winnings si utilisé
      const effectMultiplier = calculateEffectMultiplier(gameState.userId, guildId);
      if (effectMultiplier > 1.0) {
        const effectUsed = useEffect(gameState.userId, 'double_winnings', guildId);
        console.log(`[Mines] Effet double_winnings consommé: ${effectUsed}`);
      }
      
      // Mettre à jour le solde (ne pas ajouter la mise deux fois)
      updateUser(interaction.user.id, guildId, { balance: user.balance + winAmount });
      
      const newUserBalance = user.balance + winAmount;
      console.log(`[MINES] Cashout - solde après: ${newUserBalance} (+${winAmount})`);
      
      console.log('Mise à jour de l\'interface avec le cashout');
      
      // Préparer la réponse de cashout
      const cashoutResponse = {
        embeds: [createGameEmbed(gameState, interaction)],
        components: createGridComponents(gameState, true)
      };
      
      // Envoyer la réponse en fonction de l'état actuel de l'interaction
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(cashoutResponse);
      } else {
        await interaction.update(cashoutResponse);
      }
      
      // Mettre à jour les statistiques de victoire pour les missions
      handleGameWin(interaction.user.id, 'mines', guildId, winAmount);
      
      // Supprimer la partie de la mémoire
      activeMinesGames.delete(interaction.message.id);
      return;
    }
    
    // Si ce n'est pas un cashout, c'est un clic sur une case
    // Le format est mines_X_Y où X est la ligne et Y la colonne
    const posX = parseInt(parts[1]); // Première coordonnée après 'mines'
    const posY = parseInt(parts[2]); // Deuxième coordonnée
    
    console.log('Coordonnées extraites:', {posX, posY, parts});
  
    // Vérifier que les coordonnées sont valides
    if (isNaN(posX) || isNaN(posY) || posX < 0 || posX >= GRID_SIZE || posY < 0 || posY >= GRID_SIZE) {
      console.error('Coordonnées invalides:', {posX, posY});
      await interaction.editReply({ content: 'Coordonnées de case invalides.', ephemeral: true });
      return;
    }
  
    console.log('Case cliquée:', {posX, posY, state: gameState.revealed[posX][posY]});
  
    if (gameState.revealed[posX][posY] !== 'hidden') {
      console.log('Case déjà révélée, mise à jour différée');
      await interaction.deferUpdate();
      return;
    }

    console.log('Révélation de la case');
    revealCell(gameState, posX, posY);
    
    // Préparer la réponse
    const response = {
      embeds: [createGameEmbed(gameState, interaction)],
      components: gameState.gameOver 
        ? createGridComponents(gameState, true)
        : createGridComponents(gameState)
    };

    // Mettre à jour le message avec la réponse appropriée
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.update(response);
    }
    
    // Si la partie est terminée, afficher la grille complète dans les logs
    if (gameState.gameOver) {
      console.log('\n[MINES] Fin de la partie - Grille complète:');
      console.log('  0 1 2 3');
      for (let i = 0; i < GRID_SIZE; i++) {
        let row = `${i} `;
        for (let j = 0; j < GRID_SIZE; j++) {
          const cell = gameState.grid[i][j] === 'mine' ? '💣' : '💎';
          const isRevealed = gameState.revealed[i][j] === 'revealed';
          row += isRevealed ? `[${cell}]` : ` ${cell} `;
        }
        console.log(row);
      }
      console.log('');
      
      // Afficher le résultat final
      const result = gameState.won ? 'GAGNÉ' : 'PERDU';
      console.log(`[MINES] Résultat: ${result} | Joueur: ${interaction.user.username} | Mise: ${gameState.originalBet} | Gains: ${gameState.winAmount || 0}`);
    }
  } catch (error) {
    console.error('Erreur dans handleMinesButtonInteraction:', error);
    try {
      await interaction.followUp({ content: 'Une erreur est survenue lors du traitement de votre action.', ephemeral: true });
    } catch (e) {
      console.error('Impossible d\'envoyer le message d\'erreur:', e);
    }
  }
}

module.exports = {
  handleMinesCommand,
  handleMinesButtonInteraction
};