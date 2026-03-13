import TelegramBot from "node-telegram-bot-api";
import { createLogger } from "../../utils/index.js";

const log = createLogger("middleware:logging");

/** Log every incoming message */
export function loggingMiddleware(msg: TelegramBot.Message): void {
  const from = msg.from;
  const text = msg.text || "[non-text]";
  log.info(
    `[${from?.id}] @${from?.username || "?"} (${from?.first_name || "?"}): ${text.slice(0, 100)}`
  );
}
