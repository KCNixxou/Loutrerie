const { SlashCommandBuilder } = require('@discordjs/builders');
const { maintenance } = require('../maintenance');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Active ou désactive le mode maintenance (admin seulement)')
    .addStringOption(option =>
      option.setName('statut')
        .setDescription('Activer ou désactiver le mode maintenance')
        .setRequired(true)
        .addChoices(
          { name: 'Activer', value: 'on' },
          { name: 'Désactiver', value: 'off' }
        )
    ),

  async execute(interaction) {
    const status = interaction.options.getString('statut');
    const userId = interaction.user.id;
    
    const result = maintenance.setMaintenance(status === 'on', userId);
    
    await interaction.reply({
      content: result.message,
      ephemeral: true
    });
  }
};
