const config = require('./config');

// Fonctions utilitaires générales
const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const now = () => Date.now();

function calculateLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function getXpMultiplier(member) {
  if (!member || !member.roles) return 1;
  const roles = member.roles.cache;
  let multiplier = 1;
  
  if (roles.some(role => role.name === 'VIP')) {
    multiplier *= config.xp.vipMultiplier;
  }
  
  if (roles.some(role => role.name === 'Super VIP')) {
    multiplier *= config.xp.superVipMultiplier;
  }
  
  return multiplier;
}

// Fonctions pour les jeux de cartes
function createDeck() {
  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ value, suit, display: value + suit });
    }
  }
  
  // Mélanger le deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (card.value === 'A') {
      aces++;
      value += 11;
    } else if (['J', 'Q', 'K'].includes(card.value)) {
      value += 10;
    } else {
      value += parseInt(card.value);
    }
  }
  
  // Ajuster les As
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

function formatHand(hand) {
  return hand.map(card => card.display).join(' ');
}

// Fonctions pour la roulette
function getRouletteColor(number) {
  if (number === 0) return 'vert';
  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  return redNumbers.includes(number) ? 'rouge' : 'noir';
}

// Fonctions pour les slots
function playSlots() {
  const symbols = config.casino.slots.symbols;
  const result = [
    symbols[random(0, symbols.length - 1)],
    symbols[random(0, symbols.length - 1)],
    symbols[random(0, symbols.length - 1)]
  ];
  
  let multiplier = 0;
  if (result[0] === result[1] && result[1] === result[2]) {
    multiplier = config.casino.slots.multipliers.threeMatch;
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    multiplier = config.casino.slots.multipliers.twoMatch;
  }
  
  return { result, multiplier };
}

// Reset des missions à minuit
function scheduleMidnightReset(callback) {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  
  const timeUntilMidnight = midnight - now;
  
  setTimeout(() => {
    callback();
    // Programmer le prochain reset
    setInterval(callback, 24 * 60 * 60 * 1000);
  }, timeUntilMidnight);
}

// Fonction pour obtenir la valeur numérique d'une carte (1-13)
function getCardValue(card) {
  if (!card || !card.value) return 0;
  
  const value = card.value.toUpperCase();
  if (value === 'A') return 1;
  if (['J', 'Q', 'K'].includes(value)) return 10;
  return parseInt(value) || 0;
}

module.exports = {
  random,
  now,
  calculateLevel,
  getCardValue,
  getXpMultiplier,
  createDeck,
  calculateHandValue,
  formatHand,
  getRouletteColor,
  playSlots,
  scheduleMidnightReset
};
