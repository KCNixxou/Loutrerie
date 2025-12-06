// Configuration par défaut (pour la rétrocompatibilité)
const defaultConfig = {
  // Configuration des logs
  logging: {
    debug: false,  // Activer/désactiver les logs de débogage
    database: false, // Activer/désactiver les logs de la base de données
  },
  currency: {
    emoji: '🐚',
    dailyReward: 200,  // Augmenté de 100 à 200
    startingBalance: 500
  },
  casino: {
    minBet: 10, // Mise minimale par défaut
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
    // Rôles BDG existants
    bdgBaby: { price: 10000, name: '👶 Bébé BDG', role: 'Bébé BDG', dailyReward: 500 },
    bdgPetit: { price: 50000, name: '🚶 Petit BDG', role: 'Petit BDG', dailyReward: 1000 },
    bdgGros: { price: 200000, name: '💪 Gros BDG', role: 'Gros BDG', dailyReward: 5000 },
    bdgUltime: { price: 1000000, name: '👑 BDG Ultime', role: 'BDG Ultime', dailyReward: 20000 },
    
    // Rôles BDH existants
    bdhBaby: { price: 10000, name: '👶 Bébé BDH', role: 'Bébé BDH', dailyReward: 500 },
    bdhPetit: { price: 50000, name: '🚶 Petit BDH', role: 'Petit BDH', dailyReward: 1000 },
    bdhGros: { price: 200000, name: '💪 Gros BDH', role: 'Gros BDH', dailyReward: 5000 },
    bdhUltime: { price: 1000000, name: '👑 BDH Ultime', role: 'BDH Ultime', dailyReward: 20000 },
    
    // Article classique
    colorChange: { price: 10000, name: '🎨 Changement de couleurs', role: null, description: 'Personnalise tes couleurs sur le serveur' },
    
    // Nouveaux items thématiques
    serumChance: {
      price: 70000,
      name: '🧪 Sérum de Chance',
      emoji: '🧪',
      description: '+15% de gains au casino pendant 24h',
      type: 'consumable',
      duration: 86400000, // 24h en ms
      effect: 'casino_bonus',
      value: 0.15
    },
    
    coeurRemplacement: {
      price: 15000,
      name: '🫀 Cœur de Remplacement',
      emoji: '🫀',
      description: 'Annule une perte importante (1 fois)',
      type: 'consumable',
      effect: 'loss_protection',
      uses: 1
    },
    
    jetonDouble: {
      price: 12500,
      name: '🔪 Jeton "Double Ou Crève"',
      emoji: '🔪',
      description: 'Double tes gains sur un jeu… ou tu perds tout',
      type: 'consumable',
      effect: 'double_or_nothing',
      uses: 1
    },
    
    packSaignee: {
      price: 100000,
      name: '🩸 Pack Saignée',
      emoji: '🩸',
      description: 'Gains x2 pour les 15 prochaines parties',
      type: 'consumable',
      effect: 'double_winnings',
      uses: 15,
      value: 2.0
    },
    
    boiteOrganes: {
      price: 35000,
      name: '📦 Boîte à Organes',
      emoji: '📦',
      description: 'Contient une récompense aléatoire (bonus, gains, items rares)',
      type: 'mystery_box',
      rewards: [
        // 10 000 (20%)
        10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000,
        10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000,
        
        // 20 000 (25%)
        20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000,
        20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000,
        20000, 20000, 20000, 20000, 20000,
        
        // 35 000 (25%)
        35000, 35000, 35000, 35000, 35000, 35000, 35000, 35000, 35000, 35000,
        35000, 35000, 35000, 35000, 35000, 35000, 35000, 35000, 35000, 35000,
        35000, 35000, 35000, 35000, 35000,
        
        // 50 000 (15%)
        50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000,
        50000, 50000, 50000, 50000, 50000,
        
        // 100 000 (10%)
        100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000,
        
        // Buffs (2.5% chacun)
        'serumChance', 'serumChance', 'serumChance', 'serumChance', 'serumChance',
        'packSaignee', 'packSaignee', 'packSaignee', 'packSaignee', 'packSaignee'
      ]
    },
    
    messeNoire: {
      price: 30000,
      name: '🕯️ Entrée à la Messe Noire Mensuelle',
      emoji: '🕯️',
      description: 'Tirage spécial avec gros lots',
      type: 'event_access',
      effect: 'monthly_lottery'
    },
    
    patientVip: {
      price: 50000,
      name: '💉 Patient·e VIP (7 jours)',
      emoji: '💉',
      description: 'Couleur exclusive + accès chambre isolée',
      type: 'vip_temporary',
      duration: 604800000, // 7 jours en ms
      effect: 'temporary_vip'
    },

    cadeauSurprise1: {
      price: 500000,
      name: '🎁 Cadeau surprise 1',
      emoji: '🎁',
      description: 'Un code vous sera envoyé en message privé après achat.',
      type: 'gift'
    },
    
    cadeauSurprise2: {
      price: 500000,
      name: '🎁 Cadeau surprise 2',
      emoji: '🎁',
      description: 'Un code vous sera envoyé en message privé après achat.',
      type: 'gift'
    }
  },
  missions: {
    daily: [
      { id: 'daily_win', description: 'Gagner une partie', goal: 1, reward: 200 },
      { id: 'daily_lose', description: 'Perdre une partie', goal: 1, reward: 200 },
      { id: 'daily_play_5', description: 'Faire 5 parties dans la journée', goal: 5, reward: 200 },
      { id: 'daily_3_games', description: 'Jouer à 3 jeux différents', goal: 3, reward: 200 }
    ],
    weekly: [
      { id: 'weekly_boost', description: 'Activer un boost', goal: 1, reward: 1000 },
      { id: 'weekly_buy_item', description: 'Acheter un objet dans la boutique', goal: 1, reward: 1000 },
      { id: 'weekly_give_2000', description: 'Donner 2000 coquillages (cumulé)', goal: 2000, reward: 1000 },
      { id: 'weekly_win_50000', description: 'Gagner 50000 coquillages (cumulé)', goal: 50000, reward: 1000 }
    ],
    lifetime: [
      { id: 'lifetime_1000_games', description: 'Jouer 1000 parties', goal: 1000, reward: 10000 },
      { id: 'lifetime_2000_games', description: 'Jouer 2000 parties', goal: 2000, reward: 20000 },
      { id: 'lifetime_5000_games', description: 'Jouer 5000 parties', goal: 5000, reward: 50000 },
      { id: 'lifetime_give_30000', description: 'Donner 30000 coquillages (cumulé)', goal: 30000, reward: 30000 },
      { id: 'lifetime_open_50_boxes', description: 'Ouvrir 50 boîtes à organes', goal: 50, reward: 100000 },
      { id: 'lifetime_open_100_boxes', description: 'Ouvrir 100 boîtes à organes', goal: 100, reward: 150000 },
      { id: 'lifetime_open_200_boxes', description: 'Ouvrir 200 boîtes à organes', goal: 200, reward: 200000 }
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

// Configuration pour le nouveau serveur (ID: 1429516623651541210)
const newServerConfig = {
  ...defaultConfig,
  xp: {
    ...defaultConfig.xp,
    excludedChannels: [] // Aucun salon exclu pour le nouveau serveur
  },
  specialHighLow: {
    ...defaultConfig.specialHighLow,
    enabled: false, // Désactive le salon spécial High Low
    channelId: null // Aucun salon spécial défini
  }
};

// Fonction pour obtenir la configuration en fonction du serveur
function getConfig(guildId) {
  // ID du nouveau serveur
  const NEW_SERVER_ID = '1429516623651541210';
  
  // Retourne la configuration spécifique au serveur ou la configuration par défaut
  return guildId === NEW_SERVER_ID ? newServerConfig : defaultConfig;
}

// Exporte la configuration par défaut et la fonction getConfig
module.exports = {
  ...defaultConfig,
  getConfig
};
