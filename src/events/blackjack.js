import { EmbedBuilder } from 'discord.js';
import { activeChannels } from '../helpers/lobby';

/**
 * Creates and shuffles a shoe of cards.
 * Scales deck count based on player count so cards never run out.
 */
function createDeck(numDecks = 2) {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];

    for (let d = 0; d < numDecks; d++) {
        for (const suit of suits) {
            for (const value of values) {
                deck.push({ suit, value });
            }
        }
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * Calculates score of a hand, handling Aces dynamically (11 or 1).
 */
function calculateScore(hand) {
    let score = 0;
    let aces = 0;

    for (const card of hand) {
        if (card.value === 'A') {
            aces += 1;
            score += 11;
        } else if (['J', 'Q', 'K'].includes(card.value)) {
            score += 10;
        } else {
            score += parseInt(card.value, 10);
        }
    }

    while (score > 21 && aces > 0) {
        score -= 10;
        aces -= 1;
    }
    return score;
}

/**
 * Formats a hand of cards into readable text.
 */
function formatHand(hand, hideSecondCard = false) {
    if (!hand || hand.length === 0) return '*(No cards)*';
    if (hideSecondCard) {
        return `${hand[0].value}${hand[0].suit}, ❓`;
    }
    return hand.map(card => `${card.value}${card.suit}`).join(', ');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Builds the visual table embed showing dealer and all player hands.
 */
function buildTableEmbed({
    players,
    botHand,
    hideBotCard = true,
    activePlayerId = null,
    stageDescription = '',
    color = 'Blurple'
}) {
    const embed = new EmbedBuilder()
        .setTitle('♠️♥️ Blackjack Table ♣️♦️')
        .setColor(color)
        .setDescription(stageDescription || 'Blackjack in progress...');

    // Dealer Field
    const botScore = botHand.length > 0
        ? (hideBotCard ? calculateScore([botHand[0]]) : calculateScore(botHand))
        : 0;
    const botHandStr = botHand.length > 0 ? formatHand(botHand, hideBotCard) : '*(Dealing...)*';

    embed.addFields({
        name: `🤖 Dealer's Hand (Score: ${botScore}${hideBotCard ? ' + ?' : ''})`,
        value: botHandStr,
        inline: false
    });

    // Players Fields
    for (const player of players) {
        let statusTag = '';
        if (player.id === activePlayerId) {
            statusTag = '👉 **[CURRENT TURN]**';
        } else if (player.status === 'bust') {
            statusTag = '💥 **[BUST]**';
        } else if (player.status === 'stand') {
            statusTag = '🛑 **[STOOD]**';
        } else if (player.status === 'blackjack') {
            statusTag = '🌟 **[BLACKJACK]**';
        } else {
            statusTag = '⏳ **[WAITING]**';
        }

        const handStr = player.hand.length > 0 ? formatHand(player.hand) : '*(Dealing...)*';
        embed.addFields({
            name: `${player.displayName} (Score: ${player.score})`,
            value: `${statusTag}\nCards: ${handStr}`,
            inline: players.length > 1
        });
    }

    return embed;
}

/**
 * Unified Blackjack Game Flow.
 * Handles 1 player or multiple players naturally based on the players array.
 *
 * @param {import('discord.js').TextChannel} channel - The Discord channel
 * @param {Array<{id: string, username: string, displayName: string, user: any}>} players - The players
 */
export async function runBlackjackGame(channel, players) {
    const isChannelLockedByUs = !activeChannels.has(channel.id);
    if (isChannelLockedByUs) {
        activeChannels.add(channel.id);
    }

    try {
        const isMultiplayer = players.length > 1;
        const numDecks = Math.max(2, Math.ceil(players.length / 3));
        const deck = createDeck(numDecks);

        const playerStates = players.map(p => ({
            id: p.id,
            user: p.user,
            displayName: p.displayName || p.username,
            hand: [],
            score: 0,
            status: 'waiting', // waiting, playing, stand, bust, blackjack
        }));

        const botHand = [];

        // Initial Table Message
        const gameMessage = await channel.send({
            embeds: [
                buildTableEmbed({
                    players: playerStates,
                    botHand: [],
                    hideBotCard: true,
                    stageDescription: isMultiplayer
                        ? '🃏 **Table is ready! Dealing cards person by person...**'
                        : '🃏 **Dealing cards...**',
                    color: 'Blurple'
                })
            ]
        });

        if (isMultiplayer) await sleep(1200);

        // =====================================================================
        // STAGE 1: DEALING CARDS
        // =====================================================================
        for (const player of playerStates) {
            player.hand.push(deck.pop());
            player.hand.push(deck.pop());
            player.score = calculateScore(player.hand);

            if (player.score === 21) {
                player.status = 'blackjack';
            }

            if (isMultiplayer) {
                await gameMessage.edit({
                    embeds: [
                        buildTableEmbed({
                            players: playerStates,
                            botHand,
                            hideBotCard: true,
                            stageDescription: `🃏 Dealt 2 cards to **${player.displayName}**...`,
                            color: 'Blurple'
                        })
                    ]
                });
                await sleep(1000);
            }
        }

        // Deal dealer's 2 cards (one face-up, one hidden)
        botHand.push(deck.pop());
        botHand.push(deck.pop());

        await gameMessage.edit({
            embeds: [
                buildTableEmbed({
                    players: playerStates,
                    botHand,
                    hideBotCard: true,
                    stageDescription: isMultiplayer
                        ? `🃏 Dealt cards to the **Dealer** (one card hidden).\nAll cards dealt! Moving to player turns...`
                        : `🃏 Cards dealt! Your turn.`,
                    color: 'Blurple'
                })
            ]
        });

        if (isMultiplayer) await sleep(1500);

        // =====================================================================
        // STAGE 2: PLAYER TURNS (PERSON BY PERSON)
        // =====================================================================
        for (const player of playerStates) {
            if (player.status === 'blackjack') {
                await channel.send(`🌟 <@${player.id}> has **Natural Blackjack (21)!**`);
                await sleep(1200);
                continue;
            }

            player.status = 'playing';

            await gameMessage.edit({
                embeds: [
                    buildTableEmbed({
                        players: playerStates,
                        botHand,
                        hideBotCard: true,
                        activePlayerId: player.id,
                        stageDescription: `👉 **<@${player.id}>'s Turn!**\nType **hit** to draw a card, or **stand** to keep your hand.\n*(Timeout: 45s)*`,
                        color: 'Gold'
                    })
                ]
            });

            const turnPrompt = await channel.send(`<@${player.id}>, it's your turn! Type **hit** or **stand**.`);

            while (player.status === 'playing') {
                try {
                    const filter = (m) => m.author.id === player.id && ['hit', 'stand'].includes(m.content.trim().toLowerCase());
                    const collected = await channel.awaitMessages({
                        filter,
                        max: 1,
                        time: 45000,
                        errors: ['time']
                    });

                    const userMsg = collected.first();
                    const choice = userMsg.content.trim().toLowerCase();
                    userMsg.delete().catch(() => {});

                    if (choice === 'hit') {
                        const card = deck.pop();
                        player.hand.push(card);
                        player.score = calculateScore(player.hand);

                        if (player.score > 21) {
                            player.status = 'bust';
                            await channel.send(`💥 **BUST!** <@${player.id}> drew ${card.value}${card.suit} and busted with **${player.score}**!`);
                        } else if (player.score === 21) {
                            player.status = 'stand';
                            await channel.send(`🎯 **21!** <@${player.id}> drew ${card.value}${card.suit} and hit **21**! Automatically standing.`);
                        } else {
                            await channel.send(`<@${player.id}> drew **${card.value}${card.suit}**. Hand: ${formatHand(player.hand)} (Score: **${player.score}**). Hit or stand?`);
                        }
                    } else if (choice === 'stand') {
                        player.status = 'stand';
                        await channel.send(`🛑 <@${player.id}> stands with a score of **${player.score}**.`);
                    }

                    await gameMessage.edit({
                        embeds: [
                            buildTableEmbed({
                                players: playerStates,
                                botHand,
                                hideBotCard: true,
                                activePlayerId: player.status === 'playing' ? player.id : null,
                                stageDescription: `👉 **<@${player.id}>'s Turn** (Score: ${player.score})`,
                                color: player.status === 'bust' ? 'Red' : 'Gold'
                            })
                        ]
                    });
                } catch (err) {
                    player.status = 'stand';
                    await channel.send(`⏰ <@${player.id}> ran out of time! Standing automatically with score of **${player.score}**.`);
                    await gameMessage.edit({
                        embeds: [
                            buildTableEmbed({
                                players: playerStates,
                                botHand,
                                hideBotCard: true,
                                activePlayerId: null,
                                stageDescription: `⏰ <@${player.id}> timed out and stood with ${player.score}.`,
                                color: 'Gold'
                            })
                        ]
                    });
                }
            }

            turnPrompt.delete().catch(() => {});
            if (isMultiplayer) await sleep(1200);
        }

        // =====================================================================
        // STAGE 3: DEALER TURN
        // =====================================================================
        let botScore = calculateScore(botHand);
        const anyPlayerAlive = playerStates.some(p => p.status !== 'bust');

        await gameMessage.edit({
            embeds: [
                buildTableEmbed({
                    players: playerStates,
                    botHand,
                    hideBotCard: false,
                    stageDescription: `🤖 **Dealer's Turn!** Revealing hidden card... Dealer shows **${botScore}**.`,
                    color: 'Blurple'
                })
            ]
        });
        await sleep(1500);

        if (!anyPlayerAlive) {
            await channel.send(`🤖 All players busted! Dealer wins against all hands.`);
            await sleep(1000);
        } else {
            while (botScore < 17) {
                const card = deck.pop();
                botHand.push(card);
                botScore = calculateScore(botHand);

                await gameMessage.edit({
                    embeds: [
                        buildTableEmbed({
                            players: playerStates,
                            botHand,
                            hideBotCard: false,
                            stageDescription: `🤖 Dealer hits and draws **${card.value}${card.suit}** (Score: ${botScore})...`,
                            color: 'Blurple'
                        })
                    ]
                });
                await sleep(1500);
            }

            if (botScore > 21) {
                await channel.send(`💥 **DEALER BUSTED** with a score of **${botScore}**!`);
            } else {
                await channel.send(`🤖 Dealer stands with a score of **${botScore}**.`);
            }
            await sleep(1000);
        }

        // =====================================================================
        // STAGE 4: RESULTS & OUTCOMES
        // =====================================================================
        const resultsEmbed = new EmbedBuilder()
            .setTitle('♠️♥️ Blackjack - Final Results ♣️♦️')
            .setDescription(
                `**Dealer Final Hand:** ${formatHand(botHand)} (Score: **${botScore}**${botScore > 21 ? ' - BUST' : ''})\n\n` +
                `Here are the results:`
            );

        let anyWinner = false;
        let allLoss = true;

        for (const player of playerStates) {
            let outcome = '';

            if (player.status === 'bust') {
                outcome = '💥 **Bust (Lost)**';
            } else if (player.status === 'blackjack') {
                if (botScore === 21 && botHand.length === 2) {
                    outcome = '🤝 **Push** (Both dealer and player got Blackjack!)';
                    allLoss = false;
                } else {
                    outcome = '🌟 **BLACKJACK! You Win!** 🎉';
                    anyWinner = true;
                    allLoss = false;
                }
            } else if (botScore > 21) {
                outcome = '🎉 **Win!** (Dealer Busted)';
                anyWinner = true;
                allLoss = false;
            } else if (player.score > botScore) {
                outcome = `🎉 **Win!** (${player.score} vs ${botScore})`;
                anyWinner = true;
                allLoss = false;
            } else if (player.score < botScore) {
                outcome = `😔 **Lost** (${player.score} vs ${botScore})`;
            } else {
                outcome = `🤝 **Push** (Tied at ${player.score})`;
                allLoss = false;
            }

            resultsEmbed.addFields({
                name: `${player.displayName}`,
                value: `Hand: ${formatHand(player.hand)}\nFinal Score: **${player.score}**\nResult: ${outcome}`,
                inline: isMultiplayer
            });
        }

        resultsEmbed.setColor(anyWinner ? 'Green' : allLoss ? 'Red' : 'Yellow');

        await channel.send({ embeds: [resultsEmbed] });
    } finally {
        if (isChannelLockedByUs) {
            activeChannels.delete(channel.id);
        }
    }
}

export default {
    name: 'blackjack',
    async execute(channel, players) {
        await runBlackjackGame(channel, players);
    },
};
