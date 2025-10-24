const { ensureUser, updateUser } = require('./database');

// Fonction utilitaire pour obtenir la configuration du jeu
function getGameConfig(interaction) {
  return interaction.client.getConfig(interaction.guild?.id);
}

// Variables globales pour les jeux
const activeCoinflipGames = new Map();

// Fonction utilitaire pour ajouter de l'argent à un utilisateur
async function addMoney(userId, amount, interaction) {
  const user = ensureUser(userId);
  const newBalance = user.balance + amount;
  updateUser(userId, { balance: newBalance });
  
  // Mettre à jour le message si une interaction est fournie
  if (interaction) {
    const config = getGameConfig(interaction);
    await interaction.followUp({ 
      content: `+${amount} ${config.currency.emoji} ont été ajoutés à votre solde.`,
      ephemeral: true 
    });
  }
  
  return newBalance;
}

module.exports = {
  // Fonctions utilitaires
  addMoney,
  
  // Variables globales
  activeCoinflipGames,
  
  // Placeholders pour les jeux non encore implémentés
  handleCoinflipSolo: () => {},
  handleCoinflipMulti: () => {},
  handleShop: () => {},
  handlePurchase: () => {},
  handleTicTacToe: () => {},
  handleTicTacToeMove: () => {},
  handleTicTacToeLeaderboard: () => {},
  getTicTacToeLeaderboard: () => {},
  resetTicTacToeStats: () => {}
};
