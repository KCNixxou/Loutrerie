const { updateMissionProgress, ensureUser, updateUser } = require('../database');

// Types de missions
const MISSION_TYPES = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  LIFETIME: 'lifetime'
};

// Événements de mission
const MISSION_EVENTS = {
  GAME_WIN: 'daily_win',
  GAME_LOSE: 'daily_lose',
  GAME_PLAY: 'daily_play_5',
  DIFFERENT_GAMES: 'daily_3_games',
  ACTIVATE_BOOST: 'weekly_boost',
  BUY_ITEM: 'weekly_buy_item',
  GIVE_COINS: 'weekly_give_2000',
  WIN_COINS: 'weekly_win_50000',
  TOTAL_GAMES_1000: 'lifetime_1000_games',
  TOTAL_GAMES_2000: 'lifetime_2000_games',
  TOTAL_GAMES_5000: 'lifetime_5000_games',
  TOTAL_GIVE: 'lifetime_give_30000',
  OPEN_BOXES_50: 'lifetime_open_50_boxes',
  OPEN_BOXES_100: 'lifetime_open_100_boxes',
  OPEN_BOXES_200: 'lifetime_open_200_boxes'
};

// Suivre les jeux joués par l'utilisateur aujourd'hui
// Mettre à jour les statistiques de jeu d'un utilisateur
function updateUserGameStats(userId, gameId, guildId = null) {
  const user = ensureUser(userId, guildId);
  
  // Initialiser les statistiques de jeu si elles n'existent pas
  if (!user.gameStats) {
    user.gameStats = {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      lastPlayed: Date.now(),
      gamesPlayedToday: 0,
      differentGamesPlayed: []
    };
  } else if (typeof user.gameStats === 'string') {
    // Si gameStats est une chaîne, le parser
    try {
      user.gameStats = JSON.parse(user.gameStats);
    } catch (e) {
      console.error('Erreur lors de l\'analyse de gameStats:', e);
      user.gameStats = {
        gamesPlayed: 0,
        gamesWon: 0,
        gamesLost: 0,
        lastPlayed: Date.now(),
        gamesPlayedToday: 0,
        differentGamesPlayed: []
      };
    }
  }

  // Mettre à jour les statistiques
  user.gameStats.gamesPlayed++;
  user.gameStats.lastPlayed = Date.now();
  
  // Vérifier si c'est une nouvelle journée pour réinitialiser le compteur quotidien
  const lastPlayedDate = new Date(user.gameStats.lastPlayed);
  const today = new Date();
  if (lastPlayedDate.getDate() !== today.getDate() || 
      lastPlayedDate.getMonth() !== today.getMonth() || 
      lastPlayedDate.getFullYear() !== today.getFullYear()) {
    user.gameStats.gamesPlayedToday = 0;
  }
  user.gameStats.gamesPlayedToday++;

  // Mettre à jour les jeux différents
  if (!user.gameStats.differentGamesPlayed || !Array.isArray(user.gameStats.differentGamesPlayed)) {
    user.gameStats.differentGamesPlayed = [];
  }
  if (!user.gameStats.differentGamesPlayed.includes(gameId)) {
    user.gameStats.differentGamesPlayed.push(gameId);
  }

  // Sauvegarder les statistiques mises à jour
  updateUser(userId, guildId, { gameStats: JSON.stringify(user.gameStats) });

  // Mettre à jour les missions basées sur le nombre de parties
  updateMissionProgress(userId, MISSION_EVENTS.GAME_PLAY, 1, guildId);
  
  // Vérifier les objectifs de parties totales
  if (user.gameStats.gamesPlayed >= 1000) {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_1000, 1, guildId);
  } else {
    // Mettre à jour la progression de 1 (pas le nombre total)
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_1000, 1, guildId);
  }
  if (user.gameStats.gamesPlayed >= 2000) {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_2000, 1, guildId);
  } else {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_2000, 1, guildId);
  }
  if (user.gameStats.gamesPlayed >= 5000) {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_5000, 1, guildId);
  } else {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_5000, 1, guildId);
  }
  
  // Vérifier les jeux différents
  if (user.gameStats.differentGamesPlayed.length >= 3) {
    updateMissionProgress(userId, MISSION_EVENTS.DIFFERENT_GAMES, 1, guildId);
  } else {
    updateMissionProgress(userId, MISSION_EVENTS.DIFFERENT_GAMES, user.gameStats.differentGamesPlayed.length, guildId);
  }
}

