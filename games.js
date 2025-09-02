const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');
const { ensureUser, updateUser, updateMissionProgress, db } = require('./database');
const { random, createDeck, calculateHandValue, formatHand, getRouletteColor, playSlots } = require('./utils');

// Variables globales pour les jeux
const activeBlackjackGames = new Map();
const activeCoinflipGames = new Map();
const activeTicTacToeGames = new Map();
const activeConnectFourGames = new Map();

// Fonction utilitaire pour ajouter de l'argent à un utilisateur
async function addMoney(userId, amount, interaction) {
  const user = ensureUser(userId);
  const newBalance = user.balance + amount;
  updateUser(userId, { balance: newBalance });
  
  // Mettre à jour le message si une interaction est fournie
  if (interaction) {
    await interaction.followUp({ 
      content: `+${amount} ${config.currency.emoji} ont été ajoutés à votre solde.`,
      ephemeral: true 
    });
  }
  
  return newBalance;
}

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
  
  const gameData = {
    deck, 
    playerHand, 
    dealerHand, 
    bet, 
    userId: interaction.user.id,
    createdAt: Date.now()
  };
  
  console.log(`[BLACKJACK] Création d'une nouvelle partie pour ${interaction.user.id}`);
  console.log(`[BLACKJACK] Nombre de cartes dans le jeu: ${deck.length}`);
  console.log(`[BLACKJACK] Main du joueur:`, playerHand.map(card => card.display));
  console.log(`[BLACKJACK] Main du croupier:`, dealerHand.map(card => card.display));
  
  activeBlackjackGames.set(interaction.user.id, gameData);
  console.log(`[BLACKJACK] Parties actives:`, [...activeBlackjackGames.keys()]);
  
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
  
  console.log(`[DEBUG] Deleting blackjack game for user ${userId}`);
  console.log(`[BLACKJACK] Suppression de la partie pour ${userId}`);
  console.log(`[BLACKJACK] Durée de la partie: ${((Date.now() - (game.createdAt || Date.now())) / 1000).toFixed(2)}s`);
  activeBlackjackGames.delete(userId);
  console.log(`[BLACKJACK] Parties restantes:`, [...activeBlackjackGames.keys()]);
  
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

// MORPION (TIC-TAC-TOE)
async function handleTicTacToe(interaction) {
  const opponent = interaction.options.getUser('adversaire');
  const bet = interaction.options.getInteger('mise') || 0;
  const player1 = interaction.user;
  const player2 = opponent;
  
  // Vérifications initiales
  if (player1.id === player2.id) {
    await interaction.reply({ content: '❌ Tu ne peux pas jouer contre toi-même !', ephemeral: true });
    return;
  }
  
  if (player2.bot) {
    await interaction.reply({ content: '❌ Tu ne peux pas jouer contre un bot !', ephemeral: true });
    return;
  }
  
  // Vérification des fonds si mise
  if (bet > 0) {
    const user1 = ensureUser(player1.id);
    const user2 = ensureUser(player2.id);
    
    if (user1.balance < bet) {
      await interaction.reply({ 
        content: `❌ Tu n'as pas assez de ${config.currency.emoji} pour cette mise !`, 
        ephemeral: true 
      });
      return;
    }
    
    if (user2.balance < bet) {
      await interaction.reply({ 
        content: `❌ ${player2.username} n'a pas assez de ${config.currency.emoji} pour cette mise !`, 
        ephemeral: true 
      });
      return;
    }
    
    // Bloquer les fonds
    updateUser(player1.id, { balance: user1.balance - bet });
    updateUser(player2.id, { balance: user2.balance - bet });
  }
  
  // Créer la grille de jeu 5x5
  const board = Array(25).fill(null);
  const gameId = `${player1.id}-${player2.id}-${Date.now()}`;
  
  console.log(`[MORPION] Création d'une nouvelle partie: ${gameId}`);
  console.log(`[MORPION] Joueurs: ${player1.username} vs ${player2.username}`);
  
  // Créer les boutons pour la grille 5x5
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 5; j++) {
      const index = i * 5 + j;
      const button = new ButtonBuilder()
        .setCustomId(`ttt_${gameId}_${index}`)
        .setLabel('·') // Point médian comme marqueur visuel
        .setStyle(ButtonStyle.Secondary);
      row.addComponents(button);
    }
    rows.push(row);
  }
  
  // Enregistrer la partie
  activeTicTacToeGames.set(gameId, {
    board,
    players: [player1.id, player2.id],
    currentPlayer: 0, // Index du joueur actuel (0 ou 1)
    bet,
    message: null
  });
  
  // Créer l'embed
  const embed = new EmbedBuilder()
    .setTitle('O Morpion X')
    .setDescription(`**${player1.username}** (X) vs **${player2.username}** (O)\n\nC'est au tour de ${player1}`)
    .setColor(0x00ff00);
    
  if (bet > 0) {
    embed.addFields({ name: 'Mise', value: `${bet} ${config.currency.emoji} par joueur` });
  }
  
  // Envoyer le message avec les boutons
  console.log('[MORPION] Envoi du message avec les boutons...');
  try {
    const message = await interaction.reply({ 
      content: `${player1} vs ${player2} - C'est parti pour une partie de morpion !`,
      embeds: [embed],
      components: rows,
      fetchReply: true
    });
    console.log('[MORPION] Message envoyé avec succès');
  } catch (error) {
    console.error('[MORPION] Erreur lors de l\'envoi du message:', error);
    throw error;
  }
  
  // Sauvegarder la référence du message
  const game = activeTicTacToeGames.get(gameId);
  game.message = message;
  activeTicTacToeGames.set(gameId, game);
}

