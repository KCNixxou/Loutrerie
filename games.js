const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');
const { 
  ensureUser, 
  updateUser, 
  updateMissionProgress, 
  db, 
  getTicTacToeStats, 
  updateTicTacToeStats, 
  getTicTacToeLeaderboard 
} = require('./database');
const { random, createDeck, calculateHandValue, formatHand, getRouletteColor, playSlots, getCardValue, compareCards } = require('./utils');

// Variables pour le jeu High Low
const activeHighLowGames = new Map();

// Variables globales pour les jeux
const activeBlackjackGames = new Map();
const activeCoinflipGames = new Map();
const activeTicTacToeGames = new Map();

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
  
  const netWinnings = winnings - game.bet;
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack - Résultat')
    .addFields(
      { name: 'Ta main', value: `${formatHand(game.playerHand)}\nValeur: **${playerValue}**`, inline: true },
      { name: 'Croupier', value: `${formatHand(game.dealerHand)}\nValeur: **${dealerValue}**`, inline: true },
      { name: 'Résultat', value: result, inline: false },
      { 
        name: winnings > 0 ? 'Gains nets' : 'Perte', 
        value: winnings > 0 
          ? `+${netWinnings} ${config.currency.emoji} (${game.bet} mise + ${netWinnings} gain)` 
          : `-${game.bet} ${config.currency.emoji}`, 
        inline: true 
      }
    )
    .setColor(winnings > 0 ? 0x00ff00 : 0xff0000);
  
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
  
  // Ne pas déduire la mise ici, elle est déjà déduite dans handleRouletteStart
  
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
  
  // Mettre à jour l'utilisateur pour avoir le bon solde
  const updatedUser = ensureUser(interaction.user.id);
  
  const { result, multiplier } = playSlots();
  const winnings = Math.floor(bet * multiplier);
  
  if (winnings > 0) {
    // Ajouter les gains au nouveau solde (après déduction de la mise)
    updateUser(interaction.user.id, { balance: updatedUser.balance + winnings });
  }
  
  const netWinnings = winnings - bet;
  const embed = new EmbedBuilder()
    .setTitle('🎰 Machine à Sous')
    .setThumbnail('https://i.imgur.com/aZSIqq8.png')
    .addFields(
      { name: 'Résultat', value: result.join(' '), inline: false },
      { 
        name: 'Mise', 
        value: `${bet} ${config.currency.emoji}`, 
        inline: true 
      },
      { 
        name: 'Gains bruts', 
        value: winnings > 0 ? `${winnings} ${config.currency.emoji}` : '0', 
        inline: true 
      },
      { 
        name: 'Gains nets', 
        value: netWinnings >= 0 
          ? `+${netWinnings} ${config.currency.emoji} (${winnings} - ${bet})` 
          : `${netWinnings} ${config.currency.emoji}`, 
        inline: true 
      }
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
    .setThumbnail('https://i.imgur.com/mpoaOLW.png')
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
      .setThumbnail('https://i.imgur.com/wmGkfNQ.png')
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
      .setThumbnail('https://i.imgur.com/wmGkfNQ.png')
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
    .setDescription('Découvrez les avantages exclusifs de la boutique !')
    .setThumbnail('https://i.imgur.com/YbdHZae.png')
    .setImage('https://i.imgur.com/YbdHZae.png') // Bannière en bas de l'embed
    .addFields(
      { 
        name: '👑 Rôles VIP', 
        value: `**VIP** - ${config.shop.vip.price} ${config.currency.emoji}\n• +25% XP sur les messages\n\n**Super VIP** - ${config.shop.superVip.price} ${config.currency.emoji}\n• +50% XP sur les messages`, 
        inline: false 
      },
      { 
        name: '🎨 Personnalisation', 
        value: `**${config.shop.colorChange.name}** - ${config.shop.colorChange.price} ${config.currency.emoji}\n• Change la couleur de ton pseudo sur le serveur`, 
        inline: false 
      },
      { 
        name: '🎁 Surprises', 
        value: `**${config.shop.surprise1.name}** - ${config.shop.surprise1.price} ${config.currency.emoji}\n**${config.shop.surprise2.name}** - ${config.shop.surprise2.price} ${config.currency.emoji}`, 
        inline: false 
      }
    )
    .setColor(0xffd700)
    .setFooter({ 
      text: 'Utilise /acheter pour acheter un item',
      iconURL: 'https://i.imgur.com/your-icon-url.png' // Petite icône dans le footer
    });
  
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
    case 'color_change':
      price = config.shop.colorChange.price;
      itemName = config.shop.colorChange.name;
      // L'administrateur changera manuellement la couleur
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
    // Gestion des rôles VIP uniquement
    if (roleToAdd === 'VIP' || roleToAdd === 'Super VIP') {
      try {
        let role = interaction.guild.roles.cache.find(r => r.name === roleToAdd);
        if (!role) {
          const roleColor = roleToAdd === 'VIP' ? 0xffd700 : 0xff6600;
          
          role = await interaction.guild.roles.create({
            name: roleToAdd,
            color: roleColor,
            reason: 'Rôle acheté dans la boutique',
            mentionable: false,
            hoist: false
          });
        }
        
        // Supprimer l'ancien rôle VIP si existant
        const existingVipRoles = interaction.member.roles.cache.filter(r => 
          ['VIP', 'Super VIP'].includes(r.name)
        );
        
        if (existingVipRoles.size > 0) {
          await interaction.member.roles.remove(existingVipRoles);
        }
        
        await interaction.member.roles.add(role);
      } catch (error) {
        console.error('Erreur lors de l\'ajout du rôle:', error);
        await interaction.followUp({ 
          content: '❌ Une erreur est survenue lors de l\'attribution du rôle VIP. Contacte un administrateur.', 
          ephemeral: true 
        });
        return;
      }
    }
  }
  
  let description = `Tu as acheté **${itemName}** pour ${price} ${config.currency.emoji} !`;
  
  if (item === 'color_change') {
    description += '\n\nUn administrateur te contactera bientôt pour personnaliser ta couleur !';
  }
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Achat réussi !')
    .setDescription(description)
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
    player1,  // Stocker l'objet utilisateur complet
    player2,  // Stocker l'objet utilisateur complet
    currentPlayer: 0, // Index du joueur actuel (0 ou 1)
    currentPlayerId: player1.id, // ID du joueur dont c'est le tour
    bet,
    message: null,
    createdAt: Date.now()
  });
  
  // Créer l'embed
  const embed = new EmbedBuilder()
    .setTitle('⭕ Morpion ❌')
    .setDescription(`**${player1.username}** (❌) vs **${player2.username}** (⭕)\n\nC'est au tour de ${player1}`)
    .setColor(0x00ff00)
    .setThumbnail('https://i.imgur.com/undefined');
    
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
    
    // Sauvegarder la référence du message
    const game = activeTicTacToeGames.get(gameId);
    game.message = message;
    activeTicTacToeGames.set(gameId, game);
  } catch (error) {
    console.error('[MORPION] Erreur lors de l\'envoi du message:', error);
    throw error;
  }
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

