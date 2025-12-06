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
  // Ajout des colonnes pour le jeu Crash (anciens schémas)
  addColumnIfNotExists('users', 'last_bet', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_bet_time', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'total_won', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'total_wagered', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_win', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_win_time', 'INTEGER DEFAULT 0');
  
  // Ajout des colonnes pour le système de dons (anciens schémas)
  addColumnIfNotExists('users', 'daily_given', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_give_reset', 'INTEGER DEFAULT 0');
  
  // Ajout des colonnes pour le High Low spécial (anciens schémas)
  addColumnIfNotExists('users', 'special_balance', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'special_total_won', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'special_total_wagered', 'INTEGER DEFAULT 0');
  
  // Ajout des colonnes pour le suivi des récompenses BDG et BDH quotidiennes (anciens schémas)
  addColumnIfNotExists('users', 'last_bdg_claim', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'last_bdh_claim', 'INTEGER DEFAULT 0');
  
  // Ajout de la colonne pour les statistiques de jeu
  addColumnIfNotExists('users', 'gameStats', 'TEXT DEFAULT "{}"');
  
  // Ajout de la colonne pour stocker les missions
  addColumnIfNotExists('users', 'missions', 'TEXT DEFAULT "{}"');

  // Création de la table pour les effets temporaires des consommables
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT,
      effect TEXT NOT NULL,
      value REAL,
      uses INTEGER DEFAULT 1,
      expires_at INTEGER,
      description TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'current_timestamp')),
      FOREIGN KEY (user_id, guild_id) REFERENCES users(user_id, guild_id)
    );
  `);

  // Migration vers un schéma par serveur si nécessaire
  try {
    const hasGuildId = columnExists('users', 'guild_id');
    if (!hasGuildId) {
      console.log('[Database] Migration du schéma users vers un modèle par serveur (ajout de guild_id)...');

      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;

        ALTER TABLE users RENAME TO users_old;

        CREATE TABLE IF NOT EXISTS users (
          user_id TEXT NOT NULL,
          guild_id TEXT,
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
          last_bdg_claim INTEGER DEFAULT 0,
          last_bdh_claim INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, guild_id)
        );

        INSERT INTO users (
          user_id,
          guild_id,
          balance,
          xp,
          level,
          last_xp_gain,
          last_daily_claim,
          daily_messages,
          daily_missions,
          last_mission_reset,
          daily_given,
          last_give_reset,
          last_bet,
          last_bet_time,
          total_won,
          total_wagered,
          last_win,
          last_win_time,
          special_balance,
          special_total_won,
          special_total_wagered,
          last_bdg_claim,
          last_bdh_claim
        )
        SELECT
          user_id,
          NULL AS guild_id,
          balance,
          xp,
          level,
          last_xp_gain,
          last_daily_claim,
          daily_messages,
          daily_missions,
          last_mission_reset,
          daily_given,
          last_give_reset,
          last_bet,
          last_bet_time,
          total_won,
          total_wagered,
          last_win,
          last_win_time,
          COALESCE(special_balance, 0),
          COALESCE(special_total_won, 0),
          COALESCE(special_total_wagered, 0),
          COALESCE(last_bdg_claim, 0),
          COALESCE(last_bdh_claim, 0)
        FROM users_old;

        DROP TABLE users_old;

        COMMIT;
        PRAGMA foreign_keys = ON;
      `);

      console.log('[Database] Migration users -> users(user_id, guild_id, ...) terminée avec succès');
    }
  } catch (error) {
    console.error('[Database] Erreur lors de la migration du schéma users vers le modèle par serveur:', error);
  }
  
  // Création des tables pour la loterie si elles n'existent pas
  try {
    db.exec(`
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
      
      -- S'assurer qu'il y a une entrée dans la table lottery_pot
      INSERT OR IGNORE INTO lottery_pot (id, current_amount) VALUES (1, 0);
    `);
    console.log('[Database] Tables de loterie vérifiées/créées avec succès');
  } catch (error) {
    console.error('Erreur lors de la création des tables de loterie:', error);
  }
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

  -- Nouvelle définition par défaut de la table users (pour les nouvelles installations)
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT NOT NULL,
    guild_id TEXT,
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
    last_bdg_claim INTEGER DEFAULT 0,
    last_bdh_claim INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
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
function ensureUser(userId, guildId = null) {
  // On distingue maintenant les données par serveur via guildId.
  // Pour conserver la compatibilité, un guildId nul représente les anciennes données globales
  // et peuvent être "réattribuées" au premier serveur qui utilise le bot.

  // 1. Tenter de récupérer l'utilisateur pour ce serveur précis
  let user = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id IS ?').get(userId, guildId);

  // 2. Si aucune ligne pour ce serveur et qu'on a un guildId, essayer de reprendre l'ancienne ligne globale (guild_id NULL)
  if (!user && guildId !== null) {
    const globalUser = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id IS NULL').get(userId);
    if (globalUser) {
      console.log(`[DB MIGRATION] Réattribution de l'utilisateur ${userId} du contexte global vers le serveur ${guildId}`);

      // Mettre à jour la ligne existante en lui affectant ce guildId
      db.prepare('UPDATE users SET guild_id = ? WHERE user_id = ? AND guild_id IS NULL').run(guildId, userId);

      // Relire l'utilisateur avec le nouveau guildId
      user = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id IS ?').get(userId, guildId);
    }
  }

  // 3. Si toujours rien, créer un nouvel utilisateur pour ce serveur
  if (!user) {
    const missions = JSON.stringify({
      daily: {},
      weekly: {},
      lifetime: {},
      lastDailyReset: 0,
      lastWeeklyReset: 0
    });
    const startingBalance = config.currency.startingBalance;

    db.prepare(`
      INSERT INTO users (
        user_id,
        guild_id,
        balance,
        missions,
        last_mission_reset
      ) 
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, guildId, startingBalance, missions, Date.now());

    user = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id IS ?').get(userId, guildId);
  }

  // S'assurer que le champ missions est correctement analysé depuis la chaîne JSON
  if (user && user.missions && typeof user.missions === 'string') {
    try {
      user.missions = JSON.parse(user.missions);
    } catch (e) {
      console.error('Erreur lors de l\'analyse du champ missions:', e);
      user.missions = {
        daily: {},
        weekly: {},
        lifetime: {},
        lastDailyReset: 0,
        lastWeeklyReset: 0
      };
    }
  } else if (!user.missions) {
    user.missions = {
      daily: {},
      weekly: {},
      lifetime: {},
      lastDailyReset: 0,
      lastWeeklyReset: 0
    };
  }

  // S'assurer que le champ gameStats est correctement analysé depuis la chaîne JSON
  if (user && user.gameStats && typeof user.gameStats === 'string') {
    try {
      user.gameStats = JSON.parse(user.gameStats);
    } catch (e) {
      console.error('Erreur lors de l\'analyse du champ gameStats:', e);
      user.gameStats = {
        gamesPlayed: 0,
        gamesWon: 0,
        gamesLost: 0,
        lastPlayed: Date.now(),
        gamesPlayedToday: 0,
        differentGamesPlayed: []
      };
    }
  } else if (!user.gameStats) {
    user.gameStats = {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      lastPlayed: Date.now(),
      gamesPlayedToday: 0,
      differentGamesPlayed: []
    };
  }

  return user;
}

function updateUser(userId, guildId = null, data) {
  if (!data || Object.keys(data).length === 0) {
    console.error('[DB DEBUG] No data provided for update');
    return;
  }
  
  // Faire une copie des données pour éviter de modifier l'objet d'origine
  const updateData = { ...data };
  
  // Si l'objet missions est présent, le convertir en chaîne JSON
  if (updateData.missions && typeof updateData.missions === 'object') {
    updateData.missions = JSON.stringify(updateData.missions);
  }
  
  // Si l'objet gameStats est présent, le convertir en chaîne JSON
  if (updateData.gameStats && typeof updateData.gameStats === 'object') {
    updateData.gameStats = JSON.stringify(updateData.gameStats);
  }
  
  console.log(`[DB DEBUG] Mise à jour de l'utilisateur ${userId} (guild: ${guildId || 'NULL'}) avec les données:`, JSON.stringify(updateData, null, 2));
  
  try {
    const keys = Object.keys(updateData);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => updateData[k]);
    
    // Ajout des paramètres pour la clause WHERE (user_id, guild_id)
    values.push(userId, guildId);
    
    const query = `UPDATE users SET ${setClause} WHERE user_id = ? AND guild_id IS ?`;
    console.log(`[DB DEBUG] Exécution de la requête: ${query}`, values);
    
    const stmt = db.prepare(query);
    const result = stmt.run(...values);
    
    console.log(`[DB DEBUG] Résultat de la mise à jour:`, result);
    
    if (result.changes === 0) {
      console.warn(`[DB DEBUG] Aucun utilisateur trouvé avec l'ID: ${userId} (guild: ${guildId || 'NULL'}), tentative de création...`);
      // Essayer de créer l'utilisateur s'il n'existe pas
      ensureUser(userId, guildId);
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

/**
 * Génère des missions quotidiennes aléatoires
 */
function generateDailyMissions() {
  const config = require('./config');
  const dailyMissions = [];
  const missionPool = [...config.missions.daily];
  
  // Sélectionner 4 missions aléatoires
  for (let i = 0; i < 4 && missionPool.length > 0; i++) {
    const randomIndex = Math.floor(Math.random() * missionPool.length);
    dailyMissions.push(missionPool.splice(randomIndex, 1)[0]);
  }
  
  return dailyMissions;
}

/**
 * Met à jour la progression d'une mission et attribue les récompenses si l'objectif est atteint
 * @param {string} userId - ID de l'utilisateur
 * @param {string} missionType - Type de mission (ex: 'daily_win', 'weekly_boost', etc.)
 * @param {number} amount - Montant à ajouter à la progression
 * @param {string} guildId - ID du serveur (optionnel)
 * @returns {Object} Résultat de la mise à jour avec les informations sur les récompenses
 */
function updateMissionProgress(userId, missionType, amount = 1, guildId = null) {
  try {
    const now = Date.now();
    const user = ensureUser(userId, guildId);
    const config = require('./config');
    
    // Vérifier si l'utilisateur a déjà des missions
    if (!user.missions) {
      user.missions = { 
        daily: {}, 
        weekly: {},
        lifetime: {},
        lastDailyReset: 0,
        lastWeeklyReset: 0
      };
    }
    
    // Vérifier et réinitialiser les missions quotidiennes si nécessaire
    const lastReset = new Date(user.missions.lastDailyReset || 0);
    const today = new Date();
    if (lastReset.getDate() !== today.getDate() || 
        lastReset.getMonth() !== today.getMonth() || 
        lastReset.getFullYear() !== today.getFullYear()) {
      user.missions.daily = {};
      user.missions.lastDailyReset = now;
    }
    
    // Vérifier et réinitialiser les missions hebdomadaires si nécessaire (tous les lundis)
    const lastWeeklyReset = new Date(user.missions.lastWeeklyReset || 0);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    if (lastWeeklyReset < weekAgo || lastWeeklyReset.getDay() !== 1) {
      user.missions.weekly = {};
      user.missions.lastWeeklyReset = now;
    }
    
    // Déterminer la catégorie de la mission
    let category = null;
    let mission = null;
    
    // Vérifier dans chaque catégorie de mission
    for (const [cat, missions] of Object.entries(config.missions)) {
      const foundMission = missions.find(m => m.id === missionType);
      if (foundMission) {
        category = cat;
        mission = foundMission;
        break;
      }
    }
    
    if (!category || !mission) {
      console.log(`[MISSIONS] Mission non trouvée: ${missionType}`);
      return { success: false, error: 'Mission not found' };
    }
    
    // Initialiser la mission si elle n'existe pas
    if (!user.missions[category]) {
      user.missions[category] = {};
    }
    if (!user.missions[category][missionType]) {
      user.missions[category][missionType] = {
        progress: 0,
        completed: false,
        claimed: false,
        lastUpdated: now
      };
    }
    
    const missionData = user.missions[category][missionType];
    
    // Si la mission est déjà complétée, ne rien faire
    if (missionData.completed) {
      return { 
        success: true, 
        alreadyCompleted: true,
        progress: missionData.progress,
        goal: mission.goal,
        reward: mission.reward,
        claimed: missionData.claimed
      };
    }
    
    // Mettre à jour la progression
    missionData.progress = Math.min(missionData.progress + amount, mission.goal);
    missionData.lastUpdated = now;
    
    // Vérifier si la mission est complétée
    let reward = null;
    if (missionData.progress >= mission.goal) {
      missionData.completed = true;
      missionData.progress = mission.goal; // S'assurer que la progression ne dépasse pas l'objectif
      
      // Attribuer la récompense
      if (mission.reward) {
        reward = {
          type: 'coins',
          amount: mission.reward
        };
        
        // Ajouter les coquillages à l'utilisateur
        updateUser(userId, guildId, { 
          balance: (user.balance || 0) + mission.reward 
        });
      }
    }
    
    // Mettre à jour l'utilisateur dans la base de données
    updateUser(userId, guildId, { missions: user.missions });
    
    return {
      success: true,
      completed: missionData.completed,
      progress: missionData.progress,
      goal: mission.goal,
      reward: reward,
      claimed: missionData.claimed
    };
  } catch (error) {
    console.error('[MISSIONS] Erreur lors de la mise à jour de la progression de la mission:', error);
    return { success: false, error: error.message };
  }
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

// Créer la table pour les giveaways si elle n'existe pas
db.exec(`
  CREATE TABLE IF NOT EXISTS giveaways (
    channel_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    prize INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    has_winner INTEGER DEFAULT 0,
    winner_id TEXT
  )
`);

// Fonctions pour gérer les giveaways
function saveGiveaway(channelId, messageId, prize, startTime, endTime) {
  db.prepare(`
    INSERT INTO giveaways (channel_id, message_id, prize, start_time, end_time, has_winner)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(channel_id) DO UPDATE SET
      message_id = excluded.message_id,
      prize = excluded.prize,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      has_winner = 0,
      winner_id = NULL
  `).run(channelId, messageId, prize, startTime, endTime);
}

function getActiveGiveaway(channelId) {
  return db.prepare(`
    SELECT * FROM giveaways 
    WHERE channel_id = ? AND has_winner = 0 AND end_time > ?
  `).get(channelId, Date.now());
}

function getAllActiveGiveaways() {
  return db.prepare(`
    SELECT * FROM giveaways 
    WHERE has_winner = 0 AND end_time > ?
  `).all(Date.now());
}

function setGiveawayWinner(channelId, winnerId) {
  db.prepare(`
    UPDATE giveaways 
    SET has_winner = 1, winner_id = ? 
    WHERE channel_id = ?
  `).run(winnerId, channelId);
}

function removeGiveaway(channelId) {
  db.prepare('DELETE FROM giveaways WHERE channel_id = ?').run(channelId);
}

// Fonctions pour gérer le solde spécial High Low
function getSpecialBalance(userId, guildId = null) {
  ensureUser(userId, guildId);
  const user = db.prepare('SELECT special_balance FROM users WHERE user_id = ? AND guild_id IS ?').get(userId, guildId);
  return user ? user.special_balance : 0;
}

function updateSpecialBalance(userId, amount, guildId = null) {
  ensureUser(userId, guildId);
  db.prepare('UPDATE users SET special_balance = special_balance + ? WHERE user_id = ? AND guild_id IS ?').run(amount, userId, guildId);
  return getSpecialBalance(userId, guildId);
}

function addSpecialWinnings(userId, amount, guildId = null) {
  ensureUser(userId, guildId);
  db.prepare('UPDATE users SET special_balance = special_balance + ?, special_total_won = special_total_won + ? WHERE user_id = ? AND guild_id IS ?')
    .run(amount, amount > 0 ? amount : 0, userId, guildId);
  return getSpecialBalance(userId, guildId);
}

function addSpecialWagered(userId, amount, guildId = null) {
  ensureUser(userId, guildId);
  db.prepare('UPDATE users SET special_total_wagered = special_total_wagered + ? WHERE user_id = ? AND guild_id IS ?')
    .run(amount, userId, guildId);
}

// Lottery Pot Functions
function addToPot(amount) {
  try {
    console.log(`[Lottery] Adding ${amount} to pot`);
    const pot = db.prepare('SELECT * FROM lottery_pot WHERE id = 1').get() || { current_amount: 0 };
    const newAmount = (pot.current_amount || 0) + amount;
    
    db.prepare(`
      INSERT OR REPLACE INTO lottery_pot (id, current_amount) 
      VALUES (?, ?)
    `).run(1, newAmount);
    
    console.log(`[Lottery] New pot amount: ${newAmount}`);
    return newAmount;
  } catch (error) {
    console.error('Error in addToPot:', error);
    throw error;
  }
}

function addLotteryParticipant(userId, amount) {
  try {
    console.log(`[Lottery] Adding participant ${userId} with amount ${amount}`);
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO lottery_participants (user_id, amount_contributed, last_contribution_time)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) 
      DO UPDATE SET 
        amount_contributed = amount_contributed + ?,
        last_contribution_time = ?
    `).run(userId, amount, now, amount, now);
    
    // Vérifier que le participant a bien été ajouté/mis à jour
    const participant = db.prepare('SELECT * FROM lottery_participants WHERE user_id = ?').get(userId);
    console.log(`[Lottery] Participant ${userId} updated. New contribution: ${participant?.amount_contributed}`);
  } catch (error) {
    console.error('Error in addLotteryParticipant:', error);
    throw error;
  }
}

function getCurrentPot() {
  try {
    const pot = db.prepare('SELECT * FROM lottery_pot WHERE id = 1').get();
    const amount = pot ? pot.current_amount : 0;
    console.log(`[Lottery] Current pot amount: ${amount}`);
    return amount;
  } catch (error) {
    console.error('Error in getCurrentPot:', error);
    return 0;
  }
}

function getLotteryParticipants() {
  try {
    const participants = db.prepare('SELECT user_id, amount_contributed FROM lottery_participants').all();
    console.log(`[Lottery] Found ${participants.length} participants`);
    return participants;
  } catch (error) {
    console.error('Error in getLotteryParticipants:', error);
    return [];
  }
}

// Ajouter des fonds au pot commun
function addToPot(amount, userId = 'system') {
  if (amount <= 0) return 0;
  
  try {
    // Ajouter au pot
    db.prepare('UPDATE lottery_pot SET current_amount = current_amount + ? WHERE id = 1').run(amount);
    
    // Enregistrer la contribution si c'est un utilisateur spécifique
    if (userId !== 'system') {
      // Vérifier si l'utilisateur a déjà une entrée
      const existing = db.prepare('SELECT * FROM lottery_participants WHERE user_id = ?').get(userId);
      
      if (existing) {
        // Mettre à jour la contribution existante
        db.prepare('UPDATE lottery_participants SET amount_contributed = amount_contributed + ? WHERE user_id = ?')
          .run(amount, userId);
      } else {
        // Créer une nouvelle entrée
        db.prepare('INSERT INTO lottery_participants (user_id, amount_contributed) VALUES (?, ?)')
          .run(userId, amount);
      }
    }
    
    const newAmount = db.prepare('SELECT current_amount FROM lottery_pot WHERE id = 1').get().current_amount;
    console.log(`[Pot Commun] Ajout de ${amount} par ${userId}. Nouveau total: ${newAmount}`);
    return newAmount;
  } catch (error) {
    console.error('Erreur lors de l\'ajout au pot commun:', error);
    return 0;
  }
}

function drawLotteryWinner() {
  try {
    console.log('[Lottery] Drawing a winner (random selection)...');
    const participants = getLotteryParticipants();
    
    if (participants.length === 0) {
      console.log('[Lottery] No participants found');
      return null;
    }

    console.log(`[Lottery] Participants: ${participants.map(p => p.user_id).join(', ')}`);
    
    const pot = getCurrentPot();
    
    if (pot <= 0) {
      console.log('[Lottery] Pot is empty');
      return null;
    }
    
    console.log(`[Lottery] Pot amount: ${pot}`);
    
    // Sélection aléatoire d'un gagnant parmi tous les participants
    const randomIndex = Math.floor(Math.random() * participants.length);
    const winner = participants[randomIndex];
    
    console.log(`[Lottery] Random index: ${randomIndex}, Winner selected: ${winner.user_id}`);

    if (!winner) {
      console.log('[Lottery] No winner could be determined');
      return null;
    }

    const now = Date.now();
    console.log(`[Lottery] Updating lottery pot with winner ${winner.user_id} and amount ${pot}`);
    
    db.prepare(`
      UPDATE lottery_pot 
      SET 
        current_amount = 0,
        last_winner_id = ?,
        last_win_amount = ?,
        last_win_time = ?
      WHERE id = 1
    `).run(winner.user_id, pot, now);

    console.log('[Lottery] Clearing participants table');
    db.prepare('DELETE FROM lottery_participants').run();

    const result = {
      userId: winner.user_id,
      amount: pot
    };
    
    console.log('[Lottery] Draw complete. Winner:', result);
    return result;
    
  } catch (error) {
    console.error('Error in drawLotteryWinner:', error);
    return null;
  }
}

// Fonctions pour gérer les effets temporaires des consommables

// Ajouter un effet à un utilisateur
function addUserEffect(userId, effectData) {
  try {
    const guildId = effectData.guildId || null;
    const now = Date.now();
    
    // Supprimer TOUS les effets existants pour cet utilisateur dans cette guilde
    const deleteStmt = db.prepare(`
      DELETE FROM user_effects 
      WHERE user_id = ? AND (guild_id = ? OR (guild_id IS NULL AND ? IS NULL))
    `);
    
    deleteStmt.run(userId, guildId, guildId);
    console.log(`[Effects] Tous les effets existants supprimés pour l'utilisateur ${userId} avant l'ajout du nouvel effet`);
    
    // Ensuite, ajouter le nouvel effet
    const insertStmt = db.prepare(`
      INSERT INTO user_effects (user_id, guild_id, effect, value, uses, expires_at, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertStmt.run(
      userId,
      guildId,
      effectData.effect,
      effectData.value || null,
      effectData.uses || 1,
      effectData.expires_at || null,
      effectData.description || '',
      now
    );
    
    console.log(`[Effects] Effet ${effectData.effect} ajouté pour l'utilisateur ${userId} (anciens effets du même type supprimés)`);
    return true;
  } catch (error) {
    console.error('[Effects] Erreur lors de l\'ajout de l\'effet:', error);
    return false;
  }
}

// Récupérer tous les effets actifs d'un utilisateur
function getUserEffects(userId, guildId = null) {
  try {
    const now = Date.now();
    let stmt;
    
    if (guildId) {
      stmt = db.prepare(`
        SELECT * FROM user_effects 
        WHERE user_id = ? AND guild_id = ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC
      `);
      return stmt.all(userId, guildId, now);
    } else {
      stmt = db.prepare(`
        SELECT * FROM user_effects 
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC
      `);
      return stmt.all(userId, now);
    }
  } catch (error) {
    console.error('[Effects] Erreur lors de la récupération des effets:', error);
    return [];
  }
}

// Utiliser un effet (décrémenter les utilisations)
function useEffect(userId, effectType, guildId = null) {
  try {
    const now = Date.now();
    console.log(`[UseEffect] Appel - userId: ${userId}, effectType: ${effectType}, guildId: ${guildId}`);
    
    let stmt;
    
    if (guildId) {
      stmt = db.prepare(`
        UPDATE user_effects 
        SET uses = uses - 1 
        WHERE user_id = ? AND guild_id = ? AND effect = ? AND uses > 0 
        AND (expires_at IS NULL OR expires_at > ?)
      `);
      const result = stmt.run(userId, guildId, effectType, now);
      console.log(`[UseEffect] Résultat guild: ${result.changes} changements`);
      return result.changes > 0;
    } else {
      stmt = db.prepare(`
        UPDATE user_effects 
        SET uses = uses - 1 
        WHERE user_id = ? AND effect = ? AND uses > 0 
        AND (expires_at IS NULL OR expires_at > ?)
      `);
      const result = stmt.run(userId, effectType, now);
      console.log(`[UseEffect] Résultat no guild: ${result.changes} changements`);
      return result.changes > 0;
    }
  } catch (error) {
    console.error('[Effects] Erreur lors de l\'utilisation de l\'effet:', error);
    return false;
  }
}

// Supprimer les effets expirés (nettoyage)
function cleanupExpiredEffects() {
  try {
    const now = Date.now();
    const stmt = db.prepare('DELETE FROM user_effects WHERE expires_at IS NOT NULL AND expires_at <= ?');
    const result = stmt.run(now);
    
    if (result.changes > 0) {
      console.log(`[Effects] Nettoyage de ${result.changes} effets expirés`);
    }
    
    return result.changes;
  } catch (error) {
    console.error('[Effects] Erreur lors du nettoyage des effets expirés:', error);
    return 0;
  }
}

// Vérifier si un utilisateur a un effet actif
function hasActiveEffect(userId, effectType, guildId = null) {
  try {
    const now = Date.now();
    console.log(`[HasActiveEffect] Appel - userId: ${userId}, effectType: ${effectType}, guildId: ${guildId}`);
    
    let stmt;
    
    if (guildId) {
      stmt = db.prepare(`
        SELECT * FROM user_effects 
        WHERE user_id = ? AND guild_id = ? AND effect = ? 
        AND (expires_at IS NULL OR expires_at > ?) AND uses > 0
      `);
      const effects = stmt.all(userId, guildId, effectType, now);
      console.log(`[HasActiveEffect] Résultat guild: ${effects.length} effets actifs trouvés`);
      console.log(`[HasActiveEffect] Détails effets:`, effects);
      return effects.length > 0;
    } else {
      stmt = db.prepare(`
        SELECT * FROM user_effects 
        WHERE user_id = ? AND effect = ? 
        AND (expires_at IS NULL OR expires_at > ?) AND uses > 0
      `);
      const effects = stmt.all(userId, effectType, now);
      console.log(`[HasActiveEffect] Résultat no guild: ${effects.length} effets actifs trouvés`);
      console.log(`[HasActiveEffect] Détails effets:`, effects);
      return effects.length > 0;
    }
  } catch (error) {
    console.error('[Effects] Erreur lors de la vérification de l\'effet:', error);
    return false;
  }
}

// Fonction pour calculer les multiplicateurs d'effets temporaires
function calculateEffectMultiplier(userId, guildId) {
  if (!guildId) return 1.0; // Pas de guildId, pas d'effets
  
  try {
    const effects = getUserEffects(userId, guildId);
    if (!Array.isArray(effects)) {
      console.log(`[DB] getUserEffects n'a pas retourné un tableau pour ${userId}, guildId=${guildId}:`, effects);
      return 1.0;
    }
    
    let multiplier = 1.0;
    
    // Ne prendre que l'effet le plus récent de chaque type
    const latestEffects = {};
    effects.forEach(effect => {
      if (!latestEffects[effect.effect] || (effect.created_at > (latestEffects[effect.effect].created_at || 0))) {
        latestEffects[effect.effect] = effect;
      }
    });
    
    // Appliquer chaque type d'effet une seule fois (le plus récent)
    Object.values(latestEffects).forEach(effect => {
      switch (effect.effect) {
        case 'casino_bonus':
          // Ne pas cumuler, prendre le plus récent
          multiplier = (1 + effect.value);
          break;
        case 'double_winnings':
          // Ne pas cumuler, prendre le plus récent
          multiplier = effect.value;
          break;
      }
    });
    
    return multiplier;
  } catch (error) {
    console.error('[DB] Erreur dans calculateEffectMultiplier:', error);
    return 1.0;
  }
}

// Fonction pour vérifier et utiliser la protection contre les pertes
function checkLossProtection(userId, guildId, lossAmount) {
  if (!guildId) return false; // Pas de guildId, pas de protection
  
  if (hasActiveEffect(userId, 'loss_protection', guildId)) {
    // Utiliser l'effet de protection
    useEffect(userId, 'loss_protection', guildId);
    return true; // Protection appliquée
  }
  return false; // Pas de protection
}

// Fonction pour appliquer l'effet Double ou Crève
function applyDoubleOrNothing(userId, guildId, baseWinnings) {
  console.log(`[DoubleOrNothing] Appel - userId: ${userId}, guildId: ${guildId}, baseWinnings: ${baseWinnings}`);
  
  if (!guildId || baseWinnings <= 0) {
    console.log(`[DoubleOrNothing] Conditions non remplies - guildId: ${!!guildId}, baseWinnings: ${baseWinnings}`);
    return { winnings: baseWinnings, message: null };
  }

  const hasEffect = hasActiveEffect(userId, 'double_or_nothing', guildId);
  console.log(`[DoubleOrNothing] Effet actif: ${hasEffect}`);
  
  if (!hasEffect) {
    console.log(`[DoubleOrNothing] Pas d'effet double_or_nothing actif pour ${userId}`);
    return { winnings: baseWinnings, message: null };
  }

  console.log(`[DoubleOrNothing] Effet double_or_nothing trouvé pour ${userId} - application...`);
  const effectUsed = useEffect(userId, 'double_or_nothing', guildId);
  console.log(`[DoubleOrNothing] Effet utilisé: ${effectUsed}`);

  const success = Math.random() < 0.5;
  console.log(`[DoubleOrNothing] Succès: ${success}`);
  
  if (success) {
    return {
      winnings: baseWinnings * 2,
      message: '🔪 **Double ou Crève** a réussi : vos gains ont été **doublés** sur cette main.'
    };
  }

  return {
    winnings: 0,
    message: '🔪 **Double ou Crève** a échoué : vos gains ont été **perdus** sur cette main.'
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
  // Giveaway functions
  saveGiveaway,
  getActiveGiveaway,
  getAllActiveGiveaways,
  setGiveawayWinner,
  removeGiveaway,
  updateMissionProgress,
  getTicTacToeStats,
  updateTicTacToeStats,
  getTicTacToeLeaderboard,
  resetTicTacToeStats,
  // Fonctions pour le solde spécial High Low
  getSpecialBalance,
  updateSpecialBalance,
  addSpecialWinnings,
  addSpecialWagered,
  // Fonctions pour les effets temporaires
  addUserEffect,
  getUserEffects,
  useEffect,
  cleanupExpiredEffects,
  hasActiveEffect,
  calculateEffectMultiplier,
  checkLossProtection,
  applyDoubleOrNothing,
};
