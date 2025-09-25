// games/index.js

// Importer les fonctions de chaque module
const mines = require('./mines');
const minesMulti = require('./mines-multi');
const specialMines = require('./special-mines');
const highlow = require('./highlow');
const roulette = require('./roulette');
const slots = require('./slots');
const blackjack = require('./blackjack');
const coinflip = require('./coinflip');
const shop = require('./shop');
const ticTacToe = require('./tic-tac-toe');

// Exporter toutes les fonctions de jeu
module.exports = {
  // Mines
  ...mines,
  
  // Mines Multijoueur
  ...minesMulti,
  
  // Mines Spéciales
  ...specialMines,
  
  // High Low
  ...highlow,
  
  // Roulette
  ...roulette,
  
  // Machine à sous
  ...slots,
  
  // Blackjack
  ...blackjack,
  
  // Coinflip
  ...coinflip,
  
  // Boutique
  ...shop,
  
  // Tic-Tac-Toe
  ...ticTacToe
};
