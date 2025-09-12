const { InteractionType } = require('discord.js');

/**
 * Gère les erreurs d'interaction de manière centralisée
 * @param {import('discord.js').Interaction} interaction - L'interaction à gérer
 * @param {Object} options - Les options de réponse
 * @param {string} [options.content] - Le contenu du message
 * @param {Array} [options.components] - Les composants à envoyer
 * @param {boolean} [options.ephemeral] - Si le message doit être éphémère
 * @param {boolean} [options.update] - Si on doit utiliser update au lieu de reply
 * @returns {Promise<void>}
 */
async function handleInteraction(interaction, options = {}) {
  if (!interaction) return;
  
  const { 
    content = '', 
    components = [], 
    ephemeral = false,
    update = false
  } = options;

  try {
    // Si l'interaction a déjà été répondue
    if (interaction.replied) {
      return await interaction.editReply({ content, components, ephemeral })
        .catch(console.error);
    }
    
    // Si l'interaction est différée
    if (interaction.deferred) {
      return await interaction.editReply({ content, components, ephemeral })
        .catch(console.error);
    }
    
    // Si c'est une interaction de type bouton ou menu déroulant
    if (update || interaction.isButton() || interaction.isSelectMenu()) {
      return await interaction.update({ content, components, ephemeral })
        .catch(async (err) => {
          console.error('Error updating interaction:', err);
          if (!interaction.replied) {
            return interaction.reply({ content, ephemeral: true })
              .catch(console.error);
          }
        });
    }
    
    // Réponse normale
    return await interaction.reply({ content, components, ephemeral })
      .catch(console.error);
      
  } catch (error) {
    console.error('Error in handleInteraction:', error);
  }
}

/**
 * Gère les erreurs d'interaction de manière générique
 * @param {import('discord.js').Interaction} interaction - L'interaction à gérer
 * @param {Error} error - L'erreur survenue
 * @returns {Promise<void>}
 */
async function handleInteractionError(interaction, error) {
  console.error('Interaction error:', error);
  
  const errorMessage = '❌ Une erreur est survenue lors du traitement de votre demande.';
  
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(errorMessage).catch(console.error);
    }
    
    return await interaction.reply({ 
      content: errorMessage,
      ephemeral: true 
    }).catch(console.error);
    
  } catch (err) {
    console.error('Failed to send error message:', err);
  }
}

module.exports = {
  handleInteraction,
  handleInteractionError
};
