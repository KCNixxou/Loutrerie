/**
 * Gère les erreurs d'interaction de manière centralisée
 * @param {Interaction} interaction - L'objet d'interaction Discord.js
 * @param {string} content - Le contenu du message d'erreur
 * @param {Object} options - Options supplémentaires
 * @param {boolean} [options.ephemeral=true] - Si le message doit être éphémère
 * @param {Array} [options.components=[]] - Composants à inclure dans la réponse
 * @returns {Promise<void>}
 */
async function handleInteractionError(interaction, content, options = {}) {
  const { ephemeral = true, components = [] } = options;
  
  try {
    if (interaction.replied) {
      await interaction.editReply({
        content,
        components,
        embeds: [],
        files: []
      }).catch(console.error);
      return;
    }
    
    if (interaction.deferred) {
      await interaction.editReply({
        content,
        components,
        ephemeral,
        embeds: [],
        files: []
      }).catch(console.error);
      return;
    }
    
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await interaction.update({
        content,
        components,
        embeds: [],
        files: []
      }).catch(async (err) => {
        console.error('Error updating interaction:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content,
            ephemeral: true,
            components
          }).catch(console.error);
        }
      });
      return;
    }
    
    await interaction.reply({
      content,
      ephemeral,
      components
    }).catch(console.error);
    
  } catch (error) {
    console.error('Error in handleInteractionError:', error);
  }
}

module.exports = {
  handleInteractionError
};
