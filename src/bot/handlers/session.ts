import TelegramBot from "node-telegram-bot-api";
import { ensureUser, saveSession, getActiveSession } from "../../services/user.js";
import { invalidateUserCache } from "../../channel/manager.js";
import { createLogger } from "../../utils/index.js";
import { env } from "../../config/env.js";

const log = createLogger("handler:session");

/** In-memory state for multi-step session input */
const sessionState = new Map<
  number,
  { step: "sessionId" | "csrfToken" | "cfClearance" | "userAgent"; data: Record<string, string> }
>();

export function registerSessionHandler(bot: TelegramBot): void {
  // /session — start session setup flow
  bot.onText(/\/session/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    if (!telegramId) return;

    if (
      env.ADMIN_USER_IDS.length > 0 &&
      !env.ADMIN_USER_IDS.includes(telegramId)
    ) {
      await bot.sendMessage(chatId, "⛔ Access denied.");
      return;
    }

    sessionState.set(telegramId, { step: "sessionId", data: {} });

    await bot.sendMessage(
      chatId,
      "🔐 *Session Setup*\n\n" +
        "مراحل تنظیم سشن nhentai:\n" +
        "مرورگر خود را باز کنید → DevTools → Application → Cookies → nhentai\\.net\n\n" +
        "لطفاً مقدار `sessionid` را ارسال کنید:",
      { parse_mode: "MarkdownV2" }
    );
  });

  // /session_quick — one-shot session input
  bot.onText(
    /\/session_quick\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.+))?/,
    async (msg, match) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id;
      if (!telegramId || !match) return;

      if (
        env.ADMIN_USER_IDS.length > 0 &&
        !env.ADMIN_USER_IDS.includes(telegramId)
      ) {
        await bot.sendMessage(chatId, "⛔ Access denied.");
        return;
      }

      try {
        const userId = await ensureUser(
          telegramId,
          msg.from?.username,
          msg.from?.first_name
        );

        await saveSession(
          userId,
          match[1],
          match[2],
          match[3],
          match[4] || undefined
        );

        await invalidateUserCache(userId);

        await bot.sendMessage(
          chatId,
          "✅ Session saved successfully!\n\n" +
            "Use /export to generate your favorites PDF."
        );

        // Delete user's message containing sensitive cookies
        try {
          await bot.deleteMessage(chatId, msg.message_id);
        } catch {}
      } catch (err: any) {
        log.error("Quick session error:", err.message);
        await bot.sendMessage(chatId, "❌ Failed to save session.");
      }
    }
  );

  // /status — check current session
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    if (!telegramId) return;

    try {
      const userId = await ensureUser(
        telegramId,
        msg.from?.username,
        msg.from?.first_name
      );
      const session = await getActiveSession(userId);

      if (session) {
        await bot.sendMessage(
          chatId,
          "✅ You have an active session.\n" +
            `Session ID: ${session.sessionId.slice(0, 8)}...\n` +
            `CSRF Token: ${session.csrfToken.slice(0, 8)}...\n\n` +
            "Use /export to generate your PDF."
        );
      } else {
        await bot.sendMessage(
          chatId,
          "⚠️ No active session found.\nUse /session to set up your cookies."
        );
      }
    } catch (err: any) {
      log.error("Status error:", err.message);
      await bot.sendMessage(chatId, "❌ An error occurred.");
    }
  });
}

/**
 * Handle text messages that might be part of the session setup flow.
 * Returns true if the message was consumed by this handler.
 */
export function handleSessionStep(
  bot: TelegramBot,
  msg: TelegramBot.Message
): boolean {
  const telegramId = msg.from?.id;
  if (!telegramId) return false;

  const state = sessionState.get(telegramId);
  if (!state) return false;

  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";
  if (!text || text.startsWith("/")) {
    sessionState.delete(telegramId);
    return false;
  }

  (async () => {
    try {
      // Delete sensitive message
      try {
        await bot.deleteMessage(chatId, msg.message_id);
      } catch {}

      if (state.step === "sessionId") {
        state.data.sessionId = text;
        state.step = "csrfToken";
        await bot.sendMessage(
          chatId,
          "✅ sessionid received.\n\nلطفاً مقدار `csrftoken` را ارسال کنید:",
          { parse_mode: "MarkdownV2" }
        );
      } else if (state.step === "csrfToken") {
        state.data.csrfToken = text;
        state.step = "cfClearance";
        await bot.sendMessage(
          chatId,
          "✅ csrftoken received.\n\nلطفاً مقدار `cf_clearance` را ارسال کنید:",
          { parse_mode: "MarkdownV2" }
        );
      } else if (state.step === "cfClearance") {
        state.data.cfClearance = text;
        state.step = "userAgent";
        await bot.sendMessage(
          chatId,
          "✅ cf_clearance received.\n\n" +
            "User-Agent خود را ارسال کنید (اختیاری).\n" +
            "برای رد شدن /skip را بزنید:",
        );
      } else if (state.step === "userAgent") {
        state.data.userAgent = text;

        // Save session
        const userId = await ensureUser(
          telegramId,
          msg.from?.username,
          msg.from?.first_name
        );

        await saveSession(
          userId,
          state.data.sessionId,
          state.data.csrfToken,
          state.data.cfClearance,
          state.data.userAgent
        );

        await invalidateUserCache(userId);
        sessionState.delete(telegramId);

        await bot.sendMessage(
          chatId,
          "✅ Session saved successfully!\n\n" +
            "Now use /export to get your favorites as PDF."
        );
      }
    } catch (err: any) {
      log.error("Session step error:", err.message);
      sessionState.delete(telegramId);
      await bot.sendMessage(chatId, "❌ Error during session setup.");
    }
  })();

  return true;
}

/** Handle /skip during session setup */
export function registerSkipHandler(bot: TelegramBot): void {
  bot.onText(/\/skip/, async (msg) => {
    const telegramId = msg.from?.id;
    if (!telegramId) return;

    const state = sessionState.get(telegramId);
    if (!state || state.step !== "userAgent") return;

    const chatId = msg.chat.id;

    try {
      const userId = await ensureUser(
        telegramId,
        msg.from?.username,
        msg.from?.first_name
      );

      await saveSession(
        userId,
        state.data.sessionId,
        state.data.csrfToken,
        state.data.cfClearance
      );

      await invalidateUserCache(userId);
      sessionState.delete(telegramId);

      await bot.sendMessage(
        chatId,
        "✅ Session saved (default User-Agent used).\n\n" +
          "Use /export to generate your PDF."
      );
    } catch (err: any) {
      log.error("Skip handler error:", err.message);
      sessionState.delete(telegramId);
      await bot.sendMessage(chatId, "❌ Error saving session.");
    }
  });
}
