import { userMention } from "discord.js";
import { loadDB } from "../helpers/manDataBase";
import { startGenericLobby, activeChannels } from "../helpers/lobby";

// type !testwelcome to test bot functionality
// type !checkusers to check that users are being saved to the database
// type !lobby [game] to open a multiplayer lobby
// type !blackjack to start a solo game
const event = {
  name: "messageCreate",
  async execute(message, client) {
    if (message.author.bot) return; // prevent infinite loop
    const content = message.content.trim();

    if (content === "!testwelcome") {
      client.emit("guildMemberAdd", message.member);
    }

    if (content === "!checkusers") {
      await message.reply(await getUsersReport(message.author.id));
    }

    // Generic Multiplayer Lobby command: !lobby or !lobby <game>
    if (content === "!lobby" || content.startsWith("!lobby ")) {
      const parts = content.split(/\s+/);
      const gameChoice = parts[1] || null;
      await startGenericLobby(message, client, gameChoice);
    }

    // Direct Solo Blackjack command: passes author as a 1-player list to the blackjack event
    if (content === "!blackjack") {
      if (activeChannels.has(message.channel.id)) {
        return message.reply("⚠️ A game or lobby is already active in this channel! Please finish or wait for it to complete.");
      }
      const player = {
        id: message.author.id,
        username: message.author.username,
        displayName: message.member?.displayName || message.author.username,
        user: message.author,
      };
      client.emit("blackjack", message.channel, [player]);
    }
  },
};

const getUsersReport = async (authorId) => {
  const database = await loadDB();
  const users = database.users.filter((u) => u.user_id); // skip empty entries
  const you = users.find((u) => u.user_id === authorId);

  // only list the first 20 so the reply stays under discord's 2000 char limit
  const userList = users
    .slice(0, 20)
    .map((u) => `• ${userMention(u.user_id)} - coins: ${u.coins}, `)
    .join("\n");

  return {
    content: `**Users in database:** ${users.length}
${userList || "(none)"}${users.length > 20 ? `\n...and ${users.length - 20} more` : ""}

**You:** ${you ? `registered \`${JSON.stringify(you)}\`` : "not registered"}`,
    allowedMentions: { parse: [] }, // don't ping everyone in the list
  };
};

export default event;
