// Gestion de la boutique

// Fonction pour gérer l'affichage de la boutique
async function handleShop(interaction) {
    try {
        const { EmbedBuilder } = require('discord.js');
        const shopItems = interaction.client.config.shop;
        
        // Log pour déboguer
        console.log('Articles disponibles dans la boutique:', Object.keys(shopItems));
        
        // Créer un embed pour la boutique
        const embed = new EmbedBuilder()
            .setTitle('🛍️ Boutique de la Loutrerie')
            .setDescription('Utilisez la commande `/acheter` avec le nom de l\'article pour effectuer un achat.')
            .setColor(0x00bfff);
        
        // Catégorie des rôles BDG
        const bdgItems = Object.entries(shopItems)
            .filter(([key]) => key.startsWith('bdg'))
            .map(([_, item]) => `• **${item.name}** - ${item.price.toLocaleString()} ${interaction.client.config.currency.emoji}`)
            .join('\n');
        
        // Catégorie des rôles BDH
        const bdhItems = Object.entries(shopItems)
            .filter(([key]) => key.startsWith('bdh'))
            .map(([key, item]) => {
                console.log(`Article BDH trouvé: ${key} - ${item.name}`);
                return `• **${item.name}** - ${item.price.toLocaleString()} ${interaction.client.config.currency.emoji}`;
            })
            .join('\n');
            
        console.log('Articles BDH formatés:', bdhItems);
        
        // Autres articles
        const otherItems = Object.entries(shopItems)
            .filter(([key]) => !key.startsWith('bdg') && !key.startsWith('bdh'))
            .map(([_, item]) => `• **${item.name}** - ${item.price.toLocaleString()} ${interaction.client.config.currency.emoji}`)
            .join('\n');
        
        // Ajouter les champs à l'embed
        if (bdgItems) {
            embed.addFields({
                name: '🏆 Rôles BDG',
                value: bdgItems,
                inline: false
            });
        }
        
        if (bdhItems && bdhItems.length > 0) {
            console.log('Ajout des rôles BDH à l\'embed');
            embed.addFields({
                name: '🏆 Rôles BDH',
                value: bdhItems,
                inline: false
            });
        } else {
            console.log('Aucun rôle BDH à afficher');
        }
        
        if (otherItems) {
            embed.addFields({
                name: '🎁 Autres articles',
                value: otherItems,
                inline: false
            });
        }
        
        // Ajouter le solde de l'utilisateur
        const user = interaction.client.database.ensureUser(interaction.user.id);
        embed.setFooter({ 
            text: `Votre solde: ${user.balance || 0} ${interaction.client.config.currency.emoji}`,
            iconURL: interaction.user.displayAvatarURL()
        });
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'affichage de la boutique:', error);
        await interaction.reply({
            content: '❌ Une erreur est survenue lors de l\'affichage de la boutique. Veuillez réessayer plus tard.',
            ephemeral: true
        });
    }
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
