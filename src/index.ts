import "dotenv/config";
import { createBot, startBot, stopBot } from "./bot/index.js";
import { getDb, closeDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { createLogger } from "./utils/index.js";

const log = createLogger("main");

async function main() {
  log.info("nsaver v3.0.0 starting...");

  // Run DB migrations on startup (external MySQL)
  try {
    await runMigrations();
    log.info("Database migrations completed.");
  } catch (err: any) {
    log.error("Migration failed:", err.message);
    log.error("Make sure MySQL is running and configured in .env");
    process.exit(1);
  }

  // Verify DB connection
  try {
    const db = getDb();
    log.info("Database connected.");
  } catch (err: any) {
    log.error("Database connection failed:", err.message);
    log.error(
      "Make sure MySQL is running and configured in .env"
    );
    process.exit(1);
  }

  // Create and start the bot
  const bot = createBot();
  await startBot(bot);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    await stopBot(bot);
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep alive
  log.info("Bot is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
