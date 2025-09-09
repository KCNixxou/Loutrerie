const { 
  activeBlackjackGames, 
  activeCoinflipGames, 
  resolveBlackjack, 
  handleRouletteChoice,
  handleHighLowAction,
  handleHighLowDecision
} = require('./games');
const { calculateHandValue, formatHand } = require('./utils');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleButtonInteraction(interaction) {
  const userId = interaction.user.id;
  
  // Gestion du High Low
  if (interaction.customId.startsWith('highlow_lower_') || 
      interaction.customId.startsWith('highlow_same_') || 
      interaction.customId.startsWith('highlow_higher_')) {
    return handleHighLowAction(interaction);
  }
  
  // Gestion de la décision de continuer/arrêter
  if (interaction.customId.startsWith('highlow_stop_') || 
      interaction.customId.startsWith('highlow_continue_')) {
    return handleHighLowDecision(interaction);
  }
  
  // Gestion de la clôture par un administrateur
  if (interaction.customId.startsWith('admin_close_')) {
    const gameId = interaction.customId.replace('admin_close_', '');
    const { endHighLowGame } = require('./games');
    
    // Vérifier si l'utilisateur est un administrateur
    if (interaction.user.id !== '314458846754111499') { // Remplacez par l'ID de l'admin
      return interaction.reply({
        content: '❌ Vous n\'avez pas la permission de clôturer cette partie.',
        ephemeral: true
      });
    }
    
    // Clôturer la partie
    return endHighLowGame(gameId, interaction, true);
  }
  
  if (interaction.customId.startsWith('blackjack_')) {
    // Vérifier si l'interaction a déjà été traitée
    if (interaction.replied || interaction.deferred) {
      return;
    }
    
    console.log(`[DEBUG] Blackjack interaction - User ID: ${userId}`);
    console.log(`[DEBUG] Active games:`, [...activeBlackjackGames.keys()]);
    
    const game = activeBlackjackGames.get(userId);
    if (!game) {
      console.log(`[DEBUG] No game found for user ${userId}`);
      await interaction.reply({ content: '❌ Aucune partie trouvée !', ephemeral: true }).catch(console.error);
      return;
    }
    
    // Vérifier que la partie appartient bien à l'utilisateur
    if (game.userId !== userId) {
      console.log(`[DEBUG] Game user ID (${game.userId}) doesn't match interaction user ID (${userId})`);
      await interaction.reply({ content: '❌ Cette partie ne vous appartient pas !', ephemeral: true }).catch(console.error);
      return;
    }
    
    try {
      if (interaction.customId === 'blackjack_hit') {
        game.playerHand.push(game.deck.pop());
        const playerValue = calculateHandValue(game.playerHand);
        
        if (playerValue > 21) {
          // Bust
          activeBlackjackGames.delete(userId);
          const embed = new EmbedBuilder()
            .setTitle('🃏 Blackjack - Résultat')
            .addFields(
              { name: 'Ta main', value: `${formatHand(game.playerHand)}\nValeur: **${playerValue}**`, inline: true },
              { name: 'Résultat', value: '💥 **BUST !** Tu as perdu ta mise.', inline: false }
            )
            .setColor(0xff0000);
          
          await interaction.update({ embeds: [embed], components: [] });
        } else {
          // Continuer
          const embed = new EmbedBuilder()
            .setTitle('🃏 Blackjack')
            .addFields(
              { name: 'Ta main', value: `${formatHand(game.playerHand)}\nValeur: **${playerValue}**`, inline: true },
              { name: 'Croupier', value: `${game.dealerHand[0].display} ❓\nValeur: **?**`, inline: true },
              { name: 'Mise', value: `${game.bet} 🐚`, inline: true }
            )
            .setColor(0x0099ff);
          
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder().setCustomId('blackjack_hit').setLabel('Hit 🃏').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('blackjack_stay').setLabel('Stay ✋').setStyle(ButtonStyle.Secondary)
            );
          
          await interaction.update({ embeds: [embed], components: [row] });
        }
      } else if (interaction.customId === 'blackjack_stay') {
        await resolveBlackjack(interaction, game);
      }
    } catch (error) {
      console.error('Error in blackjack interaction:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ Une erreur est survenue lors du traitement de votre action. Veuillez réessayer.', 
          ephemeral: true 
        }).catch(console.error);
      }
    }
  } else if (interaction.customId.startsWith('roulette_')) {
    await handleRouletteChoice(interaction);
  } else if (interaction.customId.startsWith('coinflip_join_')) {
    const gameId = interaction.customId.replace('coinflip_join_', '');
    const game = activeCoinflipGames.get(gameId);
    
    if (!game || game.status !== 'waiting') {
      await interaction.reply({ content: '❌ Cette partie n\'est plus disponible !', ephemeral: true });
      return;
    }
    
    if (game.creatorId === userId) {
      await interaction.reply({ content: '❌ Tu ne peux pas rejoindre ta propre partie !', ephemeral: true });
      return;
    }
    
    // Rediriger vers la commande pile ou face multi
    await interaction.reply({ 
      content: `Pour rejoindre cette partie, utilise la commande \`/pileface-multi\` avec une mise de ${game.betAmount} 🐚 !`,
      ephemeral: true 
    });
  }
}

async function handleSelectMenuInteraction(interaction) {
  if (interaction.customId === 'roulette_number_select') {
    const [type, number, bet] = interaction.values[0].split('_');
    
    // Créer un customId temporaire pour la fonction de roulette
    interaction.customId = `roulette_${number}_${bet}`;
    await handleRouletteChoice(interaction);
  }
}

module.exports = {
  handleButtonInteraction,
  handleSelectMenuInteraction
};
