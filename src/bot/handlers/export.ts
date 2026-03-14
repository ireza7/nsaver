import TelegramBot from "node-telegram-bot-api";
import { ensureUser, getActiveSession } from "../../services/user.js";
import { saveGalleries } from "../../services/gallery.js";
import {
  uploadToChannel,
  findCachedExport,
  forwardCachedExport,
} from "../../channel/manager.js";
import { scrapeFavorites, filterGalleries } from "../../scraper/index.js";
import { downloadAndZipGallery, cleanupZip } from "../../zip/index.js";
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
        await forwardCachedExport(bot, chatId, cached.fileId, cached.description);
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

      // For export, download + zip the first gallery that has imagePages
      // (single gallery ZIP per export, matching nZip behaviour)
      const galleryWithImages = filtered.find(
        (g) => g.mediaId && g.imagePages.length > 0
      );

      if (!galleryWithImages) {
        await bot.editMessageText(
          "⚠️ No galleries with downloadable images found.",
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      await bot.editMessageText(
        `📥 Downloading ${galleryWithImages.imagePages.length} images for #${galleryWithImages.id}...`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );

      const username = msg.from?.username || `user_${telegramId}`;
      const firstName = msg.from?.first_name || "User";
      const filterInfo = maxCount ? `Max: ${maxCount}` : undefined;

      const zipResult = await downloadAndZipGallery(
        galleryWithImages,
        async (completed, total) => {
          if (completed % 10 === 0 || completed === total) {
            try {
              await bot.editMessageText(
                `📥 Downloading images... ${completed}/${total}`,
                { chat_id: chatId, message_id: statusMsg.message_id }
              );
            } catch {}
          }
        },
        async () => {
          try {
            await bot.editMessageText(
              `📦 Packing ZIP...`,
              { chat_id: chatId, message_id: statusMsg.message_id }
            );
          } catch {}
        }
      );

      try {
        // Upload cover + ZIP to channel
        const channelResult = await uploadToChannel(
          bot,
          zipResult.zipPath,
          zipResult.coverImagePath,
          userId,
          username,
          firstName,
          filtered,
          filterHash,
          filterInfo
        );

        // Forward ZIP to user
        await forwardCachedExport(bot, chatId, channelResult.fileId);

        await bot.editMessageText(
          `✅ Done! Gallery #${galleryWithImages.id} exported as ZIP.` +
            (result.errors.length > 0
              ? `\n⚠️ ${result.errors.length} errors occurred.`
              : ""),
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
      } finally {
        cleanupZip(zipResult.zipPath);
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