// Gérer les mouvements du Morpion
async function handleTicTacToeMove(interaction) {
  console.log('[MORPION] Nouvelle interaction reçue:', interaction.customId);
  const [_, gameId, index] = interaction.customId.split('_');
  console.log('[MORPION] ID de jeu:', gameId, 'Index:', index);
  
  const game = activeTicTacToeGames.get(gameId);
  console.log('[MORPION] Partie trouvée:', game ? 'Oui' : 'Non');
  
  if (!game) {
    await interaction.update({ components: [] });
    return;
  }
  
  // Utiliser directement l'index du joueur actuel pour plus de fiabilité
  const currentPlayerId = game.players[game.currentPlayer];
  
  console.log('[MORPION] Joueur actuel:', currentPlayerId, 'Joueur qui interagit:', interaction.user.id);
  console.log('[MORPION] Détails du jeu:', {
    players: game.players,
    currentPlayer: game.currentPlayer,
    currentPlayerId: game.currentPlayerId,
    player1: game.player1?.id,
    player2: game.player2?.id
  });
  
  // Vérifier si c'est bien le tour du joueur
  if (interaction.user.id !== currentPlayerId) {
    console.log('[MORPION] Mauvais tour: ce n\'est pas au tour de ce joueur');
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
  
  // Déterminer le symbole du joueur actuel et mettre à jour le plateau
  const symbol = game.currentPlayer === 0 ? 'X' : 'O';
  console.log('[MORPION] Mise à jour du plateau - Index:', index, 'Symbole:', symbol, 'Joueur:', game.currentPlayer);
  
  // Mettre à jour le plateau
  game.board[index] = symbol;
  
  // Le changement de joueur sera géré plus bas dans le code
  // pour éviter les doublons
  
  // Vérifier s'il y a un gagnant ou un match nul
  const winner = checkTicTacToeWinner(game.board);
  const isDraw = !winner && game.board.every(cell => cell !== null);
  const isGameOver = !!winner || isDraw;
  
  console.log('[MORPION] État de la partie - Gagnant:', winner || 'Aucun', 'Match nul:', isDraw, 'Partie terminée:', isGameOver);

  // Mettre à jour les statistiques si la partie est terminée
  if (isGameOver) {
    const player1 = game.players[0];
    const player2 = game.players[1];
    
    if (winner) {
      const winnerId = winner === 'X' ? player1 : player2;
      const loserId = winner === 'X' ? player2 : player1;
      
      // Mettre à jour les statistiques du gagnant et du perdant
      updateTicTacToeStats(winnerId, 'win');
      updateTicTacToeStats(loserId, 'loss');
      
      // Mettre à jour les missions pour les joueurs
      updateMissionProgress(winnerId, 'win_games', 1);
      updateMissionProgress(loserId, 'play_games', 1);
      
      // Distribuer les gains si une mise était en jeu
      if (game.bet > 0) {
        const winnerUser = ensureUser(winnerId);
        const winnings = game.bet * 2;
        updateUser(winnerId, { balance: winnerUser.balance + winnings });
      }
    } else if (isDraw) {
      // Match nul
      updateTicTacToeStats(player1, 'draw');
      updateTicTacToeStats(player2, 'draw');
      updateMissionProgress(player1, 'play_games', 1);
      updateMissionProgress(player2, 'play_games', 1);
      
      // Rembourser les mises en cas de match nul
      if (game.bet > 0) {
        const user1 = ensureUser(player1);
        const user2 = ensureUser(player2);
        updateUser(player1, { balance: user1.balance + game.bet });
        updateUser(player2, { balance: user2.balance + game.bet });
      }
    }
    
    // Supprimer la partie de la mémoire
    activeTicTacToeGames.delete(gameId);
  } else {
    // Passer au joueur suivant
    game.currentPlayer = game.currentPlayer === 0 ? 1 : 0;
    // Mettre à jour l'ID du joueur actuel
    game.currentPlayerId = game.players[game.currentPlayer];
    console.log('[MORPION] Passage au joueur suivant:', game.currentPlayerId, '(Index:', game.currentPlayer, ')');
    activeTicTacToeGames.set(gameId, game);
  }
  
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
        )
        .setDisabled(isGameOver || game.board[idx] !== null); // Désactiver si partie terminée ou case déjà prise
      
      row.addComponents(button);
    }
    rows.push(row);
  }
  
  // Mettre à jour le message
  const player1 = game.player1 || interaction.client.users.cache.get(game.players[0]);
  const player2 = game.player2 || interaction.client.users.cache.get(game.players[1]);
  
  console.log('[MORPION] Joueurs - Player1:', player1?.username, 'Player2:', player2?.username);
  
  const embed = new EmbedBuilder()
    .setTitle('⭕ Morpion ❌')
    .setColor(0x00ff00)
    .setThumbnail('https://i.imgur.com/undefined');
    
  if (game.bet > 0) {
    embed.addFields({ name: 'Mise', value: `${game.bet} ${config.currency.emoji} par joueur` });
  }
  
  if (isDraw) {
    embed.setDescription('**Match nul !**\nPersonne ne remporte la partie.');
    
    // Rembourser les mises en cas d'égalité
    if (game.bet > 0) {
      const user1 = ensureUser(game.players[0]);
      const user2 = ensureUser(game.players[1]);
      updateUser(game.players[0], { balance: user1.balance + game.bet });
      updateUser(game.players[1], { balance: user2.balance + game.bet });
      embed.addFields({ name: 'Remboursement', value: `Chaque joueur récupère sa mise de ${game.bet} ${config.currency.emoji}` });
    }
    
    // Désactiver tous les boutons
    rows.forEach(row => {
      row.components.forEach(button => button.setDisabled(true));
    });
    
    activeTicTacToeGames.delete(gameId);
  } else if (winner) {
    const winnerIndex = winner === 'X' ? 0 : 1;
    const winnerUser = winnerIndex === 0 ? player1 : player2;
    
    embed.setDescription(`**${winnerUser.username} a gagné !** 🎉`);
    
    // Distribuer les gains
    if (game.bet > 0) {
      const winnings = game.bet * 2;
      const winnerData = ensureUser(winnerUser.id);
      updateUser(winnerUser.id, { balance: winnerData.balance + winnings });
      embed.addFields({ name: 'Gains', value: `${winnerUser} remporte ${winnings} ${config.currency.emoji} !` });
    }
    
    // Désactiver tous les boutons
    rows.forEach(row => {
      row.components.forEach(button => button.setDisabled(true));
    });
    
    activeTicTacToeGames.delete(gameId);
  } else {
    // Récupérer les informations du prochain joueur de manière cohérente
    const nextPlayer = interaction.client.users.cache.get(game.players[game.currentPlayer]);
    const currentSymbol = game.currentPlayer === 0 ? '❌' : '⭕';
    const player1 = interaction.client.users.cache.get(game.players[0]);
    const player2 = interaction.client.users.cache.get(game.players[1]);
    
    console.log('[MORPION] Tour suivant - Joueur:', nextPlayer.username, '(ID:', game.currentPlayerId, 'Index:', game.currentPlayer, ')');
    activeTicTacToeGames.set(gameId, game);
    
    embed.setDescription(
      `**${player1.username}** (❌) vs **${player2.username}** (⭕)\n\n` +
      `C'est au tour de ${nextPlayer} (${currentSymbol})`
    );
    
    console.log('[MORPION] Tour mis à jour - Prochain joueur:', nextPlayer.username, '(ID:', game.currentPlayerId, 'Index:', game.currentPlayer, ')');
  }
  
  try {
    const content = isGameOver 
      ? (winner 
          ? `🎉 **${winner === 'X' ? player1.username : player2.username}** a gagné la partie !` 
          : '🤝 Match nul !')
      : `${player1} vs ${player2} - Partie en cours`;
    
    console.log('[MORPION] Mise à jour du message avec contenu:', content);
    console.log('[MORPION] Nombre de rangées de boutons:', rows.length);
    
    await interaction.update({ 
      embeds: [embed],
      components: rows,
      content: content
    });
    
    console.log('[MORPION] Message mis à jour avec succès');
  } catch (error) {
    console.error('Erreur lors de la mise à jour du message:', error);
  }
}

