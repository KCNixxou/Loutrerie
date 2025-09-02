const { activeBlackjackGames, activeCoinflipGames, resolveBlackjack, handleRouletteChoice } = require('./games');
const { calculateHandValue, formatHand } = require('./utils');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleButtonInteraction(interaction) {
  const userId = interaction.user.id;
  
  if (interaction.customId.startsWith('blackjack_')) {
    console.log(`[DEBUG] Blackjack interaction - User ID: ${userId}`);
    console.log(`[DEBUG] Active games:`, [...activeBlackjackGames.keys()]);
    
    const game = activeBlackjackGames.get(userId);
    if (!game) {
      console.log(`[DEBUG] No game found for user ${userId}`);
      await interaction.reply({ content: '❌ Aucune partie trouvée !', ephemeral: true });
      return;
    }
    
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
