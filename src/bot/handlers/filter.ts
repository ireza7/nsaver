import TelegramBot from "node-telegram-bot-api";
import { ensureUser, getActiveSession } from "../../services/user.js";
import { saveGalleries } from "../../services/gallery.js";
import {
  uploadToChannel,
  findCachedExport,
  forwardCachedExport,
} from "../../channel/manager.js";
import {
  scrapeFavorites,
  filterGalleries,
  extractUniqueTags,
  getTopTags,
} from "../../scraper/index.js";
import { generatePdf, cleanupPdf } from "../../pdf/index.js";
import { createLogger, hashFilters } from "../../utils/index.js";
import { env } from "../../config/env.js";
import type { FilterOptions, NhentaiSession } from "../../types/index.js";

const log = createLogger("handler:filter");

export function registerFilterHandler(bot: TelegramBot): void {
  // /filter tag1,tag2 [maxCount] — export filtered by tags
  bot.onText(/\/filter\s+(.+)/, async (msg, match) => {
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

      const session = await getActiveSession(userId);
      if (!session) {
        await bot.sendMessage(
          chatId,
          "⚠️ No active session. Use /session first."
        );
        return;
      }

      // Parse filter arguments
      const args = match[1].trim();
      const parts = args.split(/\s+/);
      let maxCount: number | undefined;
      let tagsPart = args;

      // Check if last part is a number (maxCount)
      const lastPart = parts[parts.length - 1];
      if (/^\d+$/.test(lastPart) && parts.length > 1) {
        maxCount = parseInt(lastPart, 10);
        tagsPart = parts.slice(0, -1).join(" ");
      }

      const tags = tagsPart
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (tags.length === 0) {
        await bot.sendMessage(
          chatId,
          "⚠️ Please specify tags.\nUsage: /filter tag1,tag2 [maxCount]"
        );
        return;
      }

      const filters: FilterOptions = { tags, maxCount };
      const filterHash = hashFilters(userId, filters);

      // Check cache
      const cached = await findCachedExport(userId, filterHash);
      if (cached) {
        await bot.sendMessage(chatId, "📦 Found cached export...");
        await forwardCachedExport(bot, chatId, cached.fileId);
        return;
      }

      const statusMsg = await bot.sendMessage(
        chatId,
        `🔄 Scraping and filtering by: ${tags.join(", ")}...`
      );

      const nhSession: NhentaiSession = {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        cfClearance: session.cfClearance,
        userAgent: session.userAgent || undefined,
      };

      const result = await scrapeFavorites(nhSession);

      if (result.galleries.length === 0) {
        await bot.editMessageText(
          "⚠️ No favorites found.",
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      await saveGalleries(userId, result.galleries);

      const filtered = filterGalleries(result.galleries, filters);

      if (filtered.length === 0) {
        await bot.editMessageText(
          `⚠️ No galleries match tags: ${tags.join(", ")}`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      await bot.editMessageText(
        `📝 Generating PDF for ${filtered.length} filtered galleries...`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );

      const username = msg.from?.username || `user_${telegramId}`;
      const firstName = msg.from?.first_name || "User";
      const filterInfo = `Tags: ${tags.join(", ")}${maxCount ? ` | Max: ${maxCount}` : ""}`;

      const pdfPath = await generatePdf(filtered, username, filterInfo);

      try {
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

        // Forward with cover image
        const coverGallery = filtered.length > 0 ? filtered[0] : undefined;
        await forwardCachedExport(bot, chatId, channelResult.fileId, coverGallery);

        await bot.editMessageText(
          `✅ Done! ${filtered.length} galleries (filtered by: ${tags.join(", ")})`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
      } finally {
        cleanupPdf(pdfPath);
      }
    } catch (err: any) {
      log.error("Filter error:", err.message);
      await bot.sendMessage(chatId, `❌ Filter export failed: ${err.message}`);
    }
  });

  // /tags — show top tags from DB
  bot.onText(/\/tags/, async (msg) => {
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
      if (!session) {
        await bot.sendMessage(
          chatId,
          "⚠️ No active session. Use /session first, then /export once."
        );
        return;
      }

      // Try to get from DB first
      const { getUserGalleries } = await import("../../services/gallery.js");
      const galleries = await getUserGalleries(userId);

      if (galleries.length === 0) {
        await bot.sendMessage(
          chatId,
          "⚠️ No galleries in database. Use /export first to scrape your favorites."
        );
        return;
      }

      const topTags = getTopTags(galleries, 30);
      const tagList = topTags
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");

      await bot.sendMessage(
        chatId,
        `🏷️ *Top Tags* (${galleries.length} galleries):\n\n${tagList}\n\n` +
          `Use /filter tag1,tag2 to export filtered results.`,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      log.error("Tags error:", err.message);
      await bot.sendMessage(chatId, "❌ Failed to get tags.");
    }
  });

  // /exclude tag1,tag2 [maxCount] — export excluding specific tags
  bot.onText(/\/exclude\s+(.+)/, async (msg, match) => {
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

      const session = await getActiveSession(userId);
      if (!session) {
        await bot.sendMessage(
          chatId,
          "⚠️ No active session. Use /session first."
        );
        return;
      }

      const args = match[1].trim();
      const parts = args.split(/\s+/);
      let maxCount: number | undefined;
      let tagsPart = args;

      const lastPart = parts[parts.length - 1];
      if (/^\d+$/.test(lastPart) && parts.length > 1) {
        maxCount = parseInt(lastPart, 10);
        tagsPart = parts.slice(0, -1).join(" ");
      }

      const excludeTags = tagsPart
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const filters: FilterOptions = { excludeTags, maxCount };
      const filterHash = hashFilters(userId, filters);

      const cached = await findCachedExport(userId, filterHash);
      if (cached) {
        await bot.sendMessage(chatId, "📦 Found cached export...");
        await forwardCachedExport(bot, chatId, cached.fileId);
        return;
      }

      const statusMsg = await bot.sendMessage(
        chatId,
        `🔄 Scraping and excluding: ${excludeTags.join(", ")}...`
      );

      const nhSession: NhentaiSession = {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        cfClearance: session.cfClearance,
        userAgent: session.userAgent || undefined,
      };

      const result = await scrapeFavorites(nhSession);
      if (result.galleries.length === 0) {
        await bot.editMessageText("⚠️ No favorites found.", {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });
        return;
      }

      await saveGalleries(userId, result.galleries);
      const filtered = filterGalleries(result.galleries, filters);

      if (filtered.length === 0) {
        await bot.editMessageText(
          `⚠️ No galleries remain after excluding: ${excludeTags.join(", ")}`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      const username = msg.from?.username || `user_${telegramId}`;
      const firstName = msg.from?.first_name || "User";
      const filterInfo = `Excluded: ${excludeTags.join(", ")}${maxCount ? ` | Max: ${maxCount}` : ""}`;

      const pdfPath = await generatePdf(filtered, username, filterInfo);
      try {
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

        const coverGallery = filtered.length > 0 ? filtered[0] : undefined;
        await forwardCachedExport(bot, chatId, channelResult.fileId, coverGallery);

        await bot.editMessageText(
          `✅ Done! ${filtered.length} galleries (excluded: ${excludeTags.join(", ")})`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
      } finally {
        cleanupPdf(pdfPath);
      }
    } catch (err: any) {
      log.error("Exclude error:", err.message);
      await bot.sendMessage(chatId, `❌ Export failed: ${err.message}`);
    }
  });
}
