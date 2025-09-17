module.exports = {
  // Durée maximale d'un concours (en heures)
  MAX_DURATION: 24,
  
  // Montant minimum du gain (en coquillages)
  MIN_PRIZE: 100,
  
  // Durée par défaut si non spécifiée (en heures)
  DEFAULT_DURATION: 12,
  
  // Message d'erreur pour les permissions insuffisantes
  ERRORS: {
    NO_PERMISSION: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
    ALREADY_ACTIVE: '❌ Un concours est déjà en cours !',
    INVALID_DURATION: (min, max) => `❌ La durée doit être comprise entre ${min} et ${max} heures.`,
    INVALID_PRIZE: (min) => `❌ Le montant du gain doit être d'au moins ${min} coquillages.`
  },
  
  // Messages de succès
  MESSAGES: {
    CONTEST_STARTED: (prize, endTime) => 
      `✅ Concours quotidien lancé avec succès ! Il se terminera <t:${Math.floor(endTime / 1000)}:R>`,
    CONTEST_ENDED: (winnerId, prize) =>
      `🎉 Félicitations <@${winnerId}> ! Tu as gagné **${prize.toLocaleString()} 🐚** !`,
    NO_WINNERS: '😢 Personne n\'a gagné cette fois-ci. Réessayez demain !',
    CONTEST_ENDED_TITLE: '🎉 CONCOURS TERMINÉ ! 🎉',
    CONTEST_ACTIVE_TITLE: '🎉 CONCOURS QUOTIDIEN 🎉',
    CONTEST_DESCRIPTION: (prize, hoursLeft) =>
      `**Premier arrivé, premier servi !**\n` +
      `Réagissez avec 🦦 pour tenter de gagner **${prize.toLocaleString()} 🐚** !\n\n` +
      `Le concours se termine dans **${hoursLeft} heure(s)** ou dès qu'un gagnant est désigné.`
  },
  
  // Configuration des embeds
  EMBED_COLORS: {
    ACTIVE: 0xFFD700, // Or
    ENDED: 0xFF0000,  // Rouge
    WINNER: 0x00FF00  // Vert
  }
};
