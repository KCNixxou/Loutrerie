// Jeu de pile ou face

// Variables pour stocker les parties en cours
const activeCoinflipGames = new Map();

// Fonction pour gérer le jeu de pile ou face solo
async function handleCoinflipSolo(interaction) {
    await interaction.reply({
        content: 'Le jeu de pile ou face solo n\'est pas encore implémenté.',
        ephemeral: true
    });
}

// Fonction pour gérer le jeu de pile ou face multijoueur
async function handleCoinflipMulti(interaction) {
    await interaction.reply({
        content: 'Le jeu de pile ou face multijoueur n\'est pas encore implémenté.',
        ephemeral: true
    });
}

// Exporter les fonctions
module.exports = {
    activeCoinflipGames,
    handleCoinflipSolo,
    handleCoinflipMulti
};
