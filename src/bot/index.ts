import TelegramBot from "node-telegram-bot-api";
import { env } from "../config/env.js";
import { createLogger } from "../utils/index.js";
import {
  registerStartHandler,
  registerSessionHandler,
  registerSkipHandler,
  registerExportHandler,
  registerFilterHandler,
  handleSessionStep,
} from "./handlers/index.js";
import { loggingMiddleware } from "./middleware/index.js";

const log = createLogger("bot");

export function createBot(): TelegramBot {
  log.info("Creating bot with polling...");

  const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, {
    polling: {
      autoStart: false,
      interval: 1000,
      params: {
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      },
    },
  });

  // Register middleware (runs on every message)
  bot.on("message", (msg) => {
    loggingMiddleware(msg);
  });

  // Register command handlers
  registerStartHandler(bot);
  registerSessionHandler(bot);
  registerSkipHandler(bot);
  registerExportHandler(bot);
  registerFilterHandler(bot);

  // Handle non-command text messages (for session setup flow)
  bot.on("message", (msg) => {
    if (msg.text && !msg.text.startsWith("/")) {
      handleSessionStep(bot, msg);
    }
  });

  // Error handling
  bot.on("polling_error", (err) => {
    log.error("Polling error:", err.message);
  });

  bot.on("error", (err) => {
    log.error("Bot error:", err.message);
  });

  return bot;
}

export async function startBot(bot: TelegramBot): Promise<void> {
  log.info("Starting polling...");
  await bot.startPolling();

  const me = await bot.getMe();
  log.info(`Bot started: @${me.username} (${me.id})`);
}

export async function stopBot(bot: TelegramBot): Promise<void> {
  log.info("Stopping bot...");
  await bot.stopPolling();
  log.info("Bot stopped.");
}
