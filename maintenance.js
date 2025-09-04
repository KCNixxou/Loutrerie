const fs = require('fs');
const path = require('path');

const MAINTENANCE_FILE = path.join(__dirname, 'maintenance.json');

// État par défaut
let maintenanceState = {
  enabled: false,
  adminId: '314458846754111499', // Remplacez par votre ID Discord
  message: '⚠️ Le bot est actuellement en maintenance. Veuillez réessayer plus tard.'
};

// Charger l'état depuis le fichier
function loadMaintenanceState() {
  try {
    if (fs.existsSync(MAINTENANCE_FILE)) {
      const data = fs.readFileSync(MAINTENANCE_FILE, 'utf8');
      maintenanceState = { ...maintenanceState, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Erreur lors du chargement de l\'état de maintenance:', error);
  }
}

// Sauvegarder l'état dans le fichier
function saveMaintenanceState() {
  try {
    fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(maintenanceState, null, 2), 'utf8');
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de l\'état de maintenance:', error);
  }
}

// Vérifier si le mode maintenance est activé
function isMaintenanceMode() {
  return maintenanceState.enabled;
}

// Vérifier si l'utilisateur est l'admin
function isAdmin(userId) {
  return userId === maintenanceState.adminId;
}

// Activer/désactiver le mode maintenance
function setMaintenance(enabled, userId) {
  if (userId !== maintenanceState.adminId) {
    return { success: false, message: '❌ Vous n\'êtes pas autorisé à effectuer cette action.' };
  }
  
  maintenanceState.enabled = enabled;
  saveMaintenanceState();
  
  return { 
    success: true, 
    message: enabled 
      ? '✅ Mode maintenance activé. Seul l\'administrateur peut utiliser les commandes.'
      : '✅ Mode maintenance désactivé. Tous les utilisateurs peuvent à nouveau utiliser le bot.'
  };
}

// Middleware pour les commandes
function maintenanceMiddleware(interaction, next) {
  if (isMaintenanceMode() && !isAdmin(interaction.user.id)) {
    return interaction.reply({ 
      content: maintenanceState.message,
      ephemeral: true 
    });
  }
  return next();
}

// Charger l'état au démarrage
loadMaintenanceState();

module.exports = {
  isMaintenanceMode,
  isAdmin,
  setMaintenance,
  maintenanceMiddleware,
  getState: () => maintenanceState,
  maintenance // Export pour l'utiliser dans d'autres fichiers si nécessaire
};
