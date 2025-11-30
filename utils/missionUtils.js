const { updateMissionProgress } = require('../database');

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
const userGameStats = new Map();

// Mettre à jour les statistiques de jeu d'un utilisateur
function updateUserGameStats(userId, gameId) {
  if (!userGameStats.has(userId)) {
    userGameStats.set(userId, {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      gamesPlayedToday: 0,
      differentGamesPlayed: new Set()
    });
  }
  
  const stats = userGameStats.get(userId);
  stats.gamesPlayed++;
  stats.gamesPlayedToday++;
  stats.differentGamesPlayed.add(gameId);
  
  // Mettre à jour les missions basées sur le nombre de parties
  updateMissionProgress(userId, MISSION_EVENTS.GAME_PLAY, 1);
  
  // Vérifier les objectifs de parties totales
  if (stats.gamesPlayed >= 1000) {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_1000, 1);
  }
  if (stats.gamesPlayed >= 2000) {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_2000, 1);
  }
  if (stats.gamesPlayed >= 5000) {
    updateMissionProgress(userId, MISSION_EVENTS.TOTAL_GAMES_5000, 1);
  }
  
  // Vérifier les jeux différents
  if (stats.differentGamesPlayed.size >= 3) {
    updateMissionProgress(userId, MISSION_EVENTS.DIFFERENT_GAMES, 1);
  }
}

// Gérer une victoire au jeu
function handleGameWin(userId, gameId, guildId, winnings = 0) {
  if (!userGameStats.has(userId)) {
    updateUserGameStats(userId, gameId);
  }
  
  const stats = userGameStats.get(userId);
  stats.gamesWon++;
  
  // Mettre à jour les missions
  updateMissionProgress(userId, MISSION_EVENTS.GAME_WIN, 1, guildId);
  
  // Mettre à jour les gains cumulés
  if (winnings >= 50000) {
    updateMissionProgress(userId, MISSION_EVENTS.WIN_COINS, 50000, guildId);
  }
}

// Gérer une défaite au jeu
function handleGameLose(userId, gameId, guildId) {
  if (!userGameStats.has(userId)) {
    updateUserGameStats(userId, gameId);
  }
  
  const stats = userGameStats.get(userId);
  stats.gamesLost++;
  
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
function resetDailyStats() {
  userGameStats.forEach(stats => {
    stats.gamesPlayedToday = 0;
    stats.differentGamesPlayed.clear();
  });
  
  // Planifier la prochaine réinitialisation (à minuit)
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const timeUntilMidnight = midnight - now;
  
  setTimeout(() => {
    resetDailyStats();
  }, timeUntilMidnight);
}

// Démarrer le timer de réinitialisation quotidienne
resetDailyStats();

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
