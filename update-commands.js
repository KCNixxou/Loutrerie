require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

// Script autonome pour (re)déployer les commandes slash sur les serveurs
// À lancer manuellement: node update-commands.js

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID; // à définir dans le .env (ID de l'application/bot)

// Liste des serveurs sur lesquels déployer les commandes
// Adapter cette liste si nécessaire
const guildIds = [
  '1378262130515513404', // 🦦• 𝓛𝒂 𝓛𝒐𝒖𝒕𝒓𝒆𝒓𝒊𝒆
  '1429516623651541210'  // ⧉┊ Asile019 ☠┊↦
];

if (!token || !clientId) {
  console.error('DISCORD_TOKEN ou DISCORD_CLIENT_ID manquant dans le fichier .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('⏳ Enregistrement des commandes (script update-commands)...');
    console.log('Commandes à enregistrer:', commands.map(c => c.name).join(', '));

    for (const guildId of guildIds) {
      console.log(`📌 Enregistrement sur le serveur: ${guildId}`);
      try {
        await rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body: commands }
        );
        console.log(`✅ Commandes enregistrées sur ${guildId}`);
      } catch (error) {
        console.error(`❌ Erreur lors de l'enregistrement des commandes sur ${guildId}:`, error);
      }
    }

    console.log('✅ Déploiement des commandes terminé.');
  } catch (error) {
    console.error('❌ Erreur critique lors du déploiement des commandes:', error);
  }
})();
