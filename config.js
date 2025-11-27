// Configuration par défaut (pour la rétrocompatibilité)
const defaultConfig = {
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
      description: 'Gains x2 pendant 1 heure',
      type: 'consumable',
      duration: 3600000, // 1h en ms
      effect: 'double_winnings',
      value: 2.0
    },
    
    boiteOrganes: {
      price: 35000,
      name: '📦 Boîte à Organes',
      emoji: '📦',
      description: 'Contient une récompense aléatoire (bonus, gains, items rares)',
      type: 'mystery_box',
      rewards: [
        10000, // 20% - 2 entrées
        10000, // 20% - 2 entrées
        20000, // 25% - 2.5 entrées
        20000, // 25% - 2.5 entrées
        20000, // 25% - 2.5 entrées
        35000, // 25% - 2.5 entrées
        35000, // 25% - 2.5 entrées
        50000, // 15% - 1.5 entrées
        50000, // 15% - 1.5 entrées
        100000, // 10% - 1 entrée
        'serumChance', // 2.5% - 0.25 entrée
        'packSaignee'  // 2.5% - 0.25 entrée
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
    }
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
