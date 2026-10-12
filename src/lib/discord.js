const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const { env } = require("../env");

let client = null;

const MIGRATION_COLORS = {
  Start: "#00FF00",
  Progress: "#FFA500",
  Complete: "#00FF00",
  Error: "#FF0000",
};

async function initialize() {
  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.DISCORD_BOT_TOKEN);
}

async function sendMigrationUpdate({ channelId, type, message, details = {} }) {
  const channel = await client.channels.fetch(channelId);

  if (!channel) throw new Error("Discord channel not found");

  const embed = new EmbedBuilder()
    .setTitle(`Migration ${type}`)
    .setDescription(message)
    .setColor(MIGRATION_COLORS[type] || "#00FF00")
    .setTimestamp();

  if (details.progress) {
    embed.addFields({
      name: "Progress",
      value: `${details.progress.current}/${details.progress.total} processed`,
    });
  }

  if (details.time) {
    embed.addFields({
      name: "Time",
      value: `${(details.time.total / 1000 / 60).toFixed(2)} minute's.`,
    });
  }

  if (details.error) {
    embed.addFields({
      name: "Error",
      value: details.error,
    });
  }

  await channel.send({ embeds: [embed] });
}

async function destroy() {
  await client.destroy();
  client = null;
}

module.exports = {
  initialize,
  sendMigrationUpdate,
  destroy,
};
