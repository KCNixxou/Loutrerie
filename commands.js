const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('de')
    .setDescription('Lancer un dé à 6 faces 🎲'),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Voir ton profil (niveau, XP, coquillages)')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Voir le profil d\'un autre utilisateur')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Récupérer ta récompense journalière de 100 🐚'),

  new SlashCommandBuilder()
    .setName('dailybdg')
    .setDescription('Récupérer ta récompense BDG journalière (nécessite un rôle BDG)'),

  new SlashCommandBuilder()
    .setName('highlow')
    .setDescription('Jouer au High Low (Plus haut/Plus bas/Égal)')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('highlow-special')
    .setDescription('[SPÉCIAL] Jouer au High Low avec un solde séparé')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages spéciaux')
        .setRequired(true)
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('solde-special')
    .setDescription('[SPÉCIAL] Voir votre solde spécial pour le High Low')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('admin-solde-special')
    .setDescription('[ADMIN] Gérer les soldes spéciaux')
    .setDefaultMemberPermissions('0') // Par défaut, personne n'a accès
    .setDMPermission(false) // Désactiver en MP
    .addSubcommand(subcommand =>
      subcommand
        .setName('ajouter')
        .setDescription('Ajouter un montant au solde spécial d\'un utilisateur')
        .addUserOption(option =>
          option.setName('utilisateur')
            .setDescription('L\'utilisateur à qui ajouter le montant')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('montant')
            .setDescription('Montant à ajouter')
            .setRequired(true)
            .setMinValue(1)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('retirer')
        .setDescription('Retirer un montant du solde spécial d\'un utilisateur')
        .addUserOption(option =>
          option.setName('utilisateur')
            .setDescription('L\'utilisateur à qui retirer le montant')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('montant')
            .setDescription('Montant à retirer')
            .setRequired(true)
            .setMinValue(1)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('definir')
        .setDescription('Définir le solde spécial d\'un utilisateur')
        .addUserOption(option =>
          option.setName('utilisateur')
            .setDescription('L\'utilisateur dont vous voulez définir le solde')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('montant')
            .setDescription('Nouveau montant')
            .setRequired(true)
            .setMinValue(0))),

  new SlashCommandBuilder()
    .setName('reset-daily')
    .setDescription('[ADMIN] Réinitialiser la date de dernière récupération')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false)
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
          { name: 'Bébé BDG (10,000 🐚)', value: 'bdg_baby' },
          { name: 'Petit BDG (50,000 🐚)', value: 'bdg_petit' },
          { name: 'Gros BDG (200,000 🐚)', value: 'bdg_gros' },
          { name: 'BDG Ultime (1,000,000 🐚)', value: 'bdg_ultime' },
          { name: 'VIP (10,000 🐚)', value: 'vip' },
          { name: 'Super VIP (20,000 🐚)', value: 'super_vip' },
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
    .setDefaultMemberPermissions('0')
    .setDMPermission(false)
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
    .setDescription('Donner des coquillages à un autre joueur (max 500/jour)')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('À qui voulez-vous donner des coquillages ?')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('montant')
        .setDescription('Nombre de coquillages à donner')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500)),

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
    .setName('reset-morpion-stats')
    .setDescription('[ADMIN] Réinitialiser les statistiques du morpion')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur dont les statistiques doivent être réinitialisées (laissez vide pour tous)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('loutre-giveaway')
    .setDescription('Gérer les giveaways')
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('[ADMIN] Lancer un giveaway de 500 pour la première loutre qui clique')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('next')
        .setDescription('Voir quand est le prochain giveaway')
    )
    .setDefaultMemberPermissions('0')
    .setDMPermission(false),
    
  // Commande de maintenance
  new SlashCommandBuilder()
    .setName('mines')
    .setDescription('Jouer au jeu des mines 💣')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant à miser en coquillages')
        .setRequired(true)
        .setMinValue(10))
    .addIntegerOption(option =>
      option.setName('mines')
        .setDescription('Nombre de mines (1-15, 5 par défaut)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(15)),

  new SlashCommandBuilder()
    .setName('reset-dailybdg')
    .setDescription('[ADMIN] Réinitialiser la récompense BDG quotidienne d\'un utilisateur')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à réinitialiser')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('[ADMIN] Activer/désactiver le mode maintenance')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false)
];

// Admin command for lottery pot
const adminCommand = new SlashCommandBuilder()
  .setName('tas')
  .setDescription('[ADMIN] Gérer le pot commun de la loterie')
  .setDefaultMemberPermissions('0') // Admin only
  .setDMPermission(false)
  .addSubcommand(subcommand =>
    subcommand
      .setName('tirer')
      .setDescription('Tirer au sort le gagnant du pot commun')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('statut')
      .setDescription('Voir le montant actuel du pot commun')
  );

commands.push(adminCommand);

module.exports = commands.map(command => command.toJSON());