// Exporter les fonctions
// Afficher le classement du morpion
async function handleTicTacToeLeaderboard(interaction) {
  try {
    const limit = interaction.options.getInteger('limite') || 10;
    const leaderboard = getTicTacToeLeaderboard(limit);
    
    if (leaderboard.length === 0) {
      await interaction.reply({
        content: 'Aucune donnée de classement disponible pour le moment.',
        ephemeral: true
      });
      return;
    }
    
    // Récupérer les informations des utilisateurs
    const userPromises = leaderboard.map(async (entry, index) => {
      try {
        const user = await interaction.client.users.fetch(entry.user_id);
        const winRate = (entry.win_rate * 100).toFixed(1);
        return {
          rank: index + 1,
          username: user.username,
          wins: entry.wins,
          losses: entry.losses,
          draws: entry.draws,
          winRate
        };
      } catch (error) {
        console.error(`Erreur lors de la récupération de l'utilisateur ${entry.user_id}:`, error);
        return null;
      }
    });
    
    const leaderboardData = (await Promise.all(userPromises)).filter(Boolean);
    
    // Créer l'embed
    const embed = new EmbedBuilder()
      .setTitle('🏆 Classement du Morpion')
      .setColor(0x00ff00)
      .setDescription(`Top ${leaderboardData.length} des meilleurs joueurs de morpion`)
      .setTimestamp();
    
    // Ajouter les champs au classement
    const leaderboardFields = leaderboardData.map(entry => {
      return {
        name: `#${entry.rank} - ${entry.username}`,
        value: `✅ ${entry.wins} victoires | ❌ ${entry.losses} défaites | 🤝 ${entry.draws} matchs nuls\n📊 Taux de victoire: ${entry.winRate}%`,
        inline: false
      };
    });
    
    // Ajouter les champs par lots de 25 (limite de Discord)
    for (let i = 0; i < leaderboardFields.length; i += 25) {
      const fieldsBatch = leaderboardFields.slice(i, i + 25);
      embed.addFields(fieldsBatch);
    }
    
    // Afficher les statistiques de l'utilisateur actuel s'il n'est pas dans le top
    const currentUserStats = getTicTacToeStats(interaction.user.id);
    if (currentUserStats.games_played > 0) {
      const currentUserRank = leaderboard.findIndex(entry => entry.user_id === interaction.user.id);
      
      if (currentUserRank === -1) {
        const winRate = (currentUserStats.wins / currentUserStats.games_played * 100).toFixed(1);
        embed.addFields({
          name: '\u200B',
          value: `\nVotre classement: Hors du top ${limit}\n` +
                 `✅ ${currentUserStats.wins} victoires | ❌ ${currentUserStats.losses} défaites | 🤝 ${currentUserStats.draws} matchs nuls\n` +
                 `📊 Taux de victoire: ${winRate}%`
        });
      }
    }
    
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur lors de la génération du classement du morpion:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: 'Une erreur est survenue lors de la génération du classement.',
        ephemeral: true
      });
    }
  }
}

