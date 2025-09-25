// games/index.js

// Exporter toutes les fonctions de jeu en fusionnant les modules
module.exports = Object.assign(
  {},
  require('./mines'),
  require('./mines-multi'),
  require('./special-mines'),
  require('./highlow'),
  require('./roulette'),
  require('./slots'),
  require('./blackjack'),
  require('./coinflip'),
  require('./shop'),
  require('./tic-tac-toe')
);
