const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database('bot.sqlite');
db.pragma('journal_mode = WAL');

// Fonction pour vérifier si une colonne existe
function columnExists(tableName, columnName) {
  try {
    const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return info.some(col => col.name === columnName);
  } catch (error) {
    console.error('Erreur lors de la vérification de la colonne:', error);
    return false;
  }
}

// Fonction pour ajouter une colonne si elle n'existe pas
function addColumnIfNotExists(tableName, columnName, columnDef) {
  if (!columnExists(tableName, columnName)) {
    try {
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run();
      console.log(`Colonne ${columnName} ajoutée à la table ${tableName}`);
    } catch (error) {
      console.error(`Erreur lors de l'ajout de la colonne ${columnName}:`, error);
    }
  }
}

// Mise à jour du schéma de la base de données
function updateDatabaseSchema() {
  // Ajout des colonnes pour le jeu Crash
  addColumnIfNotExists('users', 'last_bet', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_bet_time', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'total_won', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'total_wagered', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_win', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_win_time', 'INTEGER DEFAULT 0');
  
  // Ajout des colonnes pour le système de dons
  addColumnIfNotExists('users', 'daily_given', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_give_reset', 'INTEGER DEFAULT 0');
  
  // Ajout des colonnes pour le High Low spécial
  addColumnIfNotExists('users', 'special_balance', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'special_total_won', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'special_total_wagered', 'INTEGER DEFAULT 0');
  
  // Ajout de la colonne pour le suivi des récompenses BDG quotidiennes
  addColumnIfNotExists('users', 'last_bdg_claim', 'INTEGER DEFAULT 0');
}

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
    last_mission_reset INTEGER DEFAULT 0,
    daily_given INTEGER DEFAULT 0,
    last_give_reset INTEGER DEFAULT 0,
    last_bet INTEGER DEFAULT 0,
    last_bet_time INTEGER DEFAULT 0,
    total_won INTEGER DEFAULT 0,
    total_wagered INTEGER DEFAULT 0,
    last_win INTEGER DEFAULT 0,
    last_win_time INTEGER DEFAULT 0,
    special_balance INTEGER DEFAULT 0,
    special_total_won INTEGER DEFAULT 0,
    special_total_wagered INTEGER DEFAULT 0,
    last_bdg_claim INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tic_tac_toe_stats (
    user_id TEXT PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    last_played INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS lottery_pot (
    id INTEGER PRIMARY KEY DEFAULT 1,
    current_amount INTEGER DEFAULT 0,
    last_winner_id TEXT,
    last_win_amount INTEGER DEFAULT 0,
    last_win_time INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS lottery_participants (
    user_id TEXT PRIMARY KEY,
    amount_contributed INTEGER DEFAULT 0,
    last_contribution_time INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS daily_contests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    prize INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    has_winner INTEGER DEFAULT 0,
    winner_id TEXT
  );
  
  -- S'assurer qu'il y a une entrée dans la table lottery_pot
  INSERT OR IGNORE INTO lottery_pot (id, current_amount) VALUES (1, 0);
`);

// Fonctions utilitaires
function ensureUser(userId) {
  const stmt = db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)');
  stmt.run(userId);
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

function updateUser(userId, data) {
  const entries = Object.entries(data);
  if (entries.length === 0) return;
  
  const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = [...entries.map(([, value]) => value), userId];
  
  db.prepare(`UPDATE users SET ${setClause} WHERE user_id = ?`).run(...values);
  
  // Mettre à jour le niveau si nécessaire
  if (data.xp !== undefined) {
    const user = db.prepare('SELECT xp, level FROM users WHERE user_id = ?').get(userId);
    const newLevel = Math.floor(Math.sqrt(user.xp) / 10) + 1;
    
    if (newLevel > user.level) {
      db.prepare('UPDATE users SET level = ? WHERE user_id = ?').run(newLevel, userId);
    }
  }
}

// Fonctions pour les concours quotidiens
function saveDailyContest(channelId, messageId, prize, startTime, endTime) {
  try {
    const stmt = db.prepare(`
      INSERT INTO daily_contests (channel_id, message_id, prize, start_time, end_time, is_active, has_winner)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `);
    const result = stmt.run(channelId, messageId, prize, startTime, endTime);
    return result.lastInsertRowid;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du concours:', error);
    return null;
  }
}

function getActiveDailyContest() {
  try {
    const stmt = db.prepare('SELECT * FROM daily_contests WHERE is_active = 1 AND has_winner = 0 LIMIT 1');
    return stmt.get();
  } catch (error) {
    console.error('Erreur lors de la récupération du concours actif:', error);
    return null;
  }
}

function getDailyContestById(contestId) {
  try {
    const stmt = db.prepare('SELECT * FROM daily_contests WHERE id = ?');
    return stmt.get(contestId);
  } catch (error) {
    console.error('Erreur lors de la récupération du concours par ID:', error);
    return null;
  }
}

function getAllActiveDailyContests() {
  try {
    const stmt = db.prepare('SELECT * FROM daily_contests WHERE is_active = 1 AND has_winner = 0');
    return stmt.all();
  } catch (error) {
    console.error('Erreur lors de la récupération des concours actifs:', error);
    return [];
  }
}

function setDailyContestWinner(contestId, winnerId) {
  try {
    const stmt = db.prepare('UPDATE daily_contests SET has_winner = 1, winner_id = ? WHERE id = ?');
    return stmt.run(winnerId || null, contestId).changes > 0;
  } catch (error) {
    console.error('Erreur lors de la mise à jour du gagnant du concours:', error);
    return false;
  }
}

function removeDailyContest(contestId) {
  try {
    const stmt = db.prepare('DELETE FROM daily_contests WHERE id = ?');
    return stmt.run(contestId).changes > 0;
  } catch (error) {
    console.error('Erreur lors de la suppression du concours:', error);
    return false;
  }
}

