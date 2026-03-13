import fs from "fs";
import path from "path";
import os from "os";
import { createLogger, sleep } from "../utils/index.js";

const log = createLogger("thumbnail");

const TMP_DIR = path.join(os.tmpdir(), "nsaver-thumbs");

/**
 * nhentai CDN thumbnail host variations.
 * nhentai frequently changes/rotates these, so we try multiple.
 * Inspired by nZip's approach of using configurable image hosts.
 */
const THUMB_HOSTS = [
  "t.nhentai.net",
  "t2.nhentai.net",
  "t3.nhentai.net",
  "t5.nhentai.net",
  "t7.nhentai.net",
];

/**
 * nhentai CDN image host variations for full-size covers.
 */
const IMAGE_HOSTS = [
  "i.nhentai.net",
  "i2.nhentai.net",
  "i3.nhentai.net",
  "i5.nhentai.net",
  "i7.nhentai.net",
];

/** Ensure temp directory exists */
function ensureTmpDir(): void {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

/**
 * Generate all possible fallback URLs for a given thumbnail URL.
 * Tries multiple CDN hosts and path variations (cover, thumb, 1).
 * Inspired by nZip which uses configurable image endpoints.
 */
export function generateFallbackUrls(url: string): string[] {
  if (!url) return [];

  const urls: string[] = [url];

  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/^\/galleries\/(\d+)\/(.+)$/);
    if (!pathMatch) return urls;

    const mediaId = pathMatch[1];
    const filename = pathMatch[2];
    const ext = filename.match(/\.(jpe?g|png|gif|webp)$/i)?.[0] || ".jpg";

    // Determine path variations to try:
    // - cover.{ext} on thumbnail hosts (t.nhentai.net)
    // - thumb.{ext} on thumbnail hosts
    // - 1.{ext} on image hosts (i.nhentai.net) — first page as cover (nZip approach)
    const thumbPaths = [`cover${ext}`, `thumb${ext}`];
    const imagePaths = [`1${ext}`];

    // Add all thumbnail host + path combinations
    for (const host of THUMB_HOSTS) {
      for (const p of thumbPaths) {
        const candidate = `https://${host}/galleries/${mediaId}/${p}`;
        if (!urls.includes(candidate)) urls.push(candidate);
      }
    }

    // Add all image host + path combinations (full-size first page as cover)
    for (const host of IMAGE_HOSTS) {
      for (const p of imagePaths) {
        const candidate = `https://${host}/galleries/${mediaId}/${p}`;
        if (!urls.includes(candidate)) urls.push(candidate);
      }
    }
  } catch {
    // If URL parsing fails, just return original
  }

  return urls;
}

/**
 * Try to fetch a URL with proper headers.
 * Returns the response if successful (2xx), null otherwise.
 */
async function tryFetch(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://nhentai.net/",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (res.ok) return res;

    // Consume the body to free resources
    await res.arrayBuffer().catch(() => {});
    return null;
  } catch {
    return null;
  }
}

/**
 * Download a thumbnail image and return the local file path.
 * Tries multiple CDN hosts and path variations as fallbacks.
 * Returns null if all download attempts fail.
 */
export async function downloadThumbnail(
  url: string,
  galleryId: number
): Promise<string | null> {
  if (!url) return null;

  ensureTmpDir();

  // Determine extension from URL
  const ext = url.match(/\.(jpe?g|png|gif|webp)/i)?.[1] || "jpg";
  const filePath = path.join(TMP_DIR, `thumb_${galleryId}.${ext}`);

  // Skip if already downloaded and has content
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 0) return filePath;
    // Remove empty/corrupt files
    fs.unlinkSync(filePath);
  }

  // Generate fallback URLs and try each one
  const fallbackUrls = generateFallbackUrls(url);

  for (const candidateUrl of fallbackUrls) {
    try {
      const res = await tryFetch(candidateUrl);
      if (!res) continue;

      const buffer = Buffer.from(await res.arrayBuffer());

      // Validate that we got actual image data (not empty or error page)
      if (buffer.length < 100) {
        log.debug(`Thumbnail too small from ${candidateUrl} (${buffer.length} bytes), skipping`);
        continue;
      }

      // Basic image header validation
      if (!isValidImageBuffer(buffer)) {
        log.debug(`Invalid image data from ${candidateUrl}, skipping`);
        continue;
      }

      fs.writeFileSync(filePath, buffer);
      log.debug(`Thumbnail downloaded: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB) from ${candidateUrl}`);
      return filePath;
    } catch (err: any) {
      log.debug(`Thumbnail attempt failed for ${galleryId} from ${candidateUrl}: ${err.message}`);
      continue;
    }
  }

  log.warn(`Failed to download thumbnail for ${galleryId}: all ${fallbackUrls.length} URLs failed`);
  return null;
}

/**
 * Basic validation that a buffer contains image data.
 * Checks for common image file magic bytes.
 */
function isValidImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;

  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;

  return false;
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