// Gestion du jeu High Low
// Gérer les actions du jeu High Low
async function handleHighLowAction(interaction) {
  console.log('[HighLow] handleHighLowAction called');
  console.log('[HighLow] Interaction customId:', interaction.customId);
  
  // Extraire l'action (lower/same/higher) et l'ID de jeu complet
  const actionMatch = interaction.customId.match(/^highlow_(lower|same|higher)_(.*)/);
  if (!actionMatch) {
    console.error('[HighLow] Invalid customId format:', interaction.customId);
    return interaction.reply({ content: '❌ Format de commande invalide.', ephemeral: true });
  }
  
  const action = actionMatch[1];
  const gameId = actionMatch[2];
  console.log('[HighLow] Action:', action, 'Game ID:', gameId);
  
  const game = activeHighLowGames.get(gameId);
  console.log('[HighLow] Game found:', !!game);
  if (game) {
    console.log('[HighLow] Game details:', {
      userId: game.userId,
      currentCard: game.currentCard,
      currentBet: game.currentBet
    });
  }
  
  if (!game) {
    return interaction.update({
      content: '❌ Partie introuvable ou expirée.',
      components: []
    });
  }
  
  if (game.userId !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Ce n\'est pas votre partie !',
      ephemeral: true
    });
  }
  
  // Tirer une nouvelle carte
  console.log('[HighLow] Current card:', game.currentCard);
  const newCard = game.deck.pop();
  console.log('[HighLow] New card drawn:', newCard);
  
  // Utiliser la fonction compareCards pour gérer les comparaisons
  const { result: userWon, sameCard } = compareCards(game.currentCard, newCard, action);
  
  // Déterminer le résultat pour l'affichage
  let result;
  if (sameCard) {
    result = 'same';
  } else {
    const currentValues = getCardValue(game.currentCard);
    const newValues = getCardValue(newCard);
    const maxCurrent = Math.max(...currentValues);
    const maxNew = Math.max(...newValues);
    
    if (maxNew > maxCurrent) result = 'higher';
    else if (maxNew < maxCurrent) result = 'lower';
    else result = 'same';
  }
  
  console.log(`[HighLow] Current: ${game.currentCard.value} (${getCardValue(game.currentCard)}), New: ${newCard.value} (${getCardValue(newCard)}), Action: ${action}, Result: ${result}, Same: ${sameCard}`);
  console.log('[HighLow] User won:', userWon, 'Same card:', sameCard);
  
  // Calculer les gains
  let winnings = 0;
  if (userWon) {
    let multiplier;
    if (sameCard) {
      // Multiplicateur spécial pour un pari sur "égal"
      multiplier = 13.0;
    } else {
      // Définir les multiplicateurs pour les premiers tours
      const multipliers = [1.5, 2.0, 2.3, 2.6, 4.0]; // 5ème tour à x4.0
      const round = game.round || 1; // Commence à 1
      
      // Si on est dans les 5 premiers tours, prendre la valeur du tableau
      // Sinon, continuer à ajouter 0.3 au dernier multiplicateur
      if (round <= multipliers.length) {
        multiplier = multipliers[round - 1];
      } else {
        const lastMultiplier = 4.0; // Dernier multiplicateur fixé à 4.0
        multiplier = lastMultiplier + (0.3 * (round - multipliers.length));
      }
      
      // Arrondir à 1 décimale
      multiplier = Math.round(multiplier * 10) / 10;
    }
    
    // Calculer le gain potentiel total (sans créditer encore)
    const potentialWinnings = Math.floor(game.currentBet * multiplier);
    game.totalWon = potentialWinnings; // Mettre à jour le total potentiel
    
    // Mettre à jour le jeu
    game.currentCard = newCard;
    game.currentMultiplier = multiplier;
    game.round = (game.round || 1) + 1; // Incrémenter le numéro du tour
    game.potentialWinnings = potentialWinnings; // Stocker les gains potentiels
    console.log('[HighLow] Game updated - New multiplier:', multiplier, 'Total won:', game.totalWon);
    
    // Créer les boutons pour continuer ou s'arrêter
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`highlow_stop_${gameId}`)
          .setLabel('🏁 Arrêter')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑'),
        new ButtonBuilder()
          .setCustomId(`highlow_continue_${gameId}`)
          .setLabel('Continuer')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎲')
      );
    console.log('[HighLow] Created decision buttons with gameId:', gameId);
    
    // Mettre à jour le message
    const embed = new EmbedBuilder()
      .setTitle('🎴 High Low - Gagné !')
      .setDescription(`**Nouvelle carte:** ${newCard.value}${newCard.suit}\n\nVoulez-vous continuer ou vous arrêter ?`)
      .addFields(
        { name: 'Mise initiale', value: `${game.currentBet} ${config.currency.emoji}`, inline: true },
        { name: 'Multiplicateur actuel', value: `${game.currentMultiplier.toFixed(1)}x`, inline: true },
        { name: 'Gains potentiels', value: `${Math.floor(game.currentBet * game.currentMultiplier)} ${config.currency.emoji}`, inline: true },
        { name: 'Gains nets actuels', value: `${game.totalWon} ${config.currency.emoji}`, inline: false }
      )
      .setColor(0x2ecc71);
    
    return interaction.update({ embeds: [embed], components: [row] });
  } else {
    // Le joueur a perdu - il perd tout
    console.log('[HighLow] User lost everything. Deleting game.');
    activeHighLowGames.delete(gameId);
    
    const embed = new EmbedBuilder()
      .setTitle('🎴 High Low - Perdu !')
      .setDescription(`**Dernière carte:** ${newCard.value}${newCard.suit}\n\nDommage, vous avez tout perdu (mise + gains potentiels).`)
      .setColor(0xe74c3c);
    
    return interaction.update({ embeds: [embed], components: [] });
  }
}

