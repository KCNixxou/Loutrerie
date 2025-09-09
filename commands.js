const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('de')
    .setDescription('Lancer un dé à 6 faces 🎲'),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Voir ton profil (niveau, XP, coquillages)'),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Récupérer ta récompense journalière de 100 🐚'),

  new SlashCommandBuilder()
    .setName('highlow')
    .setDescription('Jouer au High Low (Plus haut/Plus bas/Égal)')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('reset-daily')
    .setDescription('[ADMIN] Réinitialiser la date de dernière récupération')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à réinitialiser')
        .setRequired(true)),

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
          { name: 'Changement de couleurs (10,000 🐚)', value: 'color_change' },
          { name: 'Surprise Mystère #1 (100,000 🐚)', value: 'surprise1' },
          { name: 'Surprise Mystère #2 (100,000 🐚)', value: 'surprise2' }
        )
    ),

  new SlashCommandBuilder()
    .setName('givea')
    .setDescription('Donner des coquillages (Admin seulement)')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur à qui donner des coquillages')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('montant')
        .setDescription('Montant de coquillages à donner')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('set-balance')
    .setDescription('[ADMIN] Définir le solde en coquillages d\'un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur dont vous voulez modifier le solde')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('montant')
        .setDescription('Nouveau solde en coquillages')
        .setRequired(true)
        .setMinValue(0)),

  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Donner des coquillages à un autre joueur (max 200/jour)')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('À qui voulez-vous donner des coquillages ?')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('montant')
        .setDescription('Nombre de coquillages à donner')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(200)),

  new SlashCommandBuilder()
    .setName('crash')
    .setDescription('Jouer au jeu du crash ')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)
    ),
    
  new SlashCommandBuilder()
    .setName('cashout')
    .setDescription('Récupérer tes gains dans le jeu du crash 💰'),
    
  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Tenter d\'atteindre le prochain multiplicateur dans le jeu du crash 🚀'),
    
  new SlashCommandBuilder()
    .setName('morpion')
    .setDescription('Jouer au morpion contre un autre joueur')
    .addUserOption(option =>
      option.setName('adversaire')
        .setDescription('Joueur contre qui vous voulez jouer')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Mise en coquillages (optionnel)')
        .setRequired(false)
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('classement-morpion')
    .setDescription('Affiche le classement des meilleurs joueurs de morpion')
    .addIntegerOption(option =>
      option.setName('limite')
        .setDescription('Nombre de joueurs à afficher (par défaut: 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)),

  new SlashCommandBuilder()
    .setName('loutre-giveaway')
    .setDescription('[ADMIN] Lancer un giveaway de 500  pour la première loutre qui clique')
    .setDefaultMemberPermissions(0) // Par défaut, personne n'a la permission
    .setDMPermission(false),
    
  // Commande de maintenance
  new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('[ADMIN] Activer/désactiver le mode maintenance')
    .setDefaultMemberPermissions(0) // Par défaut, personne n'a la permission
    .setDMPermission(false)
];

module.exports = commands.map(command => command.toJSON());
