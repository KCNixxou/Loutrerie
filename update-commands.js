require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;

if (!token) {
  console.error('Erreur: Le token Discord n\'est pas défini dans les variables d\'environnement.');
  process.exit(1);
}

if (!clientId) {
  console.error('Erreur: L\'ID du client n\'est pas défini dans les variables d\'environnement.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function updateCommands() {
  try {
    console.log('Début de la mise à jour des commandes...');
    
    // Les commandes sont déjà au format JSON dans ./commands
    const commandsJson = commands;
    
    console.log('Commandes à enregistrer:', commandsJson.map(cmd => cmd.name).join(', '));
    
    // Mettre à jour les commandes globales
    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commandsJson },
    );

    console.log(`✅ ${data.length} commandes (/) ont été enregistrées avec succès.`);
    console.log('Liste des commandes enregistrées:');
    data.forEach(cmd => console.log(`- ${cmd.name}: ${cmd.description}`));
    
  } catch (error) {
    console.error('Erreur lors de la mise à jour des commandes:', error);
  }
}

updateCommands();
