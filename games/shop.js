const { EmbedBuilder } = require('discord.js');
const { ensureUser, updateUser, getUserEffects, addUserEffect } = require('../database');
const { handleItemPurchase, handleBoxOpening, handleBoostActivation } = require('../utils/missionUtils');

// Gestion de la boutique et des effets temporaires

// Fonction pour gérer l'affichage de la boutique
async function handleShop(interaction) {
    try {
        const config = interaction.client.getConfig(interaction.guildId);
        const shopItems = config.shop;
        
        // Créer un embed pour la boutique avec style thématique
        const embed = new EmbedBuilder()
            .setTitle('🏥 **BOUTIQUE DE LA LOUTRERIE** 🏥')
            .setDescription('Bienvenue dans notre boutique médicale... Utilisez `/achat` avec le nom de l\'article pour effectuer un achat.')
            .setColor(0x8B0000) // Rouge sang
            .setThumbnail('https://emoji.discord.stickers/🏥.png');
        
        // Catégorie CONSOMMABLES
        const consumableItems = Object.entries(shopItems)
            .filter(([key, item]) => item.type === 'consumable')
            .map(([key, item]) => {
                const emoji = item.emoji || '💊';
                return `${emoji} **${item.name}** - ${item.price.toLocaleString()} ${config.currency.emoji}\n   *${item.description}*`;
            })
            .join('\n\n');
        
        // Catégorie SPÉCIAL
        const specialItems = Object.entries(shopItems)
            .filter(([key, item]) => ['mystery_box', 'event_access', 'vip_temporary'].includes(item.type))
            .map(([key, item]) => {
                const emoji = item.emoji || '🎁';
                return `${emoji} **${item.name}** - ${item.price.toLocaleString()} ${config.currency.emoji}\n   *${item.description}*`;
            })
            .join('\n\n');
        
        // Ajouter les champs à l'embed
        if (consumableItems) {
            embed.addFields({
                name: '💊 CONSOMMABLES',
                value: consumableItems,
                inline: false
            });
        }
        
        if (specialItems) {
            embed.addFields({
                name: '🎁 ARTICLES SPÉCIAUX',
                value: specialItems,
                inline: false
            });
        }
        
        // Catégorie des rôles BDG (existants)
        const bdgItems = Object.entries(shopItems)
            .filter(([key]) => key.startsWith('bdg'))
            .map(([_, item]) => `• **${item.name}** - ${item.price.toLocaleString()} ${config.currency.emoji}`)
            .join('\n');
        
        // Catégorie des rôles BDH (existants)
        const bdhItems = Object.entries(shopItems)
            .filter(([key]) => key.startsWith('bdh'))
            .map(([_, item]) => `• **${item.name}** - ${item.price.toLocaleString()} ${config.currency.emoji}`)
            .join('\n');
        
        if (bdgItems) {
            embed.addFields({
                name: '🏆 Rôles BDG',
                value: bdgItems,
                inline: false
            });
        }
        
        if (bdhItems) {
            embed.addFields({
                name: '🏆 Rôles BDH',
                value: bdhItems,
                inline: false
            });
        }
        
        // Ajouter le solde de l'utilisateur
        const user = interaction.client.database.ensureUser(interaction.user.id, interaction.guildId);
        const userEffects = getUserEffects(interaction.user.id, interaction.guildId);
        const activeEffects = userEffects.filter(effect => effect.expires_at > Date.now());
        
        let footerText = `Solde: ${user.balance || 0} ${config.currency.emoji}`;
        if (activeEffects.length > 0) {
            footerText += ` | ${activeEffects.length} effet(s) actif(s)`;
        }
        
        embed.setFooter({ 
            text: footerText,
            iconURL: interaction.user.displayAvatarURL()
        });
        
        await interaction.reply({
            embeds: [embed]
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'affichage de la boutique:', error);
        await interaction.reply({
            content: '❌ Une erreur est survenue lors de l\'affichage de la boutique. Veuillez réessayer plus tard.'
        });
    }
}

// Fonction pour appliquer les effets des consommables
function applyConsumableEffect(item, userId, guildId, interaction) {
    const now = Date.now();
    
    console.log(`[SHOP] applyConsumableEffect - userId: ${userId}, guildId: ${guildId}, item: ${JSON.stringify(item)}`);
    
    switch (item.effect) {
        case 'casino_bonus':
            addUserEffect(userId, {
                guildId,
                effect: 'casino_bonus',
                value: item.value,
                expires_at: now + item.duration,
                description: `+${(item.value * 100)}% de gains au casino`
            });
            console.log(`[SHOP] Sérum de Chance ajouté pour ${userId} sur guild ${guildId}`);
            return `✅ **${item.name}** activé ! Vos gains au casino sont augmentés de 15% pendant 24h.`;
            
        case 'loss_protection':
            addUserEffect(userId, {
                guildId,
                effect: 'loss_protection',
                uses: item.uses,
                description: 'Protection contre une perte importante'
            });
            return `✅ **${item.name}** équipé ! Votre prochaine perte importante sera annulée.`;
            
        case 'double_or_nothing':
            addUserEffect(userId, {
                guildId,
                effect: 'double_or_nothing',
                uses: item.uses,
                description: 'Double ou crève activé'
            });
            return `✅ **${item.name}** équipé ! Utilisez-le lors de votre prochain jeu pour doubler vos gains... ou tout perdre.`;
            
        case 'double_winnings':
            addUserEffect(userId, {
                guildId,
                effect: 'double_winnings',
                value: item.value,
                uses: item.uses,
                description: `Gains x${item.value} pour les ${item.uses} prochaines parties`
            });
            return `✅ **${item.name}** activé ! Vos gains sont multipliés par 2 pour les ${item.uses} prochaines parties.`;
            
        default:
            console.log(`[SHOP] Effet non géré: ${item.effect} pour l'item ${item.name}`);
            return `✅ **${item.name}** acheté !`;
    }
}

// Fonction pour ouvrir une boîte mystère
function openMysteryBox(userId, item, interaction) {
    console.log(`[MysteryBox] Ouverture de boîte - userId: ${userId}, item: ${JSON.stringify(item)}`);
    
    const config = interaction.client.getConfig(interaction.guildId);
    console.log(`[MysteryBox] Config obtenue:`, !!config);
    
    if (!config) {
        console.error('[MysteryBox] Config est undefined!');
        return '❌ Erreur de configuration';
    }
    
    const rewards = item.rewards;
    console.log(`[MysteryBox] Récompenses disponibles:`, rewards?.length || 0);
    
    if (!rewards || rewards.length === 0) {
        console.error('[MysteryBox] Aucune récompense définie!');
        return '❌ Aucune récompense disponible';
    }
    
    const randomReward = rewards[Math.floor(Math.random() * rewards.length)];
    console.log(`[MysteryBox] Récompense choisie:`, randomReward);
    
    let rewardText = '';
    
    if (typeof randomReward === 'number') {
        // Récompense en argent
        console.log(`[MysteryBox] Récompense en argent: ${randomReward}`);
        const user = ensureUser(userId, interaction.guildId);
        updateUser(userId, interaction.guildId, { balance: user.balance + randomReward });
        rewardText = `Vous avez gagné **${randomReward}** ${config.currency.emoji} !`;
    } else {
        // Récompense en item
        console.log(`[MysteryBox] Récompense en item: ${randomReward}`);
        const rewardItem = config.shop[randomReward];
        console.log(`[MysteryBox] Item trouvé dans shop:`, !!rewardItem);
        
        if (rewardItem) {
            applyConsumableEffect(rewardItem, userId, interaction.guildId, interaction);
            rewardText = `Vous avez gagné **${rewardItem.name}** !`;
        } else {
            rewardText = `Item non trouvé: ${randomReward}`;
        }
    }
    
    const finalMessage = `🎁 Vous avez ouvert une ${item.name} et obtenu : ${rewardText}`;
    console.log(`[MysteryBox] Message final: ${finalMessage}`);
    
    // Retourner un objet structuré pour un meilleur affichage
    return {
        message: finalMessage,
        rewardText: rewardText,
        rewardType: typeof randomReward === 'number' ? 'money' : 'item',
        rewardValue: randomReward
    };
}

// Fonction pour gérer les achats de manière sécurisée
async function handlePurchase(interaction) {
    // Initialisation des variables
    let itemId, item, userId, member, user, role;
    const reply = { content: '' }; // Supprimé ephemeral: true
    
    try {
        console.log(`[Achat] Début de la transaction pour ${interaction.user.tag}`);
        
        // Récupération de la configuration
        const config = interaction.client.getConfig(interaction.guildId);
        
        // Récupération des informations de base
        itemId = interaction.options.getString('item');
        userId = interaction.user.id;
        member = interaction.member;
        
        // Vérification de l'existence de l'article
        item = config.shop[itemId];
        if (!item) {
            reply.content = '❌ Cet article n\'existe pas dans la boutique.';
            console.log(`[Achat] Article non trouvé: ${itemId}`);
            return interaction.reply(reply);
        }
        
        console.log(`[Achat] Tentative d'achat de ${item.name} (${itemId}) par ${interaction.user.tag}`);
        
        // Vérification du solde utilisateur
        user = interaction.client.database.ensureUser(userId, interaction.guildId);
        if (user.balance < item.price) {
            const manquant = item.price - user.balance;
            reply.content = `❌ ${interaction.user.username} n'a pas assez de coquillages pour acheter ${item.name}. Il manque ${manquant} ${config.currency.emoji}.`;
            console.log(`[Achat] Solde insuffisant: ${user.balance}/${item.price}`);
            return interaction.reply(reply);
        }
        
        // Gérer les différents types d'items
        if (item.type === 'consumable') {
            // Consommable - appliquer l'effet directement
            const updateResult = updateUser(userId, interaction.guildId, {
                balance: user.balance - item.price
            });
            
            // Appliquer l'effet de l'objet consommable
            const result = await applyConsumableEffect(item, userId, interaction.guildId, interaction);
            reply.content = result;
            
            // Mettre à jour les missions pour l'achat d'objet
            handleItemPurchase(userId, interaction.guildId);
            
            // Si c'est un boost, mettre à jour les missions de boost
            if (item.effect) {
                handleBoostActivation(userId, interaction.guildId);
            }
            
            console.log(`[Achat] Consommable ${item.name} utilisé par ${interaction.user.tag}`);
            return interaction.reply(reply);
        } else if (item.type === 'mystery_box') {
            // Boîte mystère - ouvrir immédiatement
            console.log(`[Achat] Traitement boîte mystère - Solde avant: ${user.balance}, Prix: ${item.price}`);
            
            const updateResult = updateUser(userId, interaction.guildId, {
                balance: user.balance - item.price
            });
            
            console.log(`[Achat] Résultat mise à jour solde:`, updateResult);
            
            if (updateResult) {
                // Ouvrir la boîte mystère
                console.log(`[Achat] Ouverture de la boîte mystère...`);
                const rewardResult = openMysteryBox(userId, item, interaction);
                console.log(`[Achat] Récompense obtenue:`, rewardResult);
                
                // Créer un embed magnifique pour l'ouverture de la boîte
                const boxEmbed = new EmbedBuilder()
                    .setTitle('🎁 **OUVERTURE DE BOÎTE À ORGANES** 🎁')
                    .setDescription(`**Félicitations ${interaction.user.username} !**\n\nVous avez ouvert une **${item.name}** et obtenu :`)
                    .setColor(0xFFD700) // Or pour la victoire
                    .setThumbnail('https://emoji.discord.stickers/🎁.png');
                
                // Personnaliser l'affichage selon le type de récompense
                if (rewardResult.rewardType === 'money') {
                    boxEmbed.addFields(
                        { 
                            name: '💰 **GAINS EN COQUILLAGES**', 
                            value: `**${rewardResult.rewardValue.toLocaleString()}** ${config.currency.emoji}`, 
                            inline: false 
                        }
                    );
                    boxEmbed.setColor(0x00FF00); // Vert pour l'argent
                } else if (rewardResult.rewardType === 'item') {
                    boxEmbed.addFields(
                        { 
                            name: '🎁 **ITEM SPÉCIAL**', 
                            value: rewardResult.rewardText, 
                            inline: false 
                        }
                    );
                    boxEmbed.setColor(0xFF69B4); // Rose pour les items
                } else {
                    boxEmbed.addFields(
                        { 
                            name: '🏆 **RÉCOMPENSE**', 
                            value: rewardResult.rewardText, 
                            inline: false 
                        }
                    );
                }
                
                boxEmbed.setFooter({ 
                    text: `Solde mis à jour • ${new Date().toLocaleString('fr-FR')}`,
                    iconURL: interaction.user.displayAvatarURL()
                });
                
                reply.embeds = [boxEmbed];
                reply.content = ''; // Pas de texte supplémentaire
                
                // Mettre à jour les missions pour l'ouverture de boîte
                handleBoxOpening(userId, interaction.guildId);
            } else {
                console.error(`[Achat] Erreur lors de la mise à jour du solde`);
                reply.content = '❌ Erreur lors de la transaction.';
            }
            
            console.log(`[Achat] Boîte mystère ${item.name} traitée pour ${interaction.user.tag}`);
            
            // Envoyer la réponse et arrêter le traitement ici
            return interaction.reply(reply);
        } else if (item.type === 'gift') {
            // Article cadeau - déduire le montant et informer l'utilisateur
            const updateResult = updateUser(userId, interaction.guildId, {
                balance: user.balance - item.price
            });
            
            if (updateResult) {
                // Envoyer un message à l'utilisateur
                try {
                    await interaction.user.send(`🎁 Merci pour votre achat de **${item.name}** ! Un administrateur vous contactera bientôt avec votre code.`);
                    reply.content = `✅ **${item.name}** acheté avec succès ! Vérifiez vos messages privés pour plus d'informations.`;
                    
                    // Envoyer une notification aux administrateurs
                    const adminMention = interaction.guild.roles.cache.get('ADMIN_ROLE_ID')?.toString() || '@administrateur';
                    const adminChannel = interaction.guild.channels.cache.find(c => c.name === 'admin' || c.name === 'logs');
                    if (adminChannel) {
                        await adminChannel.send(`🔔 **Nouvel achat de code**
> **Utilisateur:** ${interaction.user.tag} (${interaction.user.id})
> **Article:** ${item.name}
> **Prix:** ${item.price} ${config.currency.emoji}
${adminMention}`);
                    }
                    
                    console.log(`[Achat] Article cadeau ${item.name} acheté par ${interaction.user.tag}`);
                } catch (error) {
                    console.error(`[Achat] Erreur lors de l'envoi du message à l'utilisateur:`, error);
                    reply.content = `✅ **${item.name}** acheté avec succès ! Un administrateur vous contactera bientôt avec votre code.`;
                }
            } else {
                reply.content = '❌ Erreur lors de la transaction.';
            }
            
            // Gérer les articles cadeaux (cadeauSurprise1 et cadeauSurprise2)
            handleItemPurchase(userId, interaction.guildId);
            return interaction.reply(reply);
        } else if (item.type === 'event_access' || item.type === 'vip_temporary') {
            const updateResult = updateUser(userId, interaction.guildId, {
                balance: user.balance - item.price
            });
            if (!updateResult) {
                reply.content = '❌ Erreur lors de la transaction.';
                return interaction.reply(reply);
            }

            const effectData = {
                guildId: interaction.guildId,
                effect: item.effect,
                description: item.description || item.name
            };

            if (item.duration) {
                effectData.expires_at = Date.now() + item.duration;
            }

            addUserEffect(userId, effectData);
            reply.content = `✅ **${item.name}** activé !`;
            return interaction.reply(reply);
            
        } else if (item.type === 'boost') {
            // Item de boost - information pour le moment
            reply.content = `ℹ️ **${item.name}** - ${item.description}\n\nCet article donne accès à des avantages permanents. Contactez un administrateur pour l'activer.`;
            return interaction.reply(reply);
        }
        
        // Si on arrive ici, c'est que l'item n'est pas d'un type géré ci-dessus
        // On continue avec le traitement des rôles (pour la compatibilité avec l'ancien système)
        console.log(`[Achat] Type d'article non géré: ${item.type}, traitement par défaut pour les rôles`);
        
        // Pour les rôles BDG/BDH (gestion existante)
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
        if (!interaction.guild) {
            reply.content = '❌ Erreur: Impossible d\'accéder aux informations du serveur.';
            return interaction.reply(reply);
        }
        
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
        
        // Début de la transaction pour les rôles
        try {
            // 1. Mise à jour du solde utilisateur
            console.log(`[Achat] Mise à jour du solde: ${user.balance} -> ${user.balance - item.price}`);
            const updateResult = updateUser(userId, interaction.guildId, {
                balance: user.balance - item.price
            });
            
            if (!updateResult) {
                throw new Error('Échec de la mise à jour du solde');
            }
            
            // 2. Ajout du rôle
            console.log(`[Achat] Ajout du rôle ${role.id} à l'utilisateur`);
            await member.roles.add(role);
            
            // 3. Confirmation de l'achat
            reply.content = `✅ Félicitations ! Tu as acheté **${item.name}** pour ${item.price} ${config.currency.emoji} !`;
            console.log(`[Achat] Achat réussi pour ${interaction.user.tag}`);
            
        } catch (transactionError) {
            console.error('[Achat] Erreur transaction:', transactionError);
            
            // Tentative de remboursement en cas d'échec après le débit
            if (updateResult) {
                console.log('[Achat] Tentative de remboursement...');
                try {
                    updateUser(userId, interaction.guildId, {
                        balance: user.balance // Remboursement complet
                    });
                    console.log('[Achat] Remboursement effectué');
                } catch (refundError) {
                    console.error('[Achat] Échec du remboursement:', refundError);
                }
            }
            
            reply.content = '❌ Une erreur est survenue lors de la transaction. Le solde de l\'utilisateur n\'a pas été débité.';
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
