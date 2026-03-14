/**
 * PDF-based gallery downloader & generator.
 *
 * Downloads gallery images concurrently (nZip-style), compresses them with
 * sharp for smaller file size, and packs them into a PDF using PDFKit.
 *
 * Each page in the PDF is sized to the image dimensions so the reading
 * experience stays identical to browsing the gallery.
 */

import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { createLogger, sleep } from "../utils/index.js";
import { env } from "../config/env.js";
import type { Gallery, ImagePage } from "../types/index.js";

const log = createLogger("pdf");

/** nZip-style constants */
const MAX_RETRIES = 10;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BASE_DELAY_MS = 500;
const CONCURRENT_DOWNLOADS = 8;

/** JPEG quality for compressed images (lower = smaller PDF) */
const JPEG_QUALITY = 70;
/** Max dimension for resizing very large images */
const MAX_DIMENSION = 1600;

/** Image host variants */
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
 */
function fallbackUrls(primary: string): string[] {
  const urls = [primary];
  try {
    const parsed = new URL(primary);
    const pathPart = parsed.pathname;
    for (const host of IMAGE_HOSTS) {
      const candidate = `https://${host}${pathPart}`;
      if (!urls.includes(candidate)) urls.push(candidate);
    }
  } catch { /* keep primary only */ }
  return urls;
}

/** Check if an HTTP status is temporary (worth retrying). */
function isTemporaryStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

/** Fetch a single URL to a local file with retry + exponential back-off. */
async function downloadFileWithRetry(
  url: string,
  dest: string,
  signal?: AbortSignal
): Promise<void> {
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
            continue;
          }
          lastErr = new Error(`HTTP ${res.status} for ${candidateUrl}`);
          await res.arrayBuffer().catch(() => {});
          break;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 100) {
          lastErr = new Error(`Response too small (${buffer.length} bytes)`);
          break;
        }

        // Atomic write
        const tmp = dest + ".tmp";
        fs.writeFileSync(tmp, buffer);
        fs.renameSync(tmp, dest);
        return;
      } catch (err: any) {
        lastErr = err;
        if (err.name === "AbortError" || signal?.aborted) throw new Error("Aborted");
        continue;
      }
    }
  }

  throw lastErr ?? new Error(`Failed to download ${url}`);
}

// ──────────────── concurrent download ────────────────

interface DownloadProgress {
  completed: number;
  total: number;
}

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

// ──────────────── compress image with sharp ────────────────

/**
 * Compress an image to JPEG with reduced quality and optional resize.
 * Returns the compressed buffer.
 */
async function compressImage(filePath: string): Promise<Buffer> {
  try {
    const img = sharp(filePath);
    const metadata = await img.metadata();

    let pipeline = sharp(filePath);

    // Resize if image is very large (keeps aspect ratio)
    const w = metadata.width || 0;
    const h = metadata.height || 0;
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Convert to JPEG with reduced quality
    const buffer = await pipeline
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    return buffer;
  } catch (err: any) {
    // If sharp fails (e.g. unsupported format), return raw file
    log.warn(`Sharp compression failed for ${filePath}: ${err.message}, using raw`);
    return fs.readFileSync(filePath);
  }
}

/**
 * Get image dimensions after potential compression.
 */
async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(buffer).metadata();
    return { width: meta.width || 800, height: meta.height || 1200 };
  } catch {
    return { width: 800, height: 1200 }; // sensible fallback
  }
}

// ──────────────────── pack PDF ──────────────────────

/**
 * Create a PDF from compressed image buffers.
 * Each image is placed on its own page sized to the image dimensions.
 */
