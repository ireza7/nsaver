import TelegramBot from "node-telegram-bot-api";
import { ensureUser, getActiveSession } from "../../services/user.js";
import { saveGalleries, getUserGalleries } from "../../services/gallery.js";
import {
  uploadToChannel,
  findCachedExport,
  forwardCachedExport,
} from "../../channel/manager.js";
import { scrapeFavorites, filterGalleries } from "../../scraper/index.js";
import { generatePdf, cleanupPdf } from "../../pdf/index.js";
import { createLogger, hashFilters } from "../../utils/index.js";
import { env } from "../../config/env.js";
import type { FilterOptions, NhentaiSession } from "../../types/index.js";

const log = createLogger("handler:export");

/** Active export locks to prevent duplicate runs */
const exportLocks = new Set<number>();

export function registerExportHandler(bot: TelegramBot): void {
  // /export [maxCount] — export all favorites
  bot.onText(/\/export(?:\s+(\d+))?/, async (msg, match) => {
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

    if (exportLocks.has(telegramId)) {
      await bot.sendMessage(
        chatId,
        "⏳ An export is already running. Please wait."
      );
      return;
    }

    try {
      exportLocks.add(telegramId);

      const userId = await ensureUser(
        telegramId,
        msg.from?.username,
        msg.from?.first_name
      );

      const session = await getActiveSession(userId);
      if (!session) {
        await bot.sendMessage(
          chatId,
          "⚠️ No active session. Use /session first."
        );
        return;
      }

      const maxCount = match?.[1]
        ? parseInt(match[1], 10)
        : env.MAX_GALLERIES_PER_PDF;

      const filters: FilterOptions = { maxCount };
      const filterHash = hashFilters(userId, filters);

      // Check channel cache first
      const cached = await findCachedExport(userId, filterHash);
      if (cached) {
        await bot.sendMessage(chatId, "📦 Found cached export, forwarding...");
        // Try to get first gallery for cover from DB
        const userGalleries = await getUserGalleries(userId);
        const coverGallery = userGalleries.length > 0 ? userGalleries[0] : undefined;
        await forwardCachedExport(bot, chatId, cached.fileId, coverGallery, cached.description);
        return;
      }

      // Start scraping
      const statusMsg = await bot.sendMessage(
        chatId,
        "🔄 Scraping favorites... (this may take a while)"
      );

      const nhSession: NhentaiSession = {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        cfClearance: session.cfClearance,
        userAgent: session.userAgent || undefined,
      };

      const result = await scrapeFavorites(nhSession, async (current, total) => {
        // Update progress every 5 pages
        if (current % 5 === 0 || current === total) {
          try {
            await bot.editMessageText(
              `🔄 Scraping... ${current}/${total}`,
              { chat_id: chatId, message_id: statusMsg.message_id }
            );
          } catch {}
        }
      });

      if (result.galleries.length === 0) {
        await bot.editMessageText(
          "⚠️ No favorites found. Check your session cookies.",
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      // Save to DB
      await saveGalleries(userId, result.galleries);

      // Apply filters
      const filtered = filterGalleries(result.galleries, filters);

      await bot.editMessageText(
        `📝 Generating PDF for ${filtered.length} galleries...`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );

      // Generate PDF
      const username = msg.from?.username || `user_${telegramId}`;
      const firstName = msg.from?.first_name || "User";
      const filterInfo = maxCount
        ? `Max: ${maxCount}`
        : undefined;

      const pdfPath = await generatePdf(filtered, username, filterInfo);

      try {
        // Upload cover + PDF to channel
        const channelResult = await uploadToChannel(
          bot,
          pdfPath,
          userId,
          username,
          firstName,
          filtered,
          filterHash,
          filterInfo
        );

        // Forward cover + PDF to user
        const coverGallery = filtered.length > 0 ? filtered[0] : undefined;
        await forwardCachedExport(bot, chatId, channelResult.fileId, coverGallery);

        await bot.editMessageText(
          `✅ Done! ${filtered.length} galleries exported.` +
            (result.errors.length > 0
              ? `\n⚠️ ${result.errors.length} errors occurred.`
              : ""),
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
      } finally {
        cleanupPdf(pdfPath);
      }
    } catch (err: any) {
      log.error("Export error:", err.message);
      await bot.sendMessage(
        chatId,
        `❌ Export failed: ${err.message}`
      );
    } finally {
      exportLocks.delete(telegramId);
    }
  });
}
