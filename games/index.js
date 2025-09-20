// Exportations des jeux
const { handleMinesCommand, handleMinesButtonInteraction } = require('./mines');

// Exportations des autres jeux (ajoutez-les au fur et à mesure)
module.exports = {
  // Mines
  handleMinesCommand,
  handleMinesButtonInteraction,
  
  // Autres jeux (à ajouter plus tard)
  handleBlackjackStart: () => {},
  resolveBlackjack: () => {},
  handleRouletteStart: () => {},
  handleRouletteChoice: () => {},
  handleSlots: () => {},
  handleCoinflipSolo: () => {},
  handleCoinflipMulti: () => {},
  handleConnectFour: () => {},
  handleShop: () => {},
  handlePurchase: () => {},
  handleTicTacToe: () => {},
  handleTicTacToeMove: () => {},
  handleConnectFourMove: () => {},
  getTicTacToeLeaderboard: () => {},
  handleTicTacToeLeaderboard: () => {},
  resetTicTacToeStats: () => {},
  handleHighLow: () => {},
  handleSpecialHighLow: () => {},
  handleHighLowAction: () => {},
  handleHighLowDecision: () => {}
};
