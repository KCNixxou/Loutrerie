const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Voir ton profil (niveau, XP, coquillages)'),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Récupérer ta récompense journalière de 100 🐚'),

  new SlashCommandBuilder()
    .setName('missions')
    .setDescription('Voir tes missions journalières'),

  new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Voir le classement')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type de classement')
        .setRequired(true)
        .addChoices(
          { name: 'XP', value: 'xp' },
          { name: 'Coquillages', value: 'balance' }
        )
    ),

  new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Jouer au blackjack 🃏')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Jouer à la roulette 🎡')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Jouer aux machines à sous 🎰')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('pileface')
    .setDescription('Jouer à pile ou face solo 🪙')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      option.setName('choix')
        .setDescription('Pile ou face ?')
        .setRequired(true)
        .addChoices(
          { name: 'Pile', value: 'pile' },
          { name: 'Face', value: 'face' }
        )
    ),

  new SlashCommandBuilder()
    .setName('pileface-multi')
    .setDescription('Créer ou rejoindre une partie de pile ou face multijoueurs 🪙')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      option.setName('choix')
        .setDescription('Pile ou face ?')
        .setRequired(true)
        .addChoices(
          { name: 'Pile', value: 'pile' },
          { name: 'Face', value: 'face' }
        )
    ),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Voir la boutique 🛒'),

  new SlashCommandBuilder()
    .setName('acheter')
    .setDescription('Acheter un item de la boutique')
    .addStringOption(option =>
      option.setName('item')
        .setDescription('Item à acheter')
        .setRequired(true)
        .addChoices(
          { name: 'Rôle VIP (10,000 🐚)', value: 'vip' },
          { name: 'Rôle Super VIP (20,000 🐚)', value: 'super_vip' },
          { name: 'Surprise Mystère #1 (100,000 🐚)', value: 'surprise1' },
          { name: 'Surprise Mystère #2 (100,000 🐚)', value: 'surprise2' }
        )
    )
];

module.exports = commands.map(command => command.toJSON());