async function packPdf(
  imagePaths: string[],
  pdfPath: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (imagePaths.length === 0) {
      reject(new Error("No images to pack"));
      return;
    }

    const tmp = pdfPath + ".tmp";
    const output = fs.createWriteStream(tmp);

    // We'll create the doc after we know the first image dimensions
    let doc: PDFKit.PDFDocument | null = null;
    let isFirst = true;

    output.on("finish", () => {
      try {
        fs.renameSync(tmp, pdfPath);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    output.on("error", (err) => {
      try { fs.unlinkSync(tmp); } catch {}
      reject(err);
    });

    try {
      for (const imgPath of imagePaths) {
        const compressed = await compressImage(imgPath);
        const dims = await getImageDimensions(compressed);

        if (isFirst) {
          // Create the PDF document with the first page's size
          doc = new PDFDocument({
            autoFirstPage: false,
            compress: true,
            margin: 0,
          });
          doc.pipe(output);
          isFirst = false;
        }

        // Add a new page sized to the image
        doc!.addPage({ size: [dims.width, dims.height], margin: 0 });
        doc!.image(compressed, 0, 0, {
          width: dims.width,
          height: dims.height,
        });
      }

      if (doc) {
        doc.end();
      } else {
        reject(new Error("No images processed"));
      }
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      reject(err);
    }
  });
}

// ───────────── filename generation ─────────────

/**
 * Generate a safe PDF filename: `[galleryId] title.pdf`
 * Ensures the byte length <= 255.
 */
function generatePdfFilename(galleryId: number, title: string): string {
  const sanitize = (text: string) => text.replace(/[/\\?%*:|"<>]/g, "_");
  const tryFilename = (t: string) => {
    const fn = `[${galleryId}] ${sanitize(t)}.pdf`;
    return Buffer.byteLength(fn) <= 255 ? fn : null;
  };
  return tryFilename(title) || `${galleryId}.pdf`;
}

// ────────────────────── public API ──────────────────────

export interface PdfResult {
  /** Absolute path to the generated PDF file */
  pdfPath: string;
  /** Filename of the PDF */
  filename: string;
  /** Absolute path to the first image (cover) - used as Telegram photo */
  coverImagePath: string | null;
}

/**
 * Download all images for a single gallery and pack them into a compressed PDF.
 *
 * @param gallery - Gallery with mediaId and imagePages populated
 * @param onProgress - optional callback for download progress
 * @param onPackStart - optional callback when packing begins
 */
export async function downloadAndCreatePdf(
  gallery: Gallery,
  onProgress?: (completed: number, total: number) => void,
  onPackStart?: () => void
): Promise<PdfResult> {
  if (!gallery.mediaId || gallery.imagePages.length === 0) {
    throw new Error(
      `Gallery #${gallery.id} has no image data (mediaId=${gallery.mediaId}, pages=${gallery.imagePages.length}). ` +
      `Session cookies may be expired or the API response was incomplete.`
    );
  }

  const tmpDir = path.join(os.tmpdir(), "nsaver-pdfs", String(gallery.id));
  const filename = generatePdfFilename(gallery.id, gallery.title);
  const pdfPath = path.join(tmpDir, filename);

  // If PDF already exists & has content, return it (caching behaviour)
  if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) {
    const urls = buildImageUrls(gallery.mediaId, gallery.imagePages);
    const firstName = path.basename(new URL(urls[0]).pathname);
    const coverPath = path.join(tmpDir, firstName);
    return {
      pdfPath,
      filename,
      coverImagePath: fs.existsSync(coverPath) ? coverPath : null,
    };
  }

  const urls = buildImageUrls(gallery.mediaId, gallery.imagePages);

  log.info(`Downloading ${urls.length} images for gallery #${gallery.id}...`);

  // Phase 1: download images
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

  // Phase 2: pack into PDF
  onPackStart?.();

  // Keep the order from original URLs
  const orderedPaths: string[] = [];
  for (const url of urls) {
    const fp = downloaded.get(url);
    if (fp && fs.existsSync(fp) && fs.statSync(fp).size > 0) {
      orderedPaths.push(fp);
    }
  }

  await packPdf(orderedPaths, pdfPath);

  const stats = fs.statSync(pdfPath);
  log.info(`PDF created: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  // Cover image = first downloaded image
  const firstUrl = urls[0];
  const firstFile = downloaded.get(firstUrl) ?? null;
  const coverImagePath =
    firstFile && fs.existsSync(firstFile) && fs.statSync(firstFile).size > 0
      ? firstFile
      : null;

  return { pdfPath, filename, coverImagePath };
}

/** Clean up a PDF file and its temp directory */
export function cleanupPdf(pdfPath: string): void {
  try {
    const dir = path.dirname(pdfPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log.debug(`Cleaned up: ${dir}`);
    }
  } catch (err) {
    log.warn(`Failed to clean up ${pdfPath}`);
  }
}
