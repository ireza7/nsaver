import fs from "fs";
import path from "path";
import os from "os";
import { createLogger, sleep } from "../utils/index.js";

const log = createLogger("thumbnail");

const TMP_DIR = path.join(os.tmpdir(), "nsaver-thumbs");

/** Ensure temp directory exists */
function ensureTmpDir(): void {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

/**
 * Download a thumbnail image and return the local file path.
 * Returns null if download fails.
 */
export async function downloadThumbnail(
  url: string,
  galleryId: number
): Promise<string | null> {
  if (!url) return null;

  ensureTmpDir();

  try {
    // Determine extension from URL
    const ext = url.match(/\.(jpe?g|png|gif|webp)/i)?.[1] || "jpg";
    const filePath = path.join(TMP_DIR, `thumb_${galleryId}.${ext}`);

    // Skip if already downloaded
    if (fs.existsSync(filePath)) return filePath;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://nhentai.net/",
      },
    });

    if (!res.ok) {
      log.warn(`Failed to download thumbnail for ${galleryId}: HTTP ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    log.debug(`Thumbnail downloaded: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return filePath;
  } catch (err: any) {
    log.warn(`Thumbnail download error for ${galleryId}: ${err.message}`);
    return null;
  }
}

/** Clean up a thumbnail file */
export function cleanupThumbnail(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

/** Clean up all thumbnails in temp directory */
export function cleanupAllThumbnails(): void {
  try {
    if (fs.existsSync(TMP_DIR)) {
      const files = fs.readdirSync(TMP_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TMP_DIR, file));
      }
    }
  } catch {}
}
