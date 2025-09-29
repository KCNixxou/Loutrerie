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
    try {
        const itemId = interaction.options.getString('item');
        const userId = interaction.user.id;
        const member = interaction.member;
        const user = interaction.client.database.ensureUser(userId);
        
        // Vérifier si l'item existe dans la configuration
        const item = interaction.client.config.shop[itemId];
        if (!item) {
            return interaction.reply({
                content: '❌ Cet article n\'existe pas dans la boutique.',
                ephemeral: true
            });
        }
        
        // Vérifier si l'utilisateur a assez d'argent
        if (user.balance < item.price) {
            return interaction.reply({
                content: `❌ Tu n'as pas assez de coquillages pour acheter ${item.name}. Il te manque ${item.price - user.balance} ${interaction.client.config.currency.emoji}.`,
                ephemeral: true
            });
        }
        
        // Vérifier si l'utilisateur a déjà un rôle du même type (BDG ou BDH)
        const roleType = itemId.startsWith('bdg') ? 'BDG' : itemId.startsWith('bdh') ? 'BDH' : null;
        if (roleType) {
            const existingRole = member.roles.cache.find(role => 
                role.name.includes(roleType)
            );
            
            if (existingRole) {
                return interaction.reply({
                    content: `❌ Tu as déjà un rôle ${roleType}. Tu ne peux en avoir qu'un seul à la fois.`,
                    ephemeral: true
                });
            }
        }
        
        // Trouver le rôle correspondant
        const role = interaction.guild.roles.cache.find(r => r.name === item.role);
        if (!role) {
            return interaction.reply({
                content: '❌ Le rôle associé à cet article n\'a pas été trouvé. Contactez un administrateur.',
                ephemeral: true
            });
        }
        
        // Retirer l'argent de l'utilisateur
        interaction.client.database.updateUser(userId, {
            balance: user.balance - item.price
        });
        
        // Ajouter le rôle à l'utilisateur
        await member.roles.add(role);
        
        // Répondre avec succès
        await interaction.reply({
            content: `✅ Félicitations ! Tu as acheté **${item.name}** pour ${item.price} ${interaction.client.config.currency.emoji} !`,
            ephemeral: true
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'achat:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: '❌ Une erreur est survenue lors de l\'achat. Veuillez réessayer plus tard.',
                ephemeral: true
            });
        }
    }
}

// Exporter les fonctions
module.exports = {
    handleShop,
    handlePurchase
};