// Gérer la décision de continuer ou d'arrêter
async function handleHighLowDecision(interaction) {
  console.log('[HighLow] handleHighLowDecision called');
  console.log('[HighLow] Interaction customId:', interaction.customId);
  
  // Extraire la décision (stop/continue) et l'ID de jeu complet
  const decisionMatch = interaction.customId.match(/^highlow_(stop|continue)_(.*)/);
  if (!decisionMatch) {
    console.error('[HighLow] Invalid decision format:', interaction.customId);
    return interaction.reply({ content: '❌ Format de décision invalide.', ephemeral: true });
  }
  
  const decision = decisionMatch[1];
  const gameId = decisionMatch[2];
  console.log('[HighLow] Decision:', decision, 'Game ID:', gameId);
  
  const game = activeHighLowGames.get(gameId);
  console.log('[HighLow] Game found:', !!game);
  if (game) {
    console.log('[HighLow] Game details:', {
      userId: game.userId,
      currentCard: game.currentCard,
      currentBet: game.currentBet,
      totalWon: game.totalWon
    });
  }
  
  if (!game) {
    return interaction.update({
      content: '❌ Partie introuvable ou expirée.',
      components: []
    });
  }
  
  if (decision === 'stop') {
    // Le joueur choisit de s'arrêter - créditer les gains
    console.log('[HighLow] User chose to stop. Total won:', game.totalWon);
    const user = ensureUser(game.userId);
    console.log('[HighLow] User balance before update:', user.balance);
    
    // Créditer les gains totaux (mise initiale + gains)
    updateUser(game.userId, { balance: user.balance + game.totalWon });
    console.log('[HighLow] Credited total winnings:', game.totalWon);
    
    const embed = new EmbedBuilder()
      .setTitle('🎴 High Low - Fin de partie')
      .setDescription(`Vous avez choisi de vous arrêter avec un gain total de **${game.totalWon - game.initialBet} ${config.currency.emoji}** !\n(Mise initiale: ${game.initialBet} + Gains: ${game.totalWon - game.initialBet})`)
      .setColor(0xf1c40f);
    
    activeHighLowGames.delete(gameId);
    console.log('[HighLow] Game deleted after stop');
    return interaction.update({ embeds: [embed], components: [] });
  } else if (decision === 'continue') {
    // Le joueur choisit de continuer
    console.log('[HighLow] User chose to continue. Current multiplier:', game.currentMultiplier);
    console.log('[HighLow] Current card:', game.currentCard);
    // Créer les boutons pour le prochain tour
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`highlow_lower_${gameId}`)
          .setLabel('Plus bas')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⬇️'),
        new ButtonBuilder()
          .setCustomId(`highlow_same_${gameId}`)
          .setLabel('Égal')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🟰'),
        new ButtonBuilder()
          .setCustomId(`highlow_higher_${gameId}`)
          .setLabel('Plus haut')
          .setStyle(ButtonStyle.Success)
          .setEmoji('⬆️')
      );
    console.log('[HighLow] Created action buttons with gameId:', gameId);
    
    const embed = new EmbedBuilder()
      .setTitle('🎴 High Low - Tour suivant')
      .setDescription(`**Carte actuelle:** ${game.currentCard.value}${game.currentCard.suit}\n\nChoisissez si la prochaine carte sera plus haute, plus basse ou égale.`)
      .addFields(
        { name: 'Mise initiale', value: `${game.currentBet} ${config.currency.emoji}`, inline: true },
        { name: 'Multiplicateur actuel', value: `${game.currentMultiplier.toFixed(1)}x`, inline: true },
        { name: 'Gains potentiels', value: `${Math.floor(game.currentBet * game.currentMultiplier)} ${config.currency.emoji}`, inline: true },
        { name: 'Gains nets actuels', value: `${game.totalWon} ${config.currency.emoji}`, inline: false }
      )
      .setColor(0x3498db);
    
    return interaction.update({ embeds: [embed], components: [row] });
  }
}