// Vérifier si un joueur a gagné au Morpion 5x5
function checkTicTacToeWinner(board) {
  const size = 5;
  const winLength = 4; // Nombre de symboles alignés nécessaires pour gagner
  
  // Vérifier les lignes
  for (let row = 0; row < size; row++) {
    for (let col = 0; col <= size - winLength; col++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index + 1] && 
          board[index] === board[index + 2] && 
          board[index] === board[index + 3]) {
        return board[index];
      }
    }
  }
  
  // Vérifier les colonnes
  for (let col = 0; col < size; col++) {
    for (let row = 0; row <= size - winLength; row++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index + size] && 
          board[index] === board[index + 2 * size] && 
          board[index] === board[index + 3 * size]) {
        return board[index];
      }
    }
  }
  
  // Vérifier les diagonales descendantes
  for (let row = 0; row <= size - winLength; row++) {
    for (let col = 0; col <= size - winLength; col++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index + size + 1] && 
          board[index] === board[index + 2 * (size + 1)] && 
          board[index] === board[index + 3 * (size + 1)]) {
        return board[index];
      }
    }
  }
  
  // Vérifier les diagonales montantes
  for (let row = winLength - 1; row < size; row++) {
    for (let col = 0; col <= size - winLength; col++) {
      const index = row * size + col;
      if (board[index] && 
          board[index] === board[index - (size - 1)] && 
          board[index] === board[index - 2 * (size - 1)] && 
          board[index] === board[index - 3 * (size - 1)]) {
        return board[index];
      }
    }
  }
  
  // Vérifier le match nul
  if (board.every(cell => cell !== null)) return 'tie';
  
  return null; // Pas de gagnant pour l'instant
}

// Vérifier si un joueur a gagné au Puissance 4
function checkConnectFourWinner(board) {
  const ROWS = 6;
  const COLS = 7;
  
  // Vérifier les lignes horizontales
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const index = row * COLS + col;
      if (
        board[index] && 
        board[index] === board[index + 1] &&
        board[index] === board[index + 2] &&
        board[index] === board[index + 3]
      ) {
        return board[index];
      }
    }
  }
  
  // Vérifier les colonnes verticales
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      const index = row * COLS + col;
      if (
        board[index] && 
        board[index] === board[index + COLS] &&
        board[index] === board[index + 2 * COLS] &&
        board[index] === board[index + 3 * COLS]
      ) {
        return board[index];
      }
    }
  }
  
  // Vérifier les diagonales montantes
  for (let row = 3; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const index = row * COLS + col;
      if (
        board[index] && 
        board[index] === board[index - COLS + 1] &&
        board[index] === board[index - 2 * COLS + 2] &&
        board[index] === board[index - 3 * COLS + 3]
      ) {
        return board[index];
      }
    }
  }
  
  // Vérifier les diagonales descendantes
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const index = row * COLS + col;
      if (
        board[index] && 
        board[index] === board[index + COLS + 1] &&
        board[index] === board[index + 2 * COLS + 2] &&
        board[index] === board[index + 3 * COLS + 3]
      ) {
        return board[index];
      }
    }
  }
  
  // Vérifier si le plateau est plein (match nul)
  if (board.every(cell => cell !== null)) return 'tie';
  
  return null; // Pas de gagnant pour l'instant
}

