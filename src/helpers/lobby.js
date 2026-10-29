import { EmbedBuilder } from 'discord.js';

// Keep track of active channels to prevent multiple overlapping lobbies or games
export const activeChannels = new Set();

/**
 * Creates and manages a multiplayer lobby for Blackjack.
 * Stays open to allow users to opt-in with 'join' / '!join',
 * and when started, passes the player list to the game handler.
 *
 * @param {import('discord.js').Message} message - The initial command message
 * @param {import('discord.js').Client} client - The Discord client
 * @param {Function} [gameStarter] - Callback function (channel, players) => Promise<void>
 */
export async function startLobby(message, client, gameStarter) {
    const channel = message.channel;
    let host = message.author;

    if (activeChannels.has(channel.id)) {
        return message.reply('⚠️ A game or lobby is already active in this channel! Please finish or wait for it to complete.');
    }

    activeChannels.add(channel.id);

    const MAX_PLAYERS = 7;
    const LOBBY_TIMEOUT_SECONDS = 60;

    // The host starts seated in the lobby
    let players = [
        {
            id: host.id,
            username: host.username,
            displayName: message.member?.displayName || host.username,
            user: host
        }
    ];

    const buildLobbyEmbed = () => {
        const playerList = players
            .map((p, index) => `${index + 1}. <@${p.id}> (${p.displayName})${p.id === host.id ? ' 👑 *(Host)*' : ''}`)
            .join('\n');

        return new EmbedBuilder()
            .setTitle('♠️♥️ Blackjack Multiplayer Lobby ♣️♦️')
            .setColor('Gold')
            .setDescription(
                `A new Blackjack table has been opened by <@${host.id}>!\n\n` +
                `**Commands:**\n` +
                `• Type **join** or **!join** to take a seat (Max ${MAX_PLAYERS})\n` +
                `• Type **leave** or **!leave** to step away\n` +
                `• Host (<@${host.id}>) can type **start** or **!start** to begin immediately\n` +
                `• Host can type **cancel** or **!cancel** to abort\n\n` +
                `⏳ *Lobby will automatically start in ${LOBBY_TIMEOUT_SECONDS} seconds.*`
            )
            .addFields(
                { name: `Seated Players (${players.length}/${MAX_PLAYERS})`, value: playerList || 'None' }
            )
            .setFooter({ text: 'Each player will be dealt cards and prompted for hit/stand in turn!' });
    };

    let lobbyMessage;
    try {
        lobbyMessage = await channel.send({ embeds: [buildLobbyEmbed()] });
    } catch (err) {
        activeChannels.delete(channel.id);
        console.error('Failed to send lobby message:', err);
        return;
    }

    const filter = (m) => !m.author.bot;
    const collector = channel.createMessageCollector({ filter, time: LOBBY_TIMEOUT_SECONDS * 1000 });

    collector.on('collect', async (m) => {
        const content = m.content.trim().toLowerCase();

        // JOIN COMMAND
        if (content === 'join' || content === '!join') {
            m.delete().catch(() => {});

            if (players.some(p => p.id === m.author.id)) {
                const alreadyMsg = await channel.send(`<@${m.author.id}>, you are already in the lobby!`);
                setTimeout(() => alreadyMsg.delete().catch(() => {}), 3000);
                return;
            }

            if (players.length >= MAX_PLAYERS) {
                const fullMsg = await channel.send(`<@${m.author.id}>, the table is full! (Max ${MAX_PLAYERS} players)`);
                setTimeout(() => fullMsg.delete().catch(() => {}), 4000);
                return;
            }

            players.push({
                id: m.author.id,
                username: m.author.username,
                displayName: m.member?.displayName || m.author.username,
                user: m.author
            });

            await lobbyMessage.edit({ embeds: [buildLobbyEmbed()] }).catch(() => {});
        }

        // LEAVE COMMAND
        else if (content === 'leave' || content === '!leave') {
            m.delete().catch(() => {});

            if (!players.some(p => p.id === m.author.id)) return;

            players = players.filter(p => p.id !== m.author.id);

            if (players.length === 0) {
                collector.stop('empty');
                return;
            }

            // If the host leaves, pass host crown to next player
            if (m.author.id === host.id) {
                host = players[0].user;
                const newHostMsg = await channel.send(`👑 <@${m.author.id}> left. <@${host.id}> is the new lobby host!`);
                setTimeout(() => newHostMsg.delete().catch(() => {}), 5000);
            }

            await lobbyMessage.edit({ embeds: [buildLobbyEmbed()] }).catch(() => {});
        }

        // START COMMAND
        else if (content === 'start' || content === '!start') {
            m.delete().catch(() => {});

            if (m.author.id === host.id) {
                collector.stop('started');
            } else if (players.some(p => p.id === m.author.id)) {
                const hostOnlyMsg = await channel.send(`<@${m.author.id}>, only the host (<@${host.id}>) can start early!`);
                setTimeout(() => hostOnlyMsg.delete().catch(() => {}), 4000);
            }
        }

        // CANCEL COMMAND
        else if (content === 'cancel' || content === '!cancel') {
            m.delete().catch(() => {});

            if (m.author.id === host.id) {
                collector.stop('cancelled');
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'cancelled') {
            activeChannels.delete(channel.id);
            const cancelEmbed = new EmbedBuilder()
                .setTitle('♠️♥️ Blackjack Lobby Cancelled ♣️♦️')
                .setColor('Red')
                .setDescription('The lobby was cancelled by the host.');
            await lobbyMessage.edit({ embeds: [cancelEmbed] }).catch(() => {});
            return;
        }

        if (reason === 'empty' || players.length === 0) {
            activeChannels.delete(channel.id);
            const emptyEmbed = new EmbedBuilder()
                .setTitle('♠️♥️ Blackjack Lobby Closed ♣️♦️')
                .setColor('Red')
                .setDescription('All players left the lobby. The game was cancelled.');
            await lobbyMessage.edit({ embeds: [emptyEmbed] }).catch(() => {});
            return;
        }

        // Lobby successfully closed, begin game with the collected players
        const startEmbed = new EmbedBuilder()
            .setTitle('♠️♥️ Blackjack Starting! ♣️♦️')
            .setColor('Green')
            .setDescription(`🎲 Lobby closed! Starting game with **${players.length}** player(s)...`);
        await lobbyMessage.edit({ embeds: [startEmbed] }).catch(() => {});

        try {
            if (typeof gameStarter === 'function') {
                await gameStarter(channel, players);
            } else {
                const blackjackModule = require('../events/blackjack');
                const runGame = blackjackModule.runBlackjackGame || blackjackModule.default?.runBlackjackGame;
                if (runGame) {
                    await runGame(channel, players);
                } else {
                    console.error('No gameStarter provided and runBlackjackGame not found');
                }
            }
        } catch (err) {
            console.error('Error running blackjack game:', err);
            channel.send('❌ An error occurred during the Blackjack game.');
        } finally {
            activeChannels.delete(channel.id);
        }
    });
}

