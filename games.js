const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');
const { ensureUser, updateUser, updateMissionProgress, db } = require('./database');
const { random, createDeck, calculateHandValue, formatHand, getRouletteColor, playSlots } = require('./utils');

// Variables globales pour les jeux
const activeBlackjackGames = new Map();
const activeCoinflipGames = new Map();

// BLACKJACK
async function handleBlackjackStart(interaction) {
  const bet = interaction.options.getInteger('mise');
  const user = ensureUser(interaction.user.id);
  
  if (bet > user.balance) {
    await interaction.reply({ content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  if (bet > config.casino.maxBet) {
    await interaction.reply({ content: `❌ Mise maximum: ${config.casino.maxBet} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  if (activeBlackjackGames.has(interaction.user.id)) {
    await interaction.reply({ content: '❌ Tu as déjà une partie en cours !', ephemeral: true });
    return;
  }
  
  // Déduire la mise
  updateUser(interaction.user.id, { balance: user.balance - bet });
  
  const deck = createDeck();
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop()];
  
  activeBlackjackGames.set(interaction.user.id, {
    deck, playerHand, dealerHand, bet, userId: interaction.user.id
  });
  
  const playerValue = calculateHandValue(playerHand);
  
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack')
    .addFields(
      { name: 'Ta main', value: `${formatHand(playerHand)}\nValeur: **${playerValue}**`, inline: true },
      { name: 'Croupier', value: `${dealerHand[0].display} ❓\nValeur: **?**`, inline: true },
      { name: 'Mise', value: `${bet} ${config.currency.emoji}`, inline: true }
    )
    .setColor(0x0099ff);
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('blackjack_hit').setLabel('Hit 🃏').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('blackjack_stay').setLabel('Stay ✋').setStyle(ButtonStyle.Secondary)
    );
  
  await interaction.reply({ embeds: [embed], components: [row] });
}

async function resolveBlackjack(interaction, game) {
  const userId = interaction.user.id;
  const user = ensureUser(userId);
  
  // Croupier tire jusqu'à 17
  while (calculateHandValue(game.dealerHand) < 17 && game.deck.length > 0) {
    game.dealerHand.push(game.deck.pop());
  }
  
  const playerValue = calculateHandValue(game.playerHand);
  const dealerValue = calculateHandValue(game.dealerHand);
  
  let result = '';
  let winnings = 0;
  
  if (dealerValue > 21) {
    result = '🎉 **VICTOIRE !** Le croupier a fait bust !';
    winnings = game.bet * 2;
  } else if (playerValue > dealerValue) {
    result = '🎉 **VICTOIRE !** Ta main est meilleure !';
    winnings = game.bet * 2;
  } else if (playerValue === dealerValue) {
    result = '🤝 **ÉGALITÉ !** Tu récupères ta mise.';
    winnings = game.bet;
  } else {
    result = '😢 **DÉFAITE !** Le croupier gagne.';
    winnings = 0;
  }
  
  if (winnings > 0) {
    updateUser(userId, { balance: user.balance + winnings });
  }
  
  activeBlackjackGames.delete(userId);
  
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack - Résultat')
    .addFields(
      { name: 'Ta main', value: `${formatHand(game.playerHand)}\nValeur: **${playerValue}**`, inline: true },
      { name: 'Croupier', value: `${formatHand(game.dealerHand)}\nValeur: **${dealerValue}**`, inline: true },
      { name: 'Résultat', value: result, inline: false }
    )
    .setColor(winnings > 0 ? 0x00ff00 : 0xff0000);
  
  if (winnings > 0) {
    embed.addFields({ name: 'Gains', value: `+${winnings} ${config.currency.emoji}`, inline: true });
  }
  
  await interaction.update({ embeds: [embed], components: [] });
}

// ROULETTE
async function handleRouletteStart(interaction) {
  const bet = interaction.options.getInteger('mise');
  const user = ensureUser(interaction.user.id);
  
  if (bet > user.balance) {
    await interaction.reply({ content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  if (bet > config.casino.maxBet) {
    await interaction.reply({ content: `❌ Mise maximum: ${config.casino.maxBet} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎡 Roulette')
    .setDescription(`Mise: ${bet} ${config.currency.emoji}\n\nChoisis ton type de pari:`)
    .setColor(0xff6600);
  
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`roulette_even_${bet}`).setLabel('Pair (x2)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`roulette_odd_${bet}`).setLabel('Impair (x2)').setStyle(ButtonStyle.Secondary)
    );
  
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`roulette_red_${bet}`).setLabel('Rouge (x2)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`roulette_black_${bet}`).setLabel('Noir (x2)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`roulette_green_${bet}`).setLabel('Vert (x36)').setStyle(ButtonStyle.Success)
    );
  
  const selectOptions = [];
  for (let i = 0; i <= 36; i++) {
    selectOptions.push({ label: `Numéro ${i} (x36)`, value: `number_${i}_${bet}` });
  }
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('roulette_number_select')
    .setPlaceholder('Ou choisis un numéro spécifique (0-36)')
    .addOptions(selectOptions.slice(0, 25)); // Discord limite à 25 options
  
  const row3 = new ActionRowBuilder().addComponents(selectMenu);
  
  await interaction.reply({ embeds: [embed], components: [row1, row2, row3] });
}

async function handleRouletteChoice(interaction) {
  const [type, value, bet] = interaction.customId.split('_');
  const betAmount = parseInt(bet);
  const user = ensureUser(interaction.user.id);
  
  // Déduire la mise
  updateUser(interaction.user.id, { balance: user.balance - betAmount });
  
  const resultNumber = random(0, 36);
  const resultColor = getRouletteColor(resultNumber);
  
  let won = false;
  let multiplier = 0;
  
  if (value === 'even' && resultNumber !== 0 && resultNumber % 2 === 0) {
    won = true; multiplier = 2;
  } else if (value === 'odd' && resultNumber % 2 === 1) {
    won = true; multiplier = 2;
  } else if (value === 'red' && resultColor === 'rouge') {
    won = true; multiplier = 2;
  } else if (value === 'black' && resultColor === 'noir') {
    won = true; multiplier = 2;
  } else if (value === 'green' && resultColor === 'vert') {
    won = true; multiplier = 36;
  }
  
  const winnings = won ? betAmount * multiplier : 0;
  if (winnings > 0) {
    updateUser(interaction.user.id, { balance: user.balance + winnings });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎡 Roulette - Résultat')
    .addFields(
      { name: 'Résultat', value: `**${resultNumber}** (${resultColor})`, inline: true },
      { name: 'Ton pari', value: value.charAt(0).toUpperCase() + value.slice(1), inline: true },
      { name: won ? 'Gains' : 'Perte', value: won ? `+${winnings} ${config.currency.emoji}` : `-${betAmount} ${config.currency.emoji}`, inline: true }
    )
    .setColor(won ? 0x00ff00 : 0xff0000)
    .setDescription(won ? '🎉 **GAGNÉ !**' : '😢 **PERDU !**');
  
  await interaction.update({ embeds: [embed], components: [] });
}

// SLOTS
async function handleSlots(interaction) {
  const bet = interaction.options.getInteger('mise');
  const user = ensureUser(interaction.user.id);
  
  if (bet > user.balance) {
    await interaction.reply({ content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  if (bet > config.casino.maxBet) {
    await interaction.reply({ content: `❌ Mise maximum: ${config.casino.maxBet} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  // Déduire la mise
  updateUser(interaction.user.id, { balance: user.balance - bet });
  
  const { result, multiplier } = playSlots();
  const winnings = Math.floor(bet * multiplier);
  
  if (winnings > 0) {
    updateUser(interaction.user.id, { balance: user.balance + winnings });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎰 Machine à Sous')
    .addFields(
      { name: 'Résultat', value: result.join(' '), inline: false },
      { name: multiplier > 0 ? 'Gains' : 'Perte', value: multiplier > 0 ? `+${winnings} ${config.currency.emoji} (x${multiplier})` : `-${bet} ${config.currency.emoji}`, inline: true }
    )
    .setColor(multiplier > 0 ? 0x00ff00 : 0xff0000)
    .setDescription(multiplier > 0 ? '🎉 **GAGNÉ !**' : '😢 **PERDU !**');
  
  await interaction.reply({ embeds: [embed] });
}

// PILE OU FACE SOLO
async function handleCoinflipSolo(interaction) {
  const bet = interaction.options.getInteger('mise');
  const choice = interaction.options.getString('choix');
  const user = ensureUser(interaction.user.id);
  
  if (bet > user.balance) {
    await interaction.reply({ content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  if (bet > config.casino.maxBet) {
    await interaction.reply({ content: `❌ Mise maximum: ${config.casino.maxBet} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  // Déduire la mise
  updateUser(interaction.user.id, { balance: user.balance - bet });
  
  const result = random(0, 1) === 0 ? 'pile' : 'face';
  const won = choice === result;
  const winnings = won ? bet * 2 : 0;
  
  if (winnings > 0) {
    updateUser(interaction.user.id, { balance: user.balance + winnings });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🪙 Pile ou Face')
    .addFields(
      { name: 'Ton choix', value: choice.charAt(0).toUpperCase() + choice.slice(1), inline: true },
      { name: 'Résultat', value: result.charAt(0).toUpperCase() + result.slice(1), inline: true },
      { name: won ? 'Gains' : 'Perte', value: won ? `+${winnings} ${config.currency.emoji}` : `-${bet} ${config.currency.emoji}`, inline: true }
    )
    .setColor(won ? 0x00ff00 : 0xff0000)
    .setDescription(won ? '🎉 **GAGNÉ !**' : '😢 **PERDU !**');
  
  await interaction.reply({ embeds: [embed] });
}

// PILE OU FACE MULTIJOUEURS
async function handleCoinflipMulti(interaction) {
  const bet = interaction.options.getInteger('mise');
  const choice = interaction.options.getString('choix');
  const user = ensureUser(interaction.user.id);
  
  if (bet > user.balance) {
    await interaction.reply({ content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  if (bet > config.casino.maxBet) {
    await interaction.reply({ content: `❌ Mise maximum: ${config.casino.maxBet} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  // Chercher une partie existante avec la même mise
  const existingGame = Array.from(activeCoinflipGames.values()).find(game => 
    game.betAmount === bet && game.status === 'waiting' && game.creatorId !== interaction.user.id
  );
  
  if (existingGame) {
    // Rejoindre la partie existante
    updateUser(interaction.user.id, { balance: user.balance - bet });
    updateMissionProgress(interaction.user.id, 'coinflip_multi', 1);
    
    existingGame.opponentId = interaction.user.id;
    existingGame.opponentChoice = choice;
    existingGame.status = 'playing';
    
    const result = random(0, 1) === 0 ? 'pile' : 'face';
    const creatorWon = existingGame.creatorChoice === result;
    const opponentWon = choice === result;
    
    let winnerId = null;
    if (creatorWon && !opponentWon) winnerId = existingGame.creatorId;
    else if (opponentWon && !creatorWon) winnerId = interaction.user.id;
    
    if (winnerId) {
      const winnerUser = ensureUser(winnerId);
      updateUser(winnerId, { balance: winnerUser.balance + (bet * 2) });
    } else {
      // Égalité - remboursement
      const creatorUser = ensureUser(existingGame.creatorId);
      updateUser(existingGame.creatorId, { balance: creatorUser.balance + bet });
      updateUser(interaction.user.id, { balance: user.balance + bet });
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🪙 Pile ou Face Multijoueurs - Résultat')
      .addFields(
        { name: 'Créateur', value: `<@${existingGame.creatorId}> - ${existingGame.creatorChoice}`, inline: true },
        { name: 'Adversaire', value: `<@${interaction.user.id}> - ${choice}`, inline: true },
        { name: 'Résultat', value: result.charAt(0).toUpperCase() + result.slice(1), inline: true }
      )
      .setColor(winnerId ? 0x00ff00 : 0xffaa00);
    
    if (winnerId) {
      embed.setDescription(`🎉 **<@${winnerId}> gagne ${bet * 2} ${config.currency.emoji} !**`);
    } else {
      embed.setDescription(`🤝 **Égalité !** Chacun récupère sa mise.`);
    }
    
    activeCoinflipGames.delete(existingGame.gameId);
    await interaction.reply({ embeds: [embed] });
    
  } else {
    // Créer une nouvelle partie
    updateUser(interaction.user.id, { balance: user.balance - bet });
    
    const gameId = `${interaction.user.id}_${Date.now()}`;
    activeCoinflipGames.set(gameId, {
      gameId,
      creatorId: interaction.user.id,
      creatorChoice: choice,
      betAmount: bet,
      status: 'waiting',
      createdAt: Date.now()
    });
    
    const embed = new EmbedBuilder()
      .setTitle('🪙 Pile ou Face Multijoueurs')
      .setDescription(
        `<@${interaction.user.id}> a créé une partie !\n\n` +
        `**Mise:** ${bet} ${config.currency.emoji}\n` +
        `**Choix:** ${choice}\n\n` +
        `Pour rejoindre cette partie, utilisez la commande :\n` +
        `\`/pileface-multi mise:${bet} choix:${choice === 'pile' ? 'face' : 'pile'}\`\n\n` +
        `*La partie s'annulera automatiquement après 5 minutes si personne ne rejoint.*`
      )
      .setColor(0x0099ff)
      .setFooter({ text: 'Utilisez la commande /pileface-multi avec les mêmes paramètres pour rejoindre' });
    
    await interaction.reply({ embeds: [embed] });
    
    // Supprimer la partie après 5 minutes si personne ne rejoint
    setTimeout(() => {
      if (activeCoinflipGames.has(gameId)) {
        const game = activeCoinflipGames.get(gameId);
        if (game.status === 'waiting') {
          const creatorUser = ensureUser(game.creatorId);
          updateUser(game.creatorId, { balance: creatorUser.balance + game.betAmount });
          activeCoinflipGames.delete(gameId);
        }
      }
    }, 5 * 60 * 1000);
  }
}

// SHOP
async function handleShop(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🛒 Boutique')
    .addFields(
      { name: '👑 Rôles VIP', value: `**VIP** - ${config.shop.vip.price} ${config.currency.emoji}\n• +50% XP sur les messages\n\n**Super VIP** - ${config.shop.superVip.price} ${config.currency.emoji}\n• +100% XP sur les messages`, inline: false },
      { name: '🎁 Surprises', value: `**${config.shop.surprise1.name}** - ${config.shop.surprise1.price} ${config.currency.emoji}\n**${config.shop.surprise2.name}** - ${config.shop.surprise2.price} ${config.currency.emoji}`, inline: false }
    )
    .setColor(0xffd700)
    .setFooter({ text: 'Utilise /acheter pour acheter un item' });
  
  await interaction.reply({ embeds: [embed] });
}

async function handlePurchase(interaction) {
  const item = interaction.options.getString('item');
  const user = ensureUser(interaction.user.id);
  
  let price = 0;
  let itemName = '';
  let roleToAdd = null;
  
  switch (item) {
    case 'vip':
      price = config.shop.vip.price;
      itemName = config.shop.vip.name;
      roleToAdd = 'VIP';
      break;
    case 'super_vip':
      price = config.shop.superVip.price;
      itemName = config.shop.superVip.name;
      roleToAdd = 'Super VIP';
      break;
    case 'surprise1':
      price = config.shop.surprise1.price;
      itemName = config.shop.surprise1.name;
      break;
    case 'surprise2':
      price = config.shop.surprise2.price;
      itemName = config.shop.surprise2.name;
      break;
  }
  
  if (user.balance < price) {
    await interaction.reply({ content: `❌ Solde insuffisant ! Tu as ${user.balance} ${config.currency.emoji}, il faut ${price} ${config.currency.emoji}`, ephemeral: true });
    return;
  }
  
  updateUser(interaction.user.id, { balance: user.balance - price });
  
  if (roleToAdd) {
    // Essayer d'ajouter le rôle
    try {
      let role = interaction.guild.roles.cache.find(r => r.name === roleToAdd);
      if (!role) {
        role = await interaction.guild.roles.create({
          name: roleToAdd,
          color: roleToAdd === 'VIP' ? 0xffd700 : 0xff6600,
          reason: 'Rôle acheté dans la boutique'
        });
      }
      await interaction.member.roles.add(role);
    } catch (error) {
      console.error('Erreur lors de l\'ajout du rôle:', error);
    }
  }
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Achat réussi !')
    .setDescription(`Tu as acheté **${itemName}** pour ${price} ${config.currency.emoji} !`)
    .setColor(0x00ff00);
  
  if (item === 'surprise1' || item === 'surprise2') {
    embed.addFields({ name: '🎁 Surprise !', value: 'Félicitations ! Tu as débloqué un contenu secret ! 🌟' });
  }
  
  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  activeBlackjackGames,
  activeCoinflipGames,
  handleBlackjackStart,
  resolveBlackjack,
  handleRouletteStart,
  handleRouletteChoice,
  handleSlots,
  handleCoinflipSolo,
  handleCoinflipMulti,
  handleShop,
  handlePurchase
};
