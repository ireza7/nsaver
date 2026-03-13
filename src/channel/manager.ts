import TelegramBot from "node-telegram-bot-api";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { createLogger, truncate } from "../utils/index.js";
import { downloadThumbnail, cleanupThumbnail } from "../utils/thumbnail.js";
import { env } from "../config/env.js";
import type { Gallery } from "../types/index.js";
import { getTopTags } from "../scraper/filter.js";

const log = createLogger("channel");

/**
 * Build a description string for the channel message caption.
 * Includes user info, tags summary, and gallery count.
 */
function buildDescription(
  username: string,
  firstName: string,
  galleries: Gallery[],
  filterInfo?: string
): string {
  const topTags = getTopTags(galleries, 10);
  const tagLine =
    topTags.length > 0
      ? topTags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ")
      : "#no_tags";

  let desc = `📚 nsaver Export\n`;
  desc += `👤 ${firstName}${username ? ` (@${username})` : ""}\n`;
  desc += `📊 ${galleries.length} galleries\n`;
  if (filterInfo) desc += `🔍 ${filterInfo}\n`;
  desc += `🏷️ ${tagLine}\n`;
  desc += `📅 ${new Date().toISOString().split("T")[0]}`;

  return truncate(desc, 1024);
}

/**
 * Build a compact caption for a single gallery thumbnail.
 */
function buildGalleryCaption(gallery: Gallery): string {
  const tags = gallery.tags.slice(0, 8).join(", ");
  let caption = `🎌 ${gallery.title}\n`;
  caption += `🔢 Code: ${gallery.id}\n`;
  if (gallery.language) caption += `🌐 ${gallery.language}\n`;
  if (gallery.pages > 0) caption += `📄 ${gallery.pages} pages\n`;
  if (tags) caption += `🏷️ ${tags}`;
  return truncate(caption, 1024);
}

/**
 * Send a gallery's cover image + PDF to a chat (channel or user).
 * First sends the thumbnail as a compressed photo, then the PDF.
 */
export async function sendGalleryWithCover(
  bot: TelegramBot,
  chatId: number | string,
  gallery: Gallery,
  pdfPath: string,
  caption?: string
): Promise<{ photoMsgId?: number; docMsgId: number; fileId: string }> {
  let photoMsgId: number | undefined;

  // Try to send thumbnail as a small photo
  if (gallery.thumbnail) {
    try {
      const thumbPath = await downloadThumbnail(gallery.thumbnail, gallery.id);
      if (thumbPath) {
        const photoMsg = await bot.sendPhoto(chatId, thumbPath, {
          caption: buildGalleryCaption(gallery),
        });
        photoMsgId = photoMsg.message_id;
        cleanupThumbnail(thumbPath);
      }
    } catch (err: any) {
      log.warn(`Failed to send thumbnail for ${gallery.id}: ${err.message}`);
    }
  }

  // Send PDF
  const docMsg = await bot.sendDocument(chatId, pdfPath, {
    caption: caption || `📎 PDF export — ${gallery.title}`,
  });

  const fileId = docMsg.document?.file_id || "";

  return { photoMsgId, docMsgId: docMsg.message_id, fileId };
}

/**
 * Upload cover + PDF to the private channel, store cache entry in DB.
 * Sends the first gallery's cover image, then the PDF document.
 */
export async function uploadToChannel(
  bot: TelegramBot,
  pdfPath: string,
  userId: number,
  username: string,
  firstName: string,
  galleries: Gallery[],
  filterHash: string,
  filterInfo?: string
): Promise<{ messageId: number; fileId: string }> {
  const db = getDb();
  const channelId = env.TELEGRAM_CHANNEL_ID;

  const description = buildDescription(
    username,
    firstName,
    galleries,
    filterInfo
  );

  log.info(`Uploading to channel ${channelId}...`);

  // Send cover image of first gallery to channel
  const firstGallery = galleries[0];
  if (firstGallery?.thumbnail) {
    try {
      const thumbPath = await downloadThumbnail(firstGallery.thumbnail, firstGallery.id);
      if (thumbPath) {
        await bot.sendPhoto(channelId, thumbPath, {
          caption: buildGalleryCaption(firstGallery),
        });
        cleanupThumbnail(thumbPath);
      }
    } catch (err: any) {
      log.warn(`Failed to send channel thumbnail: ${err.message}`);
    }
  }

  // Send PDF to channel
  const msg = await bot.sendDocument(channelId, pdfPath, {
    caption: description,
  });

  const fileId = msg.document?.file_id || "";
  const messageId = msg.message_id;

  // Store in DB cache
  const topTags = getTopTags(galleries, 20);
  await db.insert(schema.channelCache).values({
    userId,
    telegramMessageId: messageId,
    telegramFileId: fileId,
    description,
    filterHash,
    tags: topTags,
    galleryCount: galleries.length,
  });

  log.info(`Uploaded to channel: msg=${messageId}, fileId=${fileId}`);
  return { messageId, fileId };
}

/**
 * Check if we have a cached version in the channel for this user + filter combo.
 */
export async function findCachedExport(
  userId: number,
  filterHash: string
): Promise<{ messageId: number; fileId: string } | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.channelCache)
    .where(
      and(
        eq(schema.channelCache.userId, userId),
        eq(schema.channelCache.filterHash, filterHash)
      )
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    messageId: row.telegramMessageId,
    fileId: row.telegramFileId,
  };
}

/**
 * Forward a cached document from channel to user, with cover image.
 */
export async function forwardCachedExport(
  bot: TelegramBot,
  chatId: number,
  fileId: string,
  coverGallery?: Gallery
): Promise<void> {
  log.info(`Forwarding cached document to ${chatId}`);

  // Send cover image first if available
  if (coverGallery?.thumbnail) {
    try {
      const thumbPath = await downloadThumbnail(coverGallery.thumbnail, coverGallery.id);
      if (thumbPath) {
        await bot.sendPhoto(chatId, thumbPath, {
          caption: buildGalleryCaption(coverGallery),
        });
        cleanupThumbnail(thumbPath);
      }
    } catch (err: any) {
      log.warn(`Failed to send cached thumbnail: ${err.message}`);
    }
  }

  await bot.sendDocument(chatId, fileId, {
    caption: "📎 Here's your favorites export!",
  });
}

/**
 * Invalidate all cache entries for a user (e.g., when they update session).
 */
export async function invalidateUserCache(
  userId: number
): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(schema.channelCache)
    .where(eq(schema.channelCache.userId, userId));
  log.info(`Invalidated cache for user ${userId}`);
  return 0;
}
