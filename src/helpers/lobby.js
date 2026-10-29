import { EmbedBuilder } from 'discord.js';

// Keep track of active channels to prevent multiple overlapping lobbies or games
export const activeChannels = new Set();

// Supported games that can be hosted via the lobby
export const AVAILABLE_GAMES = ['blackjack'];

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Creates and manages a generic multiplayer lobby for any game.
 * Completely decoupled from game implementations:
 * It handles player opt-ins and then passes the player array to the game event.
 *
 * @param {import('discord.js').Message} message - The triggering message
 * @param {import('discord.js').Client} client - The Discord client
 * @param {string} [gameChoice] - Optional game name (e.g. 'blackjack')
 */
export async function startGenericLobby(message, client, gameChoice = null) {
    const channel = message.channel;
    let host = message.author;

    if (activeChannels.has(channel.id)) {
        return message.reply('⚠️ A game or lobby is already active in this channel! Please finish or wait for it to complete.');
    }

    // Determine which game to play
    let selectedGame = gameChoice ? gameChoice.trim().toLowerCase() : null;

    if (!selectedGame) {
        const gameListText = AVAILABLE_GAMES.map(g => `• **${g}**`).join('\n');
        const promptMsg = await channel.send(
            `🎮 **Choose a Game to Host**\n` +
            `Available games:\n${gameListText}\n\n` +
            `<@${host.id}>, type the name of the game you want to play (or type **cancel** to abort):`
        );

        try {
            const filter = (m) => m.author.id === host.id;
            const collected = await channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
            const replyMsg = collected.first();
            const input = replyMsg.content.trim().toLowerCase();
            replyMsg.delete().catch(() => {});
            promptMsg.delete().catch(() => {});

            if (input === 'cancel' || input === '!cancel') {
                return channel.send('❌ Lobby creation cancelled.');
            }

            if (!AVAILABLE_GAMES.includes(input)) {
                return channel.send(`❌ Unknown game \`${input}\`. Available games are: ${AVAILABLE_GAMES.join(', ')}`);
            }

            selectedGame = input;
        } catch (err) {
            promptMsg.delete().catch(() => {});
            return channel.send('⏰ Lobby creation timed out. No game was selected.');
        }
    } else if (!AVAILABLE_GAMES.includes(selectedGame)) {
        return message.reply(`❌ Unknown game \`${selectedGame}\`. Available games: ${AVAILABLE_GAMES.join(', ')}`);
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
            .setTitle(`🎮 ${capitalize(selectedGame)} Multiplayer Lobby`)
            .setColor('Gold')
            .setDescription(
                `A new **${capitalize(selectedGame)}** lobby has been opened by <@${host.id}>!\n\n` +
                `**Commands:**\n` +
                `• Type **join** or **!join** to take a seat (Max ${MAX_PLAYERS})\n` +
                `• Type **leave** or **!leave** to step away\n` +
                `• Host (<@${host.id}>) can type **start** or **!start** to begin immediately\n` +
                `• Host can type **cancel** or **!cancel** to abort\n\n` +
                `⏳ *Lobby will automatically start in ${LOBBY_TIMEOUT_SECONDS} seconds.*`
            )
            .addFields(
                { name: `Seated Players (${players.length}/${MAX_PLAYERS})`, value: playerList || 'None' }
            );
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
                const fullMsg = await channel.send(`<@${m.author.id}>, the lobby is full! (Max ${MAX_PLAYERS} players)`);
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
                .setTitle(`🎮 ${capitalize(selectedGame)} Lobby Cancelled`)
                .setColor('Red')
                .setDescription('The lobby was cancelled by the host.');
            await lobbyMessage.edit({ embeds: [cancelEmbed] }).catch(() => {});
            return;
        }

        if (reason === 'empty' || players.length === 0) {
            activeChannels.delete(channel.id);
            const emptyEmbed = new EmbedBuilder()
                .setTitle(`🎮 ${capitalize(selectedGame)} Lobby Closed`)
                .setColor('Red')
                .setDescription('All players left the lobby. The game was cancelled.');
            await lobbyMessage.edit({ embeds: [emptyEmbed] }).catch(() => {});
            return;
        }

        // Lobby closed successfully, hand off players to the selected game event
        const startEmbed = new EmbedBuilder()
            .setTitle(`🎮 ${capitalize(selectedGame)} Starting!`)
            .setColor('Green')
            .setDescription(`🎲 Lobby closed! Starting **${capitalize(selectedGame)}** with **${players.length}** player(s)...`);
        await lobbyMessage.edit({ embeds: [startEmbed] }).catch(() => {});

        try {
            const eventHandler = client.events?.get(selectedGame);
            if (eventHandler) {
                await eventHandler(channel, players);
            } else {
                client.emit(selectedGame, channel, players);
            }
        } catch (err) {
            console.error(`Error launching game event '${selectedGame}':`, err);
            channel.send(`❌ An error occurred while launching ${selectedGame}.`);
        } finally {
            activeChannels.delete(channel.id);
        }
    });
}
