/**
 * ZIP-based gallery downloader & archiver.
 *
 * Inspired by nZip's Go core (downloader.go + archiver.go):
 *  - Concurrent image downloads with retry & exponential backoff
 *  - Atomic file writes (tmp → rename)
 *  - Pack downloaded images into a ZIP using `archiver`
 *  - Progress callbacks for Telegram status updates
 *
 * Unlike nZip (which is a separate Go binary communicating via JSON-RPC),
 * this runs entirely in-process in Node/TypeScript.
 */

import fs from "fs";
import path from "path";
import os from "os";
import archiver from "archiver";
import { createLogger, sleep } from "../utils/index.js";
import { env } from "../config/env.js";
import type { Gallery, ImagePage } from "../types/index.js";

const log = createLogger("zip");

/** nZip-style constants */
const MAX_RETRIES = 10;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BASE_DELAY_MS = 500;
const CONCURRENT_DOWNLOADS = 8;

/** Image host variants – nZip uses a configurable IMAGE_URL */
const IMAGE_HOSTS = [
  "i.nhentai.net",
  "i2.nhentai.net",
  "i3.nhentai.net",
  "i5.nhentai.net",
  "i7.nhentai.net",
];

// ───────────────────────────── helpers ──────────────────────────────

function extFromType(t: string): string {
  switch (t) {
    case "j": return "jpg";
    case "g": return "gif";
    case "w": return "webp";
    default: return "png";
  }
}

/** Build image URLs for every page (primary host = first in list). */
function buildImageUrls(mediaId: string, imagePages: ImagePage[]): string[] {
  const host = IMAGE_HOSTS[0];
  return imagePages.map((p, i) => {
    const ext = extFromType(p.t);
    return `https://${host}/galleries/${mediaId}/${i + 1}.${ext}`;
  });
}

/**
 * Generate all fallback URLs for a single image URL across CDN hosts.
 * (nZip rotates hosts on failure.)
 */
function fallbackUrls(primary: string): string[] {
  const urls = [primary];
  try {
    const parsed = new URL(primary);
    const pathPart = parsed.pathname; // e.g. /galleries/12345/1.jpg
    for (const host of IMAGE_HOSTS) {
      const candidate = `https://${host}${pathPart}`;
      if (!urls.includes(candidate)) urls.push(candidate);
    }
  } catch { /* keep primary only */ }
  return urls;
}

/** Check if an HTTP status is temporary (worth retrying). nZip: isTemporaryError */
function isTemporaryStatus(status: number): boolean {
  return (
    status === 408 || // Request Timeout
    status === 425 || // Too Early
    status === 429 || // Too Many Requests
    status >= 500     // Server errors
  );
}

/** Fetch a single URL to a local file with retry + exponential back-off. */
async function downloadFileWithRetry(
  url: string,
  dest: string,
  signal?: AbortSignal
): Promise<void> {
  // Skip if already downloaded (nZip behaviour)
  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size > 0) return;
    fs.unlinkSync(dest);
  }

  const candidates = fallbackUrls(url);
  let lastErr: Error | undefined;

  for (const candidateUrl of candidates) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error("Aborted");

      if (attempt > 0) {
        const delay = Math.min(RETRY_BASE_DELAY_MS * (1 << (attempt - 1)), 30_000);
        await sleep(delay);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const res = await fetch(candidateUrl, {
          headers: {
            "User-Agent": env.NHENTAI_USER_AGENT,
            Referer: "https://nhentai.net/",
            Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timeout);

        if (!res.ok) {
          if (isTemporaryStatus(res.status)) {
            lastErr = new Error(`HTTP ${res.status} for ${candidateUrl}`);
            await res.arrayBuffer().catch(() => {});
            continue; // retry same candidate
          }
          // Permanent error on this candidate – try next host
          lastErr = new Error(`HTTP ${res.status} for ${candidateUrl}`);
          await res.arrayBuffer().catch(() => {});
          break;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 100) {
          lastErr = new Error(`Response too small (${buffer.length} bytes)`);
          break; // try next host
        }

        // Atomic write: tmp → rename (nZip pattern)
        const tmp = dest + ".tmp";
        fs.writeFileSync(tmp, buffer);
        fs.renameSync(tmp, dest);
        return; // success
      } catch (err: any) {
        lastErr = err;
        if (err.name === "AbortError" || signal?.aborted) throw new Error("Aborted");
        // Network errors are temporary → retry
        continue;
      }
    }
  }

  throw lastErr ?? new Error(`Failed to download ${url}`);
}

// ──────────────── concurrent download (nZip downloadImages) ────────────────

interface DownloadProgress {
  completed: number;
  total: number;
}

/**
 * Download all images concurrently (like nZip's downloadImages with worker pool).
 * Returns a map of url → local file path.
 */
async function downloadImages(
  urls: string[],
  dir: string,
  concurrency: number,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<Map<string, string>> {
  fs.mkdirSync(dir, { recursive: true });

  const result = new Map<string, string>();
  let completed = 0;
  const total = urls.length;

  // Simple worker pool
  const queue = [...urls];
  const workers: Promise<void>[] = [];

  for (let w = 0; w < Math.min(concurrency, total); w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          if (signal?.aborted) return;
          const url = queue.shift()!;
          const filename = path.basename(new URL(url).pathname);
          const dest = path.join(dir, filename);

          await downloadFileWithRetry(url, dest, signal);
          result.set(url, dest);

          completed++;
          onProgress?.({ completed, total });
        }
      })()
    );
  }

  await Promise.all(workers);
  return result;
}

