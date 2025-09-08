module.exports = {
  currency: {
    emoji: '🐚',
    dailyReward: 100,
    startingBalance: 500
  },
  casino: {
    maxBet: 10000,
    slots: {
      symbols: ['🦦', '🐳', '🪼', '🐚', '🪸', '🏝️'],
      multipliers: {
        twoMatch: 1.9,  // x1.9 pour deux symboles identiques
        threeMatch: 3   // x3 pour trois symboles identiques
      }
    }
  },
  xp: {
    minPerMessage: 10,
    maxPerMessage: 25,
    cooldown: 60000, // 1 minute
    vipMultiplier: 1.25,       // +25% d'XP pour les VIP
    superVipMultiplier: 1.5    // +50% d'XP pour les Super VIP
  },
  shop: {
    vip: { price: 10000, name: 'VIP' },
    superVip: { price: 20000, name: 'Super VIP' },
    colorChange: { price: 10000, name: 'Changement de couleurs' },
    surprise1: { price: 100000, name: 'Surprise Mystère #1' },
    surprise2: { price: 100000, name: 'Surprise Mystère #2' }
  },
  missions: {
    daily: [
      { id: 'messages_30', description: 'Envoyer 30 messages', goal: 30, reward: 50 },
      { id: 'coinflip_multi', description: 'Jouer une partie de pile ou face multijoueurs', goal: 1, reward: 100 },
      { id: 'messages_50', description: 'Envoyer 50 messages', goal: 50, reward: 150 }
    ]
  }
};
