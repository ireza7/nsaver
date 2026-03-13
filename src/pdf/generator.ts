import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../utils/index.js";
import { downloadThumbnail, cleanupThumbnail } from "../utils/thumbnail.js";
import type { Gallery } from "../types/index.js";

const log = createLogger("pdf");

/** Format tags into a compact string */
function formatTags(tags: string[], maxLen = 80): string {
  const joined = tags.join(", ");
  if (joined.length <= maxLen) return joined;
  return joined.slice(0, maxLen - 3) + "...";
}

/** Download all thumbnails for galleries, returns map of galleryId -> localPath */
async function downloadAllThumbnails(
  galleries: Gallery[]
): Promise<Map<number, string>> {
  const thumbMap = new Map<number, string>();

  // Download in batches of 5 to avoid overwhelming the server
  const batchSize = 5;
  for (let i = 0; i < galleries.length; i += batchSize) {
    const batch = galleries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (g) => {
        if (!g.thumbnail) return null;
        const localPath = await downloadThumbnail(g.thumbnail, g.id);
        if (localPath) {
          thumbMap.set(g.id, localPath);
        }
        return localPath;
      })
    );
  }

  log.info(`Downloaded ${thumbMap.size}/${galleries.length} thumbnails for PDF`);
  return thumbMap;
}

/** Thumbnail dimensions in the PDF */
const THUMB_WIDTH = 60;
const THUMB_HEIGHT = 85;

/** Generate a compact PDF of galleries list with embedded cover images */
export async function generatePdf(
  galleries: Gallery[],
  username: string,
  filterInfo?: string
): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), "nsaver-pdfs");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const filePath = path.join(
    tmpDir,
    `nsaver_${username}_${Date.now()}.pdf`
  );

  // Pre-download all thumbnails
  const thumbMap = await downloadAllThumbnails(galleries);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        compress: true, // Keep PDF size small
        info: {
          Title: `nsaver - Favorites for ${username}`,
          Author: "nsaver bot",
          Subject: "nhentai Favorites Export",
        },
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text("nsaver - Favorites Export", { align: "center" });

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`User: ${username}`, { align: "center" });

      doc.text(
        `Generated: ${new Date().toISOString().split("T")[0]}`,
        { align: "center" }
      );

      doc.text(`Total: ${galleries.length} galleries`, {
        align: "center",
      });

      if (filterInfo) {
        doc
          .fontSize(9)
          .fillColor("#666666")
          .text(`Filter: ${filterInfo}`, { align: "center" });
      }

      doc.moveDown(1);
      doc
        .strokeColor("#cccccc")
        .lineWidth(0.5)
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .stroke();
      doc.moveDown(0.5);

      // Gallery list with embedded thumbnails
      const pageMargin = 40;
      const contentWidth = 515;
      const textXOffset = pageMargin + THUMB_WIDTH + 10; // image + gap
      const textWidth = contentWidth - THUMB_WIDTH - 10;
      // Each gallery row needs at least thumbnail height + some padding
      const rowHeight = THUMB_HEIGHT + 10;

      for (let i = 0; i < galleries.length; i++) {
        const g = galleries[i];
        const thumbPath = thumbMap.get(g.id);

        // Check if we need a new page (need space for image + text)
        if (doc.y + rowHeight > 760) {
          doc.addPage();
        }

        const rowStartY = doc.y;

        // Try to embed the thumbnail image
        if (thumbPath && fs.existsSync(thumbPath)) {
          try {
            doc.image(thumbPath, pageMargin, rowStartY, {
              width: THUMB_WIDTH,
              height: THUMB_HEIGHT,
              fit: [THUMB_WIDTH, THUMB_HEIGHT],
            });
          } catch (imgErr: any) {
            log.warn(`Failed to embed image for ${g.id}: ${imgErr.message}`);
          }
        }

        // Text content positioned next to the thumbnail
        const textX = thumbPath ? textXOffset : pageMargin;
        const currentTextWidth = thumbPath ? textWidth : contentWidth;

        // Gallery number + ID + title
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text(`${i + 1}. [${g.id}] ${g.title}`, textX, rowStartY, {
            width: currentTextWidth,
            lineGap: 1,
          });

        // Metadata line
        const meta: string[] = [];
        if (g.language) meta.push(`Lang: ${g.language}`);
        if (g.category) meta.push(`Cat: ${g.category}`);
        if (g.pages > 0) meta.push(`${g.pages}p`);
        meta.push(`nhentai.net/g/${g.id}`);

        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor("#444444")
          .text(meta.join(" | "), textX, doc.y, { width: currentTextWidth });

        // Tags
        if (g.tags.length > 0) {
          doc
            .fontSize(7)
            .fillColor("#888888")
            .text(`Tags: ${formatTags(g.tags, 100)}`, textX, doc.y, {
              width: currentTextWidth,
            });
        }

        // Ensure the cursor moves past the thumbnail height
        const textEndY = doc.y;
        const minEndY = rowStartY + THUMB_HEIGHT + 5;
        if (textEndY < minEndY) {
          doc.y = minEndY;
        }

        // Separator line
        doc
          .strokeColor("#eeeeee")
          .lineWidth(0.3)
          .moveTo(pageMargin, doc.y)
          .lineTo(pageMargin + contentWidth, doc.y)
          .stroke();
        doc.moveDown(0.3);
      }

      // Footer
      doc
        .fontSize(7)
        .fillColor("#aaaaaa")
        .text(
          "\n---\nGenerated by nsaver bot",
          { align: "center" }
        );

      doc.end();

      stream.on("finish", () => {
        // Clean up downloaded thumbnails
        for (const [, thumbPath] of thumbMap) {
          cleanupThumbnail(thumbPath);
        }

        const stats = fs.statSync(filePath);
        log.info(
          `PDF generated: ${filePath} (${(stats.size / 1024).toFixed(1)} KB)`
        );
        resolve(filePath);
      });

      stream.on("error", (err) => {
        // Clean up thumbnails even on error
        for (const [, thumbPath] of thumbMap) {
          cleanupThumbnail(thumbPath);
        }
        reject(err);
      });
    } catch (err) {
      // Clean up thumbnails on sync error
      for (const [, thumbPath] of thumbMap) {
        cleanupThumbnail(thumbPath);
      }
      reject(err);
    }
  });
}

/** Clean up a temporary PDF file */
export function cleanupPdf(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.debug(`Cleaned up: ${filePath}`);
    }
  } catch (err) {
    log.warn(`Failed to clean up ${filePath}`);
  }
}
