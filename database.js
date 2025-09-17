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

// Exécuter la mise à jour du schéma
updateDatabaseSchema();

// Création des tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tic_tac_toe_stats (
    user_id TEXT PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    last_played INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

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
    last_win_time INTEGER DEFAULT 0
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

db.exec(`
  CREATE TABLE IF NOT EXISTS lottery_pot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_amount INTEGER DEFAULT 0,
    last_winner_id TEXT,
    last_win_amount INTEGER DEFAULT 0,
    last_win_time INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS lottery_participants (
    user_id TEXT,
    amount_contributed INTEGER DEFAULT 0,
    last_contribution_time INTEGER DEFAULT 0,
    PRIMARY KEY (user_id)
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
  if (!data || Object.keys(data).length === 0) {
    console.error('[DB DEBUG] No data provided for update');
    return;
  }
  
  console.log(`[DB DEBUG] Mise à jour de l'utilisateur ${userId} avec les données:`, JSON.stringify(data, null, 2));
  
  try {
    const keys = Object.keys(data);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    
    // Add userId as the last parameter for the WHERE clause
    values.push(userId);
    
    const query = `UPDATE users SET ${setClause} WHERE user_id = ?`;
    console.log(`[DB DEBUG] Exécution de la requête: ${query}`, values);
    
    const stmt = db.prepare(query);
    const result = stmt.run(...values);
    
    console.log(`[DB DEBUG] Résultat de la mise à jour:`, result);
    
    if (result.changes === 0) {
      console.warn(`[DB DEBUG] Aucun utilisateur trouvé avec l'ID: ${userId}, tentative de création...`);
      // Essayer de créer l'utilisateur s'il n'existe pas
      ensureUser(userId);
      // Réessayer la mise à jour
      const retryResult = stmt.run(...values);
      console.log(`[DB DEBUG] Résultat de la tentative de réessai:`, retryResult);
      return retryResult;
    }
    
    return result;
  } catch (error) {
    console.error('[DB DEBUG] Erreur lors de la mise à jour de l\'utilisateur:', error);
    console.error('[DB DEBUG] Données en cours de mise à jour:', data);
    throw error; // Re-throw the error to be caught by the caller
  }
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

// Fonctions pour les statistiques du morpion
function getTicTacToeStats(userId) {
  const stats = db.prepare('SELECT * FROM tic_tac_toe_stats WHERE user_id = ?').get(userId);
  if (!stats) {
    // Créer une entrée si elle n'existe pas
    db.prepare('INSERT INTO tic_tac_toe_stats (user_id) VALUES (?)').run(userId);
    return { user_id: userId, wins: 0, losses: 0, draws: 0, games_played: 0, last_played: 0 };
  }
  return stats;
}

function updateTicTacToeStats(userId, result) {
  // result peut être 'win', 'loss' ou 'draw'
  const stats = getTicTacToeStats(userId);
  const now = Date.now();
  
  const updateData = {
    ...stats,
    games_played: stats.games_played + 1,
    last_played: now
  };
  
  if (result === 'win') updateData.wins = (stats.wins || 0) + 1;
  else if (result === 'loss') updateData.losses = (stats.losses || 0) + 1;
  else if (result === 'draw') updateData.draws = (stats.draws || 0) + 1;
  
  db.prepare(`
    INSERT OR REPLACE INTO tic_tac_toe_stats 
    (user_id, wins, losses, draws, games_played, last_played)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    updateData.wins,
    updateData.losses,
    updateData.draws,
    updateData.games_played,
    updateData.last_played
  );
  
  return updateData;
}

function getTicTacToeLeaderboard(limit = 10) {
  return db.prepare(`
    SELECT user_id, wins, losses, draws, games_played, 
           (wins * 1.0 / NULLIF(games_played, 0)) as win_rate
    FROM tic_tac_toe_stats
    WHERE games_played > 0
    ORDER BY wins DESC, win_rate DESC, games_played DESC
    LIMIT ?
  `).all(limit);
}

// Réinitialiser les statistiques du morpion pour un utilisateur spécifique ou pour tous les utilisateurs
function resetTicTacToeStats(userId = null) {
  if (userId) {
    return db.prepare(`
      DELETE FROM tic_tac_toe_stats
      WHERE user_id = ?
    `).run(userId);
  } else {
    return db.prepare(`
      DELETE FROM tic_tac_toe_stats
    `).run();
  }
}

// Fonctions pour gérer le solde spécial High Low
function getSpecialBalance(userId) {
  ensureUser(userId);
  const user = db.prepare('SELECT special_balance FROM users WHERE user_id = ?').get(userId);
  return user ? user.special_balance : 0;
}

function updateSpecialBalance(userId, amount) {
  ensureUser(userId);
  db.prepare('UPDATE users SET special_balance = special_balance + ? WHERE user_id = ?').run(amount, userId);
  return getSpecialBalance(userId);
}

function addSpecialWinnings(userId, amount) {
  ensureUser(userId);
  db.prepare('UPDATE users SET special_balance = special_balance + ?, special_total_won = special_total_won + ? WHERE user_id = ?')
    .run(amount, amount > 0 ? amount : 0, userId);
  return getSpecialBalance(userId);
}

function addSpecialWagered(userId, amount) {
  ensureUser(userId);
  db.prepare('UPDATE users SET special_total_wagered = special_total_wagered + ? WHERE user_id = ?')
    .run(amount, userId);
}

// Lottery Pot Functions
function addToPot(amount) {
  const pot = db.prepare('SELECT * FROM lottery_pot WHERE id = 1').get() || { current_amount: 0 };
  const newAmount = (pot.current_amount || 0) + amount;
  db.prepare(`
    INSERT OR REPLACE INTO lottery_pot (id, current_amount) 
    VALUES (1, ?)
  `).run(newAmount);
  return newAmount;
}

function addLotteryParticipant(userId, amount) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO lottery_participants (user_id, amount_contributed, last_contribution_time)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) 
    DO UPDATE SET 
      amount_contributed = amount_contributed + ?,
      last_contribution_time = ?
  `).run(userId, amount, now, amount, now);
}

function getCurrentPot() {
  const pot = db.prepare('SELECT * FROM lottery_pot WHERE id = 1').get();
  return pot ? pot.current_amount : 0;
}

function getLotteryParticipants() {
  return db.prepare('SELECT * FROM lottery_participants WHERE amount_contributed > 0').all();
}

function drawLotteryWinner() {
  const participants = getLotteryParticipants();
  if (participants.length === 0) return null;

  const totalContributions = participants.reduce((sum, p) => sum + p.amount_contributed, 0);
  const pot = getCurrentPot();
  let random = Math.random() * totalContributions;
  let winner = null;
  
  for (const p of participants) {
    random -= p.amount_contributed;
    if (random <= 0) {
      winner = p;
      break;
    }
  }

  if (!winner) return null;

  const now = Date.now();
  db.prepare(`
    UPDATE lottery_pot 
    SET 
      current_amount = 0,
      last_winner_id = ?,
      last_win_amount = ?,
      last_win_time = ?
    WHERE id = 1
  `).run(winner.user_id, pot, now);

  db.prepare('DELETE FROM lottery_participants').run();

  return {
    userId: winner.user_id,
    amount: pot
  };
}

module.exports = {
  db,
  ensureUser,
  updateUser,
  addToPot,
  addLotteryParticipant,
  getCurrentPot,
  getLotteryParticipants,
  drawLotteryWinner,
  updateMissionProgress,
  getTicTacToeStats,
  updateTicTacToeStats,
  getTicTacToeLeaderboard,
  resetTicTacToeStats,
  // Fonctions pour le solde spécial High Low
  getSpecialBalance,
  updateSpecialBalance,
  addSpecialWinnings,
  addSpecialWagered
};
