const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database('bot.sqlite');
db.pragma('journal_mode = WAL');

// Création des tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT ${config.currency.startingBalance},
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    last_xp_gain INTEGER DEFAULT 0,
    last_daily_claim INTEGER DEFAULT 0,
    daily_messages INTEGER DEFAULT 0,
    daily_missions TEXT DEFAULT '[]',
    last_mission_reset INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS coinflip_games (
    game_id TEXT PRIMARY KEY,
    creator_id TEXT,
    bet_amount INTEGER,
    choice TEXT,
    status TEXT DEFAULT 'waiting',
    opponent_id TEXT,
    winner_id TEXT,
    created_at INTEGER
  )
`);

// Fonctions utilitaires
function ensureUser(userId) {
  let user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!user) {
    db.prepare(`
      INSERT INTO users (user_id, balance, daily_missions, last_mission_reset) 
      VALUES (?, ?, ?, ?)
    `).run(userId, config.currency.startingBalance, JSON.stringify(generateDailyMissions()), Date.now());
    user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  }
  return user;
}

function updateUser(userId, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE user_id = ?`).run(...values, userId);
}

function generateDailyMissions() {
  return config.missions.daily.map(mission => ({
    ...mission,
    progress: 0,
    completed: false
  }));
}

function updateMissionProgress(userId, missionType, amount = 1) {
  const user = ensureUser(userId);
  let missions = JSON.parse(user.daily_missions || '[]');
  let updated = false;
  let rewardEarned = 0;

  missions.forEach(mission => {
    if (mission.id === missionType && !mission.completed) {
      mission.progress = Math.min(mission.progress + amount, mission.goal);
      if (mission.progress >= mission.goal) {
        mission.completed = true;
        rewardEarned += mission.reward;
        updated = true;
      }
    }
  });

  if (updated) {
    updateUser(userId, {
      daily_missions: JSON.stringify(missions),
      balance: user.balance + rewardEarned
    });
  }

  return rewardEarned;
}

module.exports = {
  db,
  ensureUser,
  updateUser,
  generateDailyMissions,
  updateMissionProgress
};
