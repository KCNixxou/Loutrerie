module.exports = {
  currency: {
    emoji: '🐚',
    dailyReward: 200,  // Augmenté de 100 à 200
    startingBalance: 500
  },
  casino: {
    maxBet: 10000,
    slots: {
      symbols: ['🦦', '🐳', '🪼', '🐚', '🪸', '🏝️'],
      multipliers: {
        twoMatch: 2.3,  // x2.3 pour deux symboles identiques
        threeMatch: 3.5 // x3.5 pour trois symboles identiques
      }
    }
  },
  xp: {
    minPerMessage: 10,
    maxPerMessage: 25,
    cooldown: 15000, // 15 secondes (réduit de 1 minute)
    vipMultiplier: 1.25,       // +25% d'XP pour les VIP
    superVipMultiplier: 1.5,   // +50% d'XP pour les Super VIP
    // Salons exclus du gain d'XP
    excludedChannels: [
      '1378269518136348743', // Salon 1
      '1415784183741284392', // Salon 2
      '1378373298861248642'  // Salon 3 (High Low spécial)
    ]
  },
  shop: {
    vip: { price: 10000, name: 'VIP' },
    superVip: { price: 20000, name: 'Super VIP' },
    colorChange: { price: 10000, name: 'Changement de couleurs' },
    surprise1: { price: 100000, name: 'Surprise Mystère #1' },
    surprise2: { price: 100000, name: 'Surprise Mystère #2' },
    bdgBaby: { price: 10000, name: 'Bébé BDG', role: 'Bébé BDG', dailyReward: 500 },
    bdgPetit: { price: 50000, name: 'Petit BDG', role: 'Petit BDG', dailyReward: 1000 },
    bdgGros: { price: 200000, name: 'Gros BDG', role: 'Gros BDG', dailyReward: 5000 },
    bdgUltime: { price: 1000000, name: 'BDG Ultime', role: 'BDG Ultime', dailyReward: 20000 }
  },
  missions: {
    daily: [
      { id: 'messages_30', description: 'Envoyer 30 messages', goal: 30, reward: 50 },
      { id: 'coinflip_multi', description: 'Jouer une partie de pile ou face multijoueurs', goal: 1, reward: 100 },
      { id: 'messages_50', description: 'Envoyer 50 messages', goal: 50, reward: 150 }
    ]
  },
  // Configuration pour le salon spécial High Low
  specialHighLow: {
    channelId: '1378373298861248642', // ID du salon spécial
    adminIds: ['314458846754111499', '678264841617670145'],   // Liste des IDs des administrateurs
    specialUserId: '678264841617670145', // ID de l'utilisateur spécial
    maxBet: 50000, // Mise maximale pour le salon spécial
    startingBalance: 1000, // Solde de départ pour le salon spécial
    // Fonction utilitaire pour vérifier si un utilisateur est admin
    isAdmin: function(userId) {
      return this.adminIds.includes(userId);
    }
  }
};