// Démarrer une nouvelle partie de High Low
async function handleHighLow(interaction) {
  const userId = interaction.user.id;
  const bet = interaction.options.getInteger('mise');
  
  // Vérifier que l'utilisateur a assez d'argent
  const user = ensureUser(userId);
  if (user.balance < bet) {
    return interaction.reply({
      content: `❌ Vous n'avez pas assez de coquillages pour miser ${bet} ${config.currency.emoji} !`,
      ephemeral: true
    });
  }
  
  // Vérifier que la mise ne dépasse pas le maximum autorisé
  if (bet > 10000) {
    return interaction.reply({
      content: `❌ La mise maximale est de 10 000 ${config.currency.emoji} !`,
      ephemeral: true
    });
  }
  
  // Créer un nouveau jeu
  const deck = createDeck();
  const currentCard = deck.pop();
  
  // Retirer la mise du solde de l'utilisateur
  updateUser(userId, { balance: user.balance - bet });
  
  // Enregistrer la partie avec un ID unique
  const gameId = `hl_${Date.now()}_${userId}`;  // Format: hl_timestamp_userId
  console.log('[HighLow] New game created with ID:', gameId);
  activeHighLowGames.set(gameId, {
    userId,
    deck,
    currentCard,
    currentBet: bet,
    currentMultiplier: 1.0, // Commence à 1.0, mais premier tour sera 1.5
    totalWon: 0,
    potentialWinnings: 0, // Gains potentiels actuels
    initialBet: bet, // Sauvegarder la mise initiale séparément
    hasWon: false, // Pour suivre si le joueur a gagné le tour actuel
    round: 1 // Initialisation du compteur de tours
  });
  
  // Créer les boutons avec un ID de jeu encodé
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`highlow_lower_${gameId}`)
        .setLabel('Plus bas')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⬇️'),
      new ButtonBuilder()
        .setCustomId(`highlow_same_${gameId}`)
        .setLabel('Égal')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🟰'),
      new ButtonBuilder()
        .setCustomId(`highlow_higher_${gameId}`)
        .setLabel('Plus haut')
        .setStyle(ButtonStyle.Success)
        .setEmoji('⬆️')
    );
  console.log('[HighLow] Created initial action buttons with gameId:', gameId);
  
  // Envoyer le message
  const embed = new EmbedBuilder()
    .setTitle('🎴 High Low')
    .setDescription(`**Carte actuelle:** ${currentCard.value}${currentCard.suit}\n\nChoisissez si la prochaine carte sera plus haute, plus basse ou égale.`)
    .addFields(
      { name: 'Mise', value: `${bet} ${config.currency.emoji}`, inline: true },
      { name: 'Multiplicateur actuel', value: '1.0x', inline: true },
      { name: 'Gains potentiels', value: `${Math.floor(bet * 1.0)} ${config.currency.emoji}`, inline: true }
    )
    .setColor(0x3498db);
  
  await interaction.reply({ embeds: [embed], components: [row] });
}

module.exports = {
  handleBlackjack: handleBlackjackStart,
  handleTicTacToe,
  handleTicTacToeMove,
  handleHighLow,
  handleHighLowAction,
  handleHighLowDecision,
  activeBlackjackGames,
  activeTicTacToeGames,
  activeHighLowGames,
  handleSlots,
  handleCoinflipSolo,
  handleCoinflipMulti,
  handleShop,
  handlePurchase,
  addMoney,
  handleTicTacToeLeaderboard,
  getTicTacToeLeaderboard
};
