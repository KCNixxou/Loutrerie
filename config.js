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
        twoMatch: 1.7,
        threeMatch: 3
      }
    }
  },
  xp: {
    minPerMessage: 10,
    maxPerMessage: 25,
    cooldown: 60000, // 1 minute
    vipMultiplier: 1.5,
    superVipMultiplier: 2
  },
  shop: {
    vip: { price: 10000, name: 'VIP' },
    superVip: { price: 20000, name: 'Super VIP' },
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
