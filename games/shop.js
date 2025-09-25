// Gestion de la boutique

// Fonction pour gérer l'affichage de la boutique
async function handleShop(interaction) {
    await interaction.reply({
        content: 'La boutique n\'est pas encore disponible.',
        ephemeral: true
    });
}

// Fonction pour gérer les achats
async function handlePurchase(interaction) {
    await interaction.reply({
        content: 'La fonction d\'achat n\'est pas encore disponible.',
        ephemeral: true
    });
}

// Exporter les fonctions
module.exports = {
    handleShop,
    handlePurchase
};
