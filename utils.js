// La configuration est lue directement depuis le module config
const config = require('./config');

// Fonctions utilitaires générales
const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const now = () => Date.now();

function calculateLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function getLevelInfo(xp) {
  const level = calculateLevel(xp);
  const xpForCurrentLevel = Math.pow(level - 1, 2) * 100;
  const xpForNextLevel = Math.pow(level, 2) * 100;
  const currentXp = xp - xpForCurrentLevel;
  const xpNeeded = xpForNextLevel - xpForCurrentLevel;
  
  return {
    level,
    currentXp,
    xpForNextLevel: xpNeeded,
    progress: (currentXp / xpNeeded) * 100
  };
}

function getXpMultiplier(member) {
  if (!member || !member.roles) return 1;
  const roles = member.roles.cache;
  let multiplier = 1;
  
  const guildId = member.guild?.id;
  const guildConfig = typeof config.getConfig === 'function'
    ? config.getConfig(guildId)
    : config;

  const xpConfig = guildConfig && guildConfig.xp ? guildConfig.xp : {};
  const vipMultiplier = xpConfig.vipMultiplier || 1;
  const superVipMultiplier = xpConfig.superVipMultiplier || 1;

  if (roles.some(role => role.name === 'VIP')) {
    multiplier *= vipMultiplier;
  }
  
  if (roles.some(role => role.name === 'Super VIP')) {
    multiplier *= superVipMultiplier;
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
function playSlots(client, guildId) {
  const config = client.getConfig(guildId);
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

// Planifie une tâche à 00h01 chaque jour
function scheduleDailyReset(callback) {
  const now = new Date();
  const nextReset = new Date();
  
  // Forcer l'heure locale à 00h01 en ignorant le décalage horaire du serveur
  // On utilise l'heure locale du système pour s'assurer que le reset est bien à 00h01 local
  nextReset.setHours(0, 1, 0, 0); // 00h01 heure locale
  
  // Si l'heure est déjà passée aujourd'hui, planifier pour demain
  if (now >= nextReset) {
    nextReset.setDate(nextReset.getDate() + 1);
  }
  
  const timeUntilReset = nextReset - now;
  
  console.log(`⏰ Prochain reset quotidien programmé pour: ${nextReset.toLocaleString()} (dans ${Math.floor(timeUntilReset / 1000 / 60)} minutes)`);
  
  setTimeout(() => {
    callback();
    // Programmer le prochain reset
    setInterval(callback, 24 * 60 * 60 * 1000);
  }, timeUntilReset);
}

// Fonction pour obtenir la valeur numérique d'une carte
function getCardValue(card) {
  if (!card || !card.value) return [0];
  
  const value = card.value.toUpperCase();
  if (value === 'J') return [11];    // Valet = 11
  if (value === 'Q') return [12];    // Dame = 12
  if (value === 'K') return [13];    // Roi = 13
  return [parseInt(value) || 0];     // 2-10 gardent leur valeur
}

// Fonction utilitaire pour comparer deux cartes dans le contexte du jeu High Low
function compareCards(card1, card2, action) {
  const values1 = getCardValue(card1);
  const values2 = getCardValue(card2);
  
  console.log(`[compareCards] Card1: ${card1.value} (${values1}), Card2: ${card2.value} (${values2}), Action: ${action}`);
  
  // Si l'une des cartes n'a pas de valeur valide
  if (values1.length === 0 || values2.length === 0) {
    console.log('[compareCards] Invalid card values');
    return { result: false, sameCard: false };
  }
  
  // Vérifier d'abord l'égalité exacte
  for (const v1 of values1) {
    for (const v2 of values2) {
      if (v1 === v2) {
        if (action === 'same') {
          console.log('[compareCards] Same value found:', v1);
          return { result: true, sameCard: true };
        }
        // Si on a une égalité mais que ce n'est pas ce qui était parié
        if (action !== 'same') {
          console.log(`[compareCards] Cards have same value ${v1} but action was ${action}`);
          return { result: false, sameCard: true };
        }
      }
    }
  }
  
  // Si on arrive ici, il n'y a pas d'égalité
  // On utilise la valeur la plus élevée pour la comparaison
  const max1 = Math.max(...values1);
  const max2 = Math.max(...values2);
  
  console.log(`[compareCards] Comparing max values: ${max1} vs ${max2}`);
  
  if (action === 'higher') {
    const result = max2 > max1;
    console.log(`[compareCards] Higher check: ${max2} > ${max1} = ${result}`);
    return { result, sameCard: false };
  } else if (action === 'lower') {
    const result = max2 < max1;
    console.log(`[compareCards] Lower check: ${max2} < ${max1} = ${result}`);
    return { result, sameCard: false };
  }
  
  return { result: false, sameCard: false };
}

module.exports = {
  random,
  now,
  calculateLevel,
  scheduleDailyReset,
  getLevelInfo,
  getCardValue,
  compareCards,
  getXpMultiplier,
  createDeck,
  calculateHandValue,
  formatHand,
  getRouletteColor,
  playSlots,
  scheduleMidnightReset,
  getCardValue: getCardValue,
  compareCards: compareCards
};
