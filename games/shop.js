const { EmbedBuilder } = require('discord.js');

// Gestion de la boutique

// Fonction pour gérer l'affichage de la boutique
async function handleShop(interaction) {
    try {
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
        const user = interaction.client.database.ensureUser(interaction.user.id, interaction.guild.id);
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

// Fonction pour gérer les achats de manière sécurisée
async function handlePurchase(interaction) {
    // Initialisation des variables
    let itemId, item, userId, member, user, role;
    const reply = { content: '', ephemeral: true };
    
    try {
        console.log(`[Achat] Début de la transaction pour ${interaction.user.tag}`);
        
        // Récupération des informations de base
        itemId = interaction.options.getString('item');
        userId = interaction.user.id;
        member = interaction.member;
        
        // Vérification de l'existence de l'article
        item = interaction.client.config.shop[itemId];
        if (!item) {
            reply.content = '❌ Cet article n\'existe pas dans la boutique.';
            console.log(`[Achat] Article non trouvé: ${itemId}`);
            return interaction.reply(reply);
        }
        
        console.log(`[Achat] Tentative d'achat de ${item.name} (${itemId}) par ${interaction.user.tag}`);
        
        // Vérification du solde utilisateur
        user = interaction.client.database.ensureUser(userId, interaction.guild.id);
        if (user.balance < item.price) {
            const manquant = item.price - user.balance;
            reply.content = `❌ Tu n'as pas assez de coquillages pour acheter ${item.name}. Il te manque ${manquant} ${interaction.client.config.currency.emoji}.`;
            console.log(`[Achat] Solde insuffisant: ${user.balance}/${item.price}`);
            return interaction.reply(reply);
        }
        
        // Vérification des rôles existants
        const roleType = itemId.startsWith('bdg') ? 'BDG' : itemId.startsWith('bdh') ? 'BDH' : null;
        if (roleType) {
            const existingRole = member.roles.cache.find(role => role.name.includes(roleType));
            if (existingRole) {
                reply.content = `❌ Tu as déjà un rôle ${roleType}. Tu ne peux en avoir qu'un seul à la fois.`;
                console.log(`[Achat] Rôle ${roleType} déjà possédé`);
                return interaction.reply(reply);
            }
        }
        
        // Vérification/création du rôle
        role = interaction.guild.roles.cache.find(r => r.name === item.role);
        
        if (!role) {
            try {
                const color = itemId.startsWith('bdg') ? '#e74c3c' : 
                            itemId.startsWith('bdh') ? '#2ecc71' : '#3498db';
                
                console.log(`[Achat] Création du rôle: ${item.role}`);
                role = await interaction.guild.roles.create({
                    name: item.role,
                    color: color,
                    reason: `Création automatique pour l'achat de ${item.name}`,
                    permissions: []
                });
                console.log(`[Achat] Rôle créé: ${role.id}`);
            } catch (error) {
                console.error('[Achat] Erreur création rôle:', error);
                reply.content = '❌ Impossible de créer le rôle. Vérifiez les permissions du bot.';
                return interaction.reply(reply);
            }
        }
        
        // Vérification finale avant transaction
        if (!role) {
            reply.content = '❌ Impossible de trouver ou créer le rôle associé.';
            console.error('[Achat] Échec de la création du rôle');
            return interaction.reply(reply);
        }
        
        // Début de la transaction
        try {
            // 1. Mise à jour du solde utilisateur
            console.log(`[Achat] Mise à jour du solde: ${user.balance} -> ${user.balance - item.price}`);
            const updateResult = interaction.client.database.updateUser(userId, {
                balance: user.balance - item.price
            });
            
            if (!updateResult) {
                throw new Error('Échec de la mise à jour du solde');
            }
            
            // 2. Ajout du rôle
            console.log(`[Achat] Ajout du rôle ${role.id} à l'utilisateur`);
            await member.roles.add(role);
            
            // 3. Confirmation de l'achat
            reply.content = `✅ Félicitations ! Tu as acheté **${item.name}** pour ${item.price} ${interaction.client.config.currency.emoji} !`;
            console.log(`[Achat] Achat réussi pour ${interaction.user.tag}`);
            
        } catch (transactionError) {
            console.error('[Achat] Erreur transaction:', transactionError);
            
            // Tentative de remboursement en cas d'échec après le débit
            if (updateResult) {
                console.log('[Achat] Tentative de remboursement...');
                try {
                    interaction.client.database.updateUser(userId, {
                        balance: user.balance // Remboursement complet
                    });
                    console.log('[Achat] Remboursement effectué');
                } catch (refundError) {
                    console.error('[Achat] Échec du remboursement:', refundError);
                    // Log l'erreur pour suivi manuel si nécessaire
                }
            }
            
            reply.content = '❌ Une erreur est survenue lors de la transaction. Votre solde n\'a pas été débité.';
            return interaction.reply(reply);
        }
        
        // Si tout s'est bien passé, on envoie la réponse
        await interaction.reply(reply);
        
    } catch (error) {
        console.error('[Achat] Erreur inattendue:', error);
        if (!interaction.replied) {
            reply.content = '❌ Une erreur inattendue est survenue. Veuillez contacter un administrateur.';
            await interaction.reply(reply);
        }
    }
}

// Exporter les fonctions
module.exports = {
    handleShop,
    handlePurchase
};
