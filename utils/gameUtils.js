const { handleInteraction } = require('./interactionHandler');
const config = require('../config');

/**
 * Vérifie si un utilisateur peut effectuer une mise
 * @param {Object} interaction - L'interaction Discord
 * @param {Object} user - L'utilisateur qui effectue la mise
 * @param {number} bet - Le montant de la mise
 * @returns {Promise<boolean>} - True si la mise est valide, false sinon
 */
async function validateBet(interaction, user, bet) {
  if (bet > user.balance) {
    await handleInteraction(interaction, {
      content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}`,
      ephemeral: true
    });
    return false;
  }
  
  if (bet > config.casino.maxBet) {
    await handleInteraction(interaction, {
      content: `❌ Mise maximum: ${config.casino.maxBet} ${config.currency.emoji}`,
      ephemeral: true
    });
    return false;
  }
  
  return true;
}

/**
 * Vérifie si un utilisateur a déjà une partie en cours
 * @param {Object} interaction - L'interaction Discord
 * @param {Map} activeGames - La Map des parties en cours
 * @param {string} gameName - Le nom du jeu pour le message d'erreur
 * @returns {Promise<boolean>} - True si l'utilisateur a déjà une partie en cours, false sinon
 */
async function checkActiveGame(interaction, activeGames, gameName) {
  if (activeGames.has(interaction.user.id)) {
    await handleInteraction(interaction, {
      content: `❌ Tu as déjà une partie de ${gameName} en cours !`,
      ephemeral: true
    });
    return true;
  }
  return false;
}

// Add to lottery pot and track participant
function contributeToLotteryPot(userId, betAmount) {
  const potContribution = Math.ceil(betAmount * 0.01); // 1% of bet
  if (potContribution > 0) {
    try {
      const database = require('../database');
      database.addToPot(potContribution);
      database.addLotteryParticipant(userId, potContribution);
      return potContribution;
    } catch (error) {
      console.error('Error contributing to lottery pot:', error);
      return 0;
    }
  }
  return 0;
}

module.exports = {
  validateBet,
  checkActiveGame,
  contributeToLotteryPot
};