// ──────────────────── pack ZIP (nZip packZip) ──────────────────────

/**
 * Create a ZIP archive from downloaded image files.
 * Uses `archiver` with STORE method (no compression, like nZip) for speed.
 */
async function packZip(
  filePaths: string[],
  zipPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (filePaths.length === 0) {
      reject(new Error("No files to pack"));
      return;
    }

    const tmp = zipPath + ".tmp";
    const output = fs.createWriteStream(tmp);
    const archive = archiver("zip", { store: true }); // STORE = no compression (nZip uses zip.Store)

    output.on("close", () => {
      // Atomic rename
      try {
        fs.renameSync(tmp, zipPath);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    archive.on("error", (err) => {
      try { fs.unlinkSync(tmp); } catch {}
      reject(err);
    });

    archive.pipe(output);

    for (const fp of filePaths) {
      const name = path.basename(fp);
      archive.file(fp, { name });
    }

    archive.finalize();
  });
}

// ───────────── filename generation (nZip generateFilename) ─────────────

/**
 * Generate a safe ZIP filename like nZip: `[galleryId] title.zip`
 * Ensures the byte length ≤ 255.
 */
function generateZipFilename(galleryId: number, title: string): string {
  const sanitize = (text: string) => text.replace(/[/\\?%*:|"<>]/g, "_");
  const tryFilename = (t: string) => {
    const fn = `[${galleryId}] ${sanitize(t)}.zip`;
    return Buffer.byteLength(fn) <= 255 ? fn : null;
  };
  return tryFilename(title) || `${galleryId}.zip`;
}

// ────────────────────── public API ──────────────────────

export interface ZipResult {
  /** Absolute path to the generated ZIP file */
  zipPath: string;
  /** Filename of the ZIP */
  filename: string;
  /** Absolute path to the first image (cover) – used as Telegram photo */
  coverImagePath: string | null;
}

/**
 * Download all images for a single gallery and pack them into a ZIP.
 * This is the main entry point – mirrors nZip's full download→pack pipeline.
 *
 * @param gallery - Gallery with mediaId and imagePages populated
 * @param onProgress - optional callback for download progress
 * @param onPackStart - optional callback when packing begins
 */
export async function downloadAndZipGallery(
  gallery: Gallery,
  onProgress?: (completed: number, total: number) => void,
  onPackStart?: () => void
): Promise<ZipResult> {
  if (!gallery.mediaId || gallery.imagePages.length === 0) {
    throw new Error(
      `Gallery #${gallery.id} has no image data (mediaId=${gallery.mediaId}, pages=${gallery.imagePages.length}). ` +
      `Session cookies may be expired or the API response was incomplete.`
    );
  }

  const tmpDir = path.join(os.tmpdir(), "nsaver-zips", String(gallery.id));
  const filename = generateZipFilename(gallery.id, gallery.title);
  const zipPath = path.join(tmpDir, filename);

  // If ZIP already exists & has content, return it (nZip caching behaviour)
  if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0) {
    // Find the first image on disk for cover
    const urls = buildImageUrls(gallery.mediaId, gallery.imagePages);
    const firstName = path.basename(new URL(urls[0]).pathname);
    const coverPath = path.join(tmpDir, firstName);
    return {
      zipPath,
      filename,
      coverImagePath: fs.existsSync(coverPath) ? coverPath : null,
    };
  }

  const urls = buildImageUrls(gallery.mediaId, gallery.imagePages);

  log.info(`Downloading ${urls.length} images for gallery #${gallery.id}...`);

  // Phase 1: download images (nZip downloadImages)
  const downloaded = await downloadImages(
    urls,
    tmpDir,
    CONCURRENT_DOWNLOADS,
    onProgress ? (p) => onProgress(p.completed, p.total) : undefined
  );

  log.info(`Downloaded ${downloaded.size}/${urls.length} images for #${gallery.id}`);

  if (downloaded.size === 0) {
    throw new Error(`All image downloads failed for gallery #${gallery.id}`);
  }

  // Phase 2: pack into ZIP (nZip packZip)
  onPackStart?.();

  // Keep the order from original URLs
  const orderedPaths: string[] = [];
  for (const url of urls) {
    const fp = downloaded.get(url);
    if (fp && fs.existsSync(fp) && fs.statSync(fp).size > 0) {
      orderedPaths.push(fp);
    }
  }

  await packZip(orderedPaths, zipPath);

  const stats = fs.statSync(zipPath);
  log.info(`ZIP created: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  // Cover image = first downloaded image (user requirement: use first image of gallery, not a separate thumbnail)
  const firstUrl = urls[0];
  const firstFile = downloaded.get(firstUrl) ?? null;
  const coverImagePath =
    firstFile && fs.existsSync(firstFile) && fs.statSync(firstFile).size > 0
      ? firstFile
      : null;

  return { zipPath, filename, coverImagePath };
}

/** Clean up a ZIP file and optionally its temp directory */
export function cleanupZip(zipPath: string): void {
  try {
    const dir = path.dirname(zipPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log.debug(`Cleaned up: ${dir}`);
    }
  } catch (err) {
    log.warn(`Failed to clean up ${zipPath}`);
  }
}
