import TelegramBot from "node-telegram-bot-api";
import { ensureUser, getActiveSession } from "../../services/user.js";
import { fetchGalleryDetail, fetchGalleryPublic } from "../../scraper/favorites.js";
import { generatePdf, cleanupPdf } from "../../pdf/index.js";
import { uploadToChannel, findCachedExport, forwardCachedExport } from "../../channel/manager.js";
import { createLogger, hashFilters } from "../../utils/index.js";
import { env } from "../../config/env.js";
import type { Gallery, NhentaiSession } from "../../types/index.js";

const log = createLogger("handler:get");

/** Active get locks to prevent spam */
const getLocks = new Set<number>();

/**
 * Fetch gallery info. Tries public API first, falls back to
 * session-based scraping if the user has an active session.
 */
async function fetchGallery(
  galleryId: number,
  session: { sessionId: string; csrfToken: string; cfClearance: string; userAgent: string | null } | null
): Promise<Gallery> {
  // Always try the public API first (no session needed)
  try {
    return await fetchGalleryPublic(galleryId);
  } catch (publicErr: any) {
    log.warn(`Public API failed for #${galleryId}: ${publicErr.message}`);
  }

  // Fall back to session-based scraping if we have a session
  if (!session) {
    throw new Error("Gallery not accessible via public API and no session is configured.");
  }

  const nhSession: NhentaiSession = {
    sessionId: session.sessionId,
    csrfToken: session.csrfToken,
    cfClearance: session.cfClearance,
    userAgent: session.userAgent || undefined,
  };

  const detail = await fetchGalleryDetail(galleryId, nhSession);

  // Fetch the gallery page to get title and cover
  const galleryUrl = `https://nhentai.net/g/${galleryId}/`;
  const headers = {
    Cookie: `sessionid=${nhSession.sessionId}; csrftoken=${nhSession.csrfToken}; cf_clearance=${nhSession.cfClearance}`,
    "User-Agent": nhSession.userAgent || env.NHENTAI_USER_AGENT,
    Referer: "https://nhentai.net/",
  };

  let title = `#${galleryId}`;
  let thumbnail = "";

  try {
    const res = await fetch(galleryUrl, { headers, redirect: "follow" });
    if (res.ok) {
      const html = await res.text();
      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);

      title = $("h1.title .pretty").text().trim() ||
              $("h1.title .after").text().trim() ||
              $("h1.title").text().trim() ||
              `#${galleryId}`;

      thumbnail = $("#cover img").attr("data-src") ||
                  $("#cover img").attr("src") || "";
    }
  } catch (err: any) {
    log.warn(`Failed to fetch page for ${galleryId}: ${err.message}`);
  }

  return {
    id: galleryId,
    title,
    tags: detail.tags || [],
    language: detail.language || "",
    category: detail.category || "",
    pages: detail.pages || 0,
    thumbnail,
    uploadDate: "",
  };
}

/**
 * Core logic: fetch a gallery by ID, generate PDF, send cover + PDF.
 * Works with or without an active session.
 */
async function handleGetGallery(
  bot: TelegramBot,
  chatId: number,
  telegramId: number,
  galleryId: number,
  msg: TelegramBot.Message
): Promise<void> {
  if (getLocks.has(telegramId)) {
    await bot.sendMessage(chatId, "⏳ Please wait for your current request to finish.");
    return;
  }

  try {
    getLocks.add(telegramId);

    const userId = await ensureUser(
      telegramId,
      msg.from?.username,
      msg.from?.first_name
    );

    // Session is optional — we'll use it if available
    const session = await getActiveSession(userId);

    // Check cache for this specific gallery
    const cacheKey = hashFilters(userId, { tags: [`__gallery_${galleryId}`] });
    const cached = await findCachedExport(userId, cacheKey);
    if (cached) {
      await bot.sendMessage(chatId, "📦 Found cached, sending...");
      await forwardCachedExport(bot, chatId, cached.fileId);
      return;
    }

    const statusMsg = await bot.sendMessage(
      chatId,
      `🔄 Fetching gallery #${galleryId}...`
    );

    // Fetch gallery (public API first, then session-based fallback)
    const gallery = await fetchGallery(galleryId, session);

    await bot.editMessageText(
      `📝 Generating PDF for #${galleryId}...`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );

    // Generate single-gallery PDF
    const username = msg.from?.username || `user_${telegramId}`;
    const firstName = msg.from?.first_name || "User";
    const pdfPath = await generatePdf([gallery], username, `Gallery #${galleryId}`);

    try {
      // Upload cover + PDF to channel
      const channelResult = await uploadToChannel(
        bot,
        pdfPath,
        userId,
        username,
        firstName,
        [gallery],
        cacheKey,
        `Gallery #${galleryId}`
      );

      // Send cover + PDF to user
      await forwardCachedExport(bot, chatId, channelResult.fileId, gallery);

      await bot.editMessageText(
        `✅ Gallery #${galleryId} sent!\n` +
          `📖 ${gallery.title}\n` +
          (gallery.pages > 0 ? `📄 ${gallery.pages} pages` : ""),
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    } finally {
      cleanupPdf(pdfPath);
    }
  } catch (err: any) {
    log.error("Get error:", err.message);
    await bot.sendMessage(chatId, `❌ Failed to get gallery #${galleryId}: ${err.message}`);
  } finally {
    getLocks.delete(telegramId);
  }
}

export function registerGetHandler(bot: TelegramBot): void {
  // /get <code> — fetch a specific gallery by nhentai ID
  bot.onText(/\/get\s+(\d+)/, async (msg, match) => {
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

    const galleryId = parseInt(match[1], 10);
    if (isNaN(galleryId) || galleryId <= 0) {
      await bot.sendMessage(chatId, "⚠️ Invalid code. Usage: /get 177013");
      return;
    }

    await handleGetGallery(bot, chatId, telegramId, galleryId, msg);
  });
}

/**
 * Handle plain numeric messages as gallery codes.
 * Call this from the bot's message handler for non-command text.
 * Returns true if the message was consumed.
 */
export function handleNumericCode(
  bot: TelegramBot,
  msg: TelegramBot.Message
): boolean {
  const text = msg.text?.trim();
  if (!text) return false;

  // Only match pure numeric messages (1-7 digit nhentai codes)
  if (!/^\d{1,7}$/.test(text)) return false;

  const telegramId = msg.from?.id;
  if (!telegramId) return false;

  // Check admin restriction
  if (
    env.ADMIN_USER_IDS.length > 0 &&
    !env.ADMIN_USER_IDS.includes(telegramId)
  ) {
    return false;
  }

  const galleryId = parseInt(text, 10);
  if (isNaN(galleryId) || galleryId <= 0) return false;

  // Run async
  handleGetGallery(bot, msg.chat.id, telegramId, galleryId, msg).catch((err) => {
    log.error("Numeric code handler error:", err.message);
  });

  return true;
}