// Gérer les mouvements du Morpion
async function handleTicTacToeMove(interaction) {
  const [_, gameId, index] = interaction.customId.split('_');
  const game = activeTicTacToeGames.get(gameId);
  
  if (!game) {
    await interaction.update({ components: [] });
    return;
  }
  
  const currentPlayerId = game.players[game.currentPlayer];
  
  // Vérifier si c'est bien le tour du joueur
  if (interaction.user.id !== currentPlayerId) {
    await interaction.reply({ 
      content: '❌ Ce n\'est pas à ton tour de jouer !', 
      ephemeral: true 
    });
    return;
  }
  
  // Vérifier si la case est déjà prise
  if (game.board[index] !== null) {
    await interaction.reply({ 
      content: '❌ Cette case est déjà prise !', 
      ephemeral: true 
    });
    return;
  }
  
  // Mettre à jour le plateau
  const symbol = game.currentPlayer === 0 ? 'X' : 'O';
  game.board[index] = symbol;
  
  // Vérifier s'il y a un gagnant
  const winner = checkTicTacToeWinner(game.board);
  
  // Mettre à jour l'affichage pour la grille 5x5
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 5; j++) {
      const idx = i * 5 + j;
      const button = new ButtonBuilder()
        .setCustomId(`ttt_${gameId}_${idx}`)
        .setLabel(game.board[idx] || '·') // Point médian comme marqueur visuel
        .setStyle(game.board[idx] ? 
          (game.board[idx] === 'X' ? ButtonStyle.Danger : ButtonStyle.Primary) : 
          ButtonStyle.Secondary
        );
      
      if (game.board[idx] || winner) {
        button.setDisabled(true);
      }
      
      row.addComponents(button);
    }
    rows.push(row);
  }
  
  // Mettre à jour le message
  const player1 = interaction.client.users.cache.get(game.players[0]);
  const player2 = interaction.client.users.cache.get(game.players[1]);
  
  const embed = new EmbedBuilder()
    .setTitle('O Morpion X')
    .setColor(0x00ff00);
    
  if (game.bet > 0) {
    embed.addFields({ name: 'Mise', value: `${game.bet} ${config.currency.emoji} par joueur` });
  }
  
  if (winner === 'tie') {
    embed.setDescription('**Match nul !**\nPersonne ne remporte la partie.');
    
    // Rembourser les mises en cas d'égalité
    if (game.bet > 0) {
      const user1 = ensureUser(game.players[0]);
      const user2 = ensureUser(game.players[1]);
      updateUser(game.players[0], { balance: user1.balance + game.bet });
      updateUser(game.players[1], { balance: user2.balance + game.bet });
      embed.addFields({ name: 'Remboursement', value: `Chaque joueur récupère sa mise de ${game.bet} ${config.currency.emoji}` });
    }
    
    activeTicTacToeGames.delete(gameId);
  } else if (winner) {
    const winnerIndex = winner === 'X' ? 0 : 1;
    const winnerUser = interaction.client.users.cache.get(game.players[winnerIndex]);
    const loserUser = interaction.client.users.cache.get(game.players[1 - winnerIndex]);
    
    embed.setDescription(`**${winnerUser.username} a gagné !** 🎉`);
    
    // Distribuer les gains
    if (game.bet > 0) {
      const winnings = game.bet * 2;
      const winnerData = ensureUser(winnerUser.id);
      updateUser(winnerUser.id, { balance: winnerData.balance + winnings });
      embed.addFields({ name: 'Gains', value: `${winnerUser.username} remporte ${winnings} ${config.currency.emoji} !` });
    }
    
    activeTicTacToeGames.delete(gameId);
  } else {
    // Passer au joueur suivant
    game.currentPlayer = 1 - game.currentPlayer;
    const nextPlayer = game.currentPlayer === 0 ? player1 : player2;
    embed.setDescription(`**${player1.username}** (❌) vs **${player2.username}** (⭕)\n\nC'est au tour de ${nextPlayer}`);
    activeTicTacToeGames.set(gameId, game);
  }
  
  await interaction.update({ embeds: [embed], components: rows });
}

