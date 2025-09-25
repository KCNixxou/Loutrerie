// Importation des jeux
const { handleMinesCommand, handleMinesButtonInteraction } = require('./mines');
const { handleMinesMultiCommand, handleMinesMultiInteraction } = require('./mines-multi');
const { handleSpecialMinesCommand, handleSpecialMinesInteraction } = require('./special-mines');
const { 
  handleHighLow, 
  handleSpecialHighLow, 
  handleHighLowAction, 
  handleHighLowDecision 
} = require('./highlow');
const {
  handleRouletteStart,
  handleRouletteChoice
} = require('./roulette');

const {
  handleSlots
} = require('./slots');

const {
  handleBlackjackStart,
  handleBlackjackAction,
  resolveBlackjack
} = require('./blackjack');

// Exportation de tous les jeux
module.exports = {
  // Mines
  handleMinesCommand,
  handleMinesButtonInteraction,
  
  // Mines Multijoueur
  handleMinesMultiCommand,
  handleMinesMultiInteraction,
  
  // Mines Spéciales
  handleSpecialMinesCommand,
  handleSpecialMinesInteraction,
  
  // High Low
  handleHighLow,
  handleSpecialHighLow,
  handleHighLowAction,
  handleHighLowDecision,
  
  // Roulette
  handleRouletteStart,
  handleRouletteChoice,
  
  // Machine à sous
  handleSlots,
  
  // Blackjack
  handleBlackjackStart,
  handleBlackjackAction,
  resolveBlackjack,
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
  resetTicTacToeStats: () => {}
};