// Gérer une victoire au jeu
function handleGameWin(userId, gameId, guildId, winnings = 0) {
  // Mettre à jour les statistiques de jeu
  updateUserGameStats(userId, gameId, guildId);
  
  // Récupérer les statistiques mises à jour
  const user = ensureUser(userId, guildId);
  let gameStats = {};
  
  // Gérer le cas où gameStats est une chaîne
  if (user.gameStats) {
    gameStats = typeof user.gameStats === 'string' ? JSON.parse(user.gameStats) : user.gameStats;
  }
  
  // Mettre à jour les statistiques
  gameStats.gamesWon = (gameStats.gamesWon || 0) + 1;
  
  // Mettre à jour le solde si des gains sont spécifiés
  if (winnings > 0) {
    user.balance = (user.balance || 0) + winnings;
  }
  
  // Sauvegarder les modifications
  updateUser(userId, guildId, { 
    gameStats: JSON.stringify(gameStats),
    balance: user.balance
  });
  
  // Mettre à jour les missions
  updateMissionProgress(userId, MISSION_EVENTS.GAME_WIN, 1, guildId);
  
  // Mettre à jour les gains cumulés
  if (winnings > 0) {
    updateMissionProgress(userId, MISSION_EVENTS.WIN_COINS, winnings, guildId);
  }
}

// Gérer une défaite au jeu
function handleGameLose(userId, gameId, guildId) {
  // Mettre à jour les statistiques de jeu
  updateUserGameStats(userId, gameId, guildId);
  
  // Récupérer les statistiques mises à jour
  const user = ensureUser(userId, guildId);
  let gameStats = {};
  
  // Gérer le cas où gameStats est une chaîne
  if (user.gameStats) {
    gameStats = typeof user.gameStats === 'string' ? JSON.parse(user.gameStats) : user.gameStats;
  }
  
  // Mettre à jour les statistiques
  gameStats.gamesLost = (gameStats.gamesLost || 0) + 1;
  
  // Sauvegarder les modifications
  updateUser(userId, guildId, { 
    gameStats: JSON.stringify(gameStats)
  });
  
  // Mettre à jour les missions
  updateMissionProgress(userId, MISSION_EVENTS.GAME_LOSE, 1, guildId);
}

// Gérer l'achat d'un objet
function handleItemPurchase(userId, guildId) {
  updateMissionProgress(userId, MISSION_EVENTS.BUY_ITEM, 1, guildId);
}

// Gérer l'activation d'un boost
function handleBoostActivation(userId, guildId) {
  updateMissionProgress(userId, MISSION_EVENTS.ACTIVATE_BOOST, 1, guildId);
}

// Gérer le don de coquillages
function handleCoinGift(userId, amount, guildId) {
  // Mettre à jour les dons cumulés
  updateMissionProgress(userId, MISSION_EVENTS.GIVE_COINS, amount, guildId);
  
  // Vérifier l'objectif de dons totaux
  updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GIVE, amount, guildId);
}

// Gérer l'ouverture d'une boîte à organes
function handleBoxOpening(userId, guildId) {
  // Mettre à jour le compteur de boîtes ouvertes
  updateMissionProgress(userId, MISSION_EVENTS.OPEN_BOXES_50, 1, guildId);
  updateMissionProgress(userId, MISSION_EVENTS.OPEN_BOXES_100, 1, guildId);
  updateMissionProgress(userId, MISSION_EVENTS.OPEN_BOXES_200, 1, guildId);
}

// Réinitialiser les statistiques quotidiennes
async function resetDailyStats() {
  try {
    // Récupérer tous les utilisateurs
    const users = db.prepare('SELECT user_id, guild_id, gameStats FROM users').all();
    
    // Mettre à jour chaque utilisateur
    for (const user of users) {
      try {
        let gameStats = {};
        
        // Parser gameStats s'il existe
        if (user.gameStats && typeof user.gameStats === 'string') {
          gameStats = JSON.parse(user.gameStats);
        } else if (user.gameStats) {
          gameStats = user.gameStats;
        }
        
        // Réinitialiser les compteurs quotidiens
        gameStats.gamesPlayedToday = 0;
        gameStats.differentGamesPlayed = [];
        
        // Mettre à jour l'utilisateur dans la base de données
        db.prepare('UPDATE users SET gameStats = ? WHERE user_id = ? AND guild_id IS ?')
          .run(JSON.stringify(gameStats), user.user_id, user.guild_id);
      } catch (error) {
        console.error(`Erreur lors de la réinitialisation des statistiques pour l'utilisateur ${user.user_id}:`, error);
      }
    }
    
    console.log('Réinitialisation quotidienne des statistiques de jeu effectuée avec succès');
  } catch (error) {
    console.error('Erreur lors de la réinitialisation quotidienne des statistiques:', error);
  }
  
  // Planifier la prochaine réinitialisation (toutes les 24 heures)
  setTimeout(resetDailyStats, 24 * 60 * 60 * 1000);
}

// Démarrer le timer de réinitialisation quotidienne (dans 24 heures)
setTimeout(resetDailyStats, 24 * 60 * 60 * 1000);

module.exports = {
  MISSION_TYPES,
  MISSION_EVENTS,
  updateUserGameStats,
  handleGameWin,
  handleGameLose,
  handleItemPurchase,
  handleBoostActivation,
  handleCoinGift,
  handleBoxOpening
};