// Gestion des parties de Puissance 4
async function handleConnectFour(interaction, opponent, bet = 0) {
  const player1 = interaction.user;
  const player2 = opponent || interaction.user; // Si pas d'adversaire spécifié, jouer contre soi-même (pour test)
  
  // Créer le plateau de jeu (6 lignes x 7 colonnes)
  const board = Array(6 * 7).fill(null);
  const gameId = `cf_${player1.id}-${player2.id}-${Date.now()}`;
  
  console.log(`[PUISSANCE4] Création d'une nouvelle partie: ${gameId}`);
  console.log(`[PUISSANCE4] Joueurs: ${player1.username} vs ${player2.username}`);
  
  // Créer les boutons pour les colonnes
  const rows = [];
  
  // Boutons pour choisir une colonne (2 rangées de 4 et 3 boutons)
  const buttonRow1 = new ActionRowBuilder();
  const buttonRow2 = new ActionRowBuilder();
  
  // Première rangée (4 premiers boutons)
  for (let col = 0; col < 4; col++) {
    buttonRow1.addComponents(
      new ButtonBuilder()
        .setCustomId(`cf_${gameId}_${col}`)
        .setLabel(`${col + 1}`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  // Deuxième rangée (3 boutons restants)
  for (let col = 4; col < 7; col++) {
    buttonRow2.addComponents(
      new ButtonBuilder()
        .setCustomId(`cf_${gameId}_${col}`)
        .setLabel(`${col + 1}`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  rows.push(buttonRow1, buttonRow2);
  
  // Créer la grille d'affichage
  const gridRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('connect4_grid')
        .setPlaceholder('Grille de jeu')
        .setDisabled(true)
        .addOptions([
          {
            label: 'Grille de jeu',
            description: formatConnectFourBoard(board, 0),
            value: 'grid',
            emoji: '⬜'
          }
        ])
    );
  rows.push(gridRow);
  
  // Enregistrer la partie
  activeConnectFourGames.set(gameId, {
    board,
    players: [player1.id, player2.id],
    currentPlayer: 0, // Index du joueur actuel (0 ou 1)
    bet,
    message: null,
    lastMove: null
  });
  
  // Créer l'embed
  const embed = new EmbedBuilder()
    .setTitle('🎮 Puissance 4')
    .setDescription(`**${player1.username}** (🔴) vs **${player2.username}** (🟡)\nC'est au tour de **${player1.username}** de jouer !`)
    .setColor(0x00ff00);
  
  if (bet > 0) {
    embed.addFields({ name: 'Mise', value: `${bet} ${config.currency.emoji} par joueur` });
  }
  
  // Envoyer le message
  try {
    const message = await interaction.reply({ 
      embeds: [embed], 
      components: rows,
      fetchReply: true 
    });
    
    // Sauvegarder la référence du message
    const game = activeConnectFourGames.get(gameId);
    game.message = message;
    activeConnectFourGames.set(gameId, game);
    
  } catch (error) {
    console.error('[PUISSANCE4] Erreur lors de l\'envoi du message:', error);
    throw error;
  }
}

// Formater le plateau de Puissance 4 pour l'affichage
function formatConnectFourBoard(board, lastMoveCol = null) {
  const ROWS = 6;
  const COLS = 7;
  let output = '';
  
  // Afficher les numéros de colonnes
  output += '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣\n';
  
  // Afficher la grille
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const cell = board[index];
      
      if (cell === 'R') output += '🔴';
      else if (cell === 'Y') output += '🟡';
      else output += '⚪';
    }
    output += '\n';
  }
  
  // Mettre en surbrillance la dernière colonne jouée
  if (lastMoveCol !== null) {
    output += ' '.repeat(lastMoveCol * 2) + '⬇️';
  }
  
  return output;
}

// Gérer les mouvements au Puissance 4
async function handleConnectFourMove(interaction) {
  const [_, gameId, col] = interaction.customId.split('_');
  const game = activeConnectFourGames.get(gameId);
  
  if (!game) {
    await interaction.update({ components: [] });
    return;
  }
  
  const currentPlayerId = interaction.user.id;
  if (currentPlayerId !== game.players[game.currentPlayer]) {
    await interaction.reply({ content: 'Ce n\'est pas à votre tour de jouer !', ephemeral: true });
    return;
  }
  
  const column = parseInt(col, 10);
  const ROWS = 6;
  const COLS = 7;
  
  // Trouver la première case vide dans la colonne
  let row = ROWS - 1;
  while (row >= 0 && game.board[row * COLS + column] !== null) {
    row--;
  }
  
  if (row < 0) {
    await interaction.reply({ content: 'Cette colonne est pleine !', ephemeral: true });
    return;
  }
  
  // Placer le jeton
  const index = row * COLS + column;
  game.board[index] = game.currentPlayer === 0 ? 'R' : 'Y';
  game.lastMove = column;
  
  // Vérifier s'il y a un gagnant
  const winner = checkConnectFourWinner(game.board);
  
  // Mettre à jour l'affichage
  const player1 = interaction.client.users.cache.get(game.players[0]);
  const player2 = interaction.client.cache.get(game.players[1]);
  
  // Mettre à jour la grille d'affichage
  const gridRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('connect4_grid')
        .setPlaceholder('Grille de jeu')
        .setDisabled(true)
        .addOptions([
          {
            label: 'Grille de jeu',
            description: formatConnectFourBoard(game.board, column),
            value: 'grid',
            emoji: '⬜'
          }
        ])
    );
  
  // Mettre à jour les boutons
  const buttonRow = new ActionRowBuilder();
  for (let c = 0; c < 7; c++) {
    const isColumnFull = game.board[c] !== null; // Vérifie si la colonne est pleine
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`cf_${gameId}_${c}`)
        .setLabel(`${c + 1}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(winner !== null || isColumnFull)
    );
  }
  
  // Mettre à jour l'embed
  const embed = new EmbedBuilder()
    .setTitle('🎮 Puissance 4')
    .setColor(0x00ff00);
  
  if (game.bet > 0) {
    embed.addFields({ name: 'Mise', value: `${game.bet} ${config.currency.emoji} par joueur` });
  }
  
  if (winner === 'R' || winner === 'Y') {
    const winnerIndex = winner === 'R' ? 0 : 1;
    const winnerUser = interaction.client.users.cache.get(game.players[winnerIndex]);
    
    embed.setDescription(`**${player1.username}** (🔴) vs **${player2.username}** (🟡)\n🎉 **${winnerUser.username} a gagné la partie !**`);
    
    // Désactiver tous les boutons
    buttonRow.components.forEach(btn => btn.setDisabled(true));
    
    // Gagner la mise si applicable
    if (game.bet > 0) {
      const winnerId = game.players[winnerIndex];
      const loserId = game.players[1 - winnerIndex];
      
      await addMoney(winnerId, game.bet * 2, interaction);
      await interaction.followUp({ 
        content: `🏆 ${winnerUser} a gagné ${game.bet * 2} ${config.currency.emoji} !`,
        ephemeral: true 
      });
    }
    
    // Supprimer la partie
    activeConnectFourGames.delete(gameId);
    
  } else if (winner === 'tie') {
    embed.setDescription(`**${player1.username}** (🔴) vs **${player2.username}** (🟡)\n🤝 **Match nul !**`);
    
    // Rembourser les mises en cas d'égalité
    if (game.bet > 0) {
      await addMoney(game.players[0], game.bet, interaction);
      await addMoney(game.players[1], game.bet, interaction);
      await interaction.followUp({ 
        content: `Les mises ont été remboursées (${game.bet} ${config.currency.emoji} par joueur).`,
        ephemeral: true 
      });
    }
    
    // Supprimer la partie
    activeConnectFourGames.delete(gameId);
    
  } else {
    // Changer de joueur
    game.currentPlayer = 1 - game.currentPlayer;
    const currentPlayer = interaction.client.users.cache.get(game.players[game.currentPlayer]);
    embed.setDescription(`**${player1.username}** (🔴) vs **${player2.username}** (🟡)\nC'est au tour de **${currentPlayer.username}** de jouer !`);
    
    // Mettre à jour le jeu
    activeConnectFourGames.set(gameId, game);
  }
  
  // Mettre à jour le message
  await interaction.update({
    embeds: [embed],
    components: [buttonRow, gridRow]
  });
}

// Exporter les fonctions
module.exports = {
  handleBlackjack: handleBlackjackStart,
  handleTicTacToe,
  handleTicTacToeMove,
  handleConnectFour,
  handleConnectFourMove,
  activeBlackjackGames,
  activeTicTacToeGames,
  activeConnectFourGames,
  handleSlots,
  handleCoinflipSolo,
  handleCoinflipMulti,
  handleShop,
  handlePurchase,
  addMoney
};
