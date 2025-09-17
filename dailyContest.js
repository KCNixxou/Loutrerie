// Importation des dépendances
const { EmbedBuilder } = require('discord.js');
const { saveDailyContest, getActiveDailyContest, setDailyContestWinner, getDailyContestById } = require('./database');

// Liste des IDs des administrateurs
const ADMIN_IDS = new Set([
  '314458846754111499', // Votre ID Discord
  '678264841617670145'  // Nouvel administrateur
]);

/**
 * Gère la commande de concours quotidien
 * @param {import('discord.js').CommandInteraction} interaction - L'interaction de commande
 */
async function handleDailyContest(interaction) {
  // Vérifier les permissions admin
  if (!ADMIN_IDS.has(interaction.user.id)) {
    return interaction.reply({ 
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.', 
      ephemeral: true 
    });
  }

  const duration = interaction.options.getInteger('duree');
  const prize = interaction.options.getInteger('gain');
  
  // Vérifier si un concours est déjà en cours
  const activeContest = getActiveDailyContest();
  if (activeContest) {
    return interaction.reply({
      content: '❌ Un concours est déjà en cours !',
      ephemeral: true
    });
  }
  
  // Calculer la durée aléatoire (entre 1 et la durée maximale spécifiée, en heures)
  const randomHours = Math.floor(Math.random() * duration) + 1;
  const endTime = Date.now() + (randomHours * 60 * 60 * 1000);
  
  // Créer l'embed du concours
  const embed = new EmbedBuilder()
    .setTitle('🎉 CONCOURS QUOTIDIEN 🎉')
    .setDescription(`**Le premier qui réagit avec 🦦 gagne ${prize.toLocaleString()} 🐚 !**`)
    .addFields(
      { name: 'Temps restant', value: `Le concours se termine dans environ ${randomHours} heure(s) !` },
      { name: 'Comment participer', value: 'Réagissez avec 🦦 pour tenter de gagner !' }
    )
    .setColor('#FFD700')
    .setFooter({ text: 'Concours quotidien - Premier arrivé, premier servi !' })
    .setTimestamp();
  
  // Envoyer le message de concours
  const message = await interaction.reply({ 
    embeds: [embed],
    fetchReply: true
  });
  
  // Ajouter la réaction
  await message.react('🦦');
  
  // Sauvegarder le concours dans la base de données
  saveDailyContest(interaction.channelId, message.id, prize, Date.now(), endTime);
  
  // Planifier la fin du concours
  setTimeout(() => endDailyContest(message.id, interaction.channel), randomHours * 60 * 60 * 1000);
  
  console.log(`[DailyContest] Nouveau concours démarré par ${interaction.user.tag} pour ${prize} 🐚 pendant ${randomHours} heures`);
}

/**
 * Termine un concours quotidien
 * @param {string} contestId - L'ID du concours
 * @param {import('discord.js').TextChannel} channel - Le canal du concours
 */
async function endDailyContest(contestId, channel) {
  try {
    // Récupérer les informations du concours
    const contest = getDailyContestById(contestId);
    if (!contest || contest.has_winner) return;
    
    // Marquer le concours comme terminé avec un gagnant (même si personne n'a gagné)
    setDailyContestWinner(contestId, null);
    
    // Essayer de récupérer le message original
    try {
      const message = await channel.messages.fetch(contest.message_id);
      
      // Mettre à jour le message pour indiquer qu'il n'y a pas de gagnant
      const embed = new EmbedBuilder()
        .setTitle('🎉 CONCOURS TERMINÉ ! 🎉')
        .setDescription('Personne n\'a gagné cette fois-ci !')
        .setColor('#FF0000')
        .setFooter({ text: 'Concours quotidien terminé' });
      
      await message.edit({ embeds: [embed] });
      await message.reactions.removeAll();
    } catch (error) {
      console.error(`[DailyContest] Erreur lors de la mise à jour du message:`, error);
    }
    
    console.log(`[DailyContest] Concours ${contestId} terminé sans gagnant`);
  } catch (error) {
    console.error('[DailyContest] Erreur dans endDailyContest:', error);
  }
}

/**
 * Restaure les concours quotidiens actifs au démarrage du bot
 * @param {import('discord.js').Client} client - Le client Discord
 */
async function restoreActiveDailyContests(client) {
  try {
    console.log('[DailyContest] Vérification des concours quotidiens actifs...');
    
    // Récupérer les concours actifs depuis la base de données
    const activeContests = db.prepare(`
      SELECT * FROM daily_contests 
      WHERE is_active = 1 AND has_winner = 0 AND end_time > ?
    `).all(Date.now());
    
    console.log(`[DailyContest] ${activeContests.length} concours actifs trouvés`);
    
    for (const contest of activeContests) {
      try {
        // Vérifier si le salon existe toujours
        const channel = await client.channels.fetch(contest.channel_id).catch(() => null);
        if (!channel) {
          console.log(`[DailyContest] Salon ${contest.channel_id} introuvable pour le concours ${contest.id}`);
          continue;
        }
        
        // Vérifier si le message existe toujours
        const message = await channel.messages.fetch(contest.message_id).catch(() => null);
        if (!message) {
          console.log(`[DailyContest] Message ${contest.message_id} introuvable pour le concours ${contest.id}`);
          continue;
        }
        
        // Vérifier si le concours est déjà terminé
        if (contest.has_winner) {
          console.log(`[DailyContest] Le concours ${contest.id} a déjà un gagnant`);
          continue;
        }
        
        // Vérifier si le temps est écoulé
        const timeLeft = contest.end_time - Date.now();
        if (timeLeft <= 0) {
          // Le temps est écoulé, terminer le concours
          console.log(`[DailyContest] Le concours ${contest.id} est terminé, vérification du gagnant...`);
          await endDailyContest(contest.id, channel);
          continue;
        }
        
        // Le concours est toujours actif, planifier sa fin
        console.log(`[DailyContest] Concours ${contest.id} restauré, fin dans ${Math.ceil(timeLeft / 1000 / 60)} minutes`);
        
        // Réagir au message si nécessaire
        try {
          await message.react('🦦');
        } catch (error) {
          console.error(`[DailyContest] Erreur lors de l'ajout de la réaction:`, error);
        }
        
        // Planifier la fin du concours
        setTimeout(() => endDailyContest(contest.id, channel), timeLeft);
        
      } catch (error) {
        console.error(`[DailyContest] Erreur lors de la restauration du concours ${contest.id}:`, error);
      }
    }
    
  } catch (error) {
    console.error('[DailyContest] Erreur critique lors de la restauration des concours:', error);
  }
}

module.exports = {
  handleDailyContest,
  endDailyContest,
  restoreActiveDailyContests,
  ADMIN_IDS
};
