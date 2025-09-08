const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('de')
    .setDescription('Lance un dé à 6 faces'),

  async execute(interaction) {
    // Génère un nombre aléatoire entre 1 et 6
    const result = Math.floor(Math.random() * 6) + 1;
    
    // Envoie le résultat avec un petit emoji de dé
    await interaction.reply(`🎲 Le dé affiche : **${result}**`);
  },
};
