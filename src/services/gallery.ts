import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { createLogger } from "../utils/index.js";
import type { Gallery } from "../types/index.js";

const log = createLogger("gallery-service");

/** Save galleries to DB and link them to user */
export async function saveGalleries(
  userId: number,
  galleries: Gallery[]
): Promise<void> {
  const db = getDb();

  for (const g of galleries) {
    // Upsert gallery
    const existing = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.nhentaiId, g.id))
      .limit(1);

    let galleryId: number;

    if (existing.length > 0) {
      galleryId = existing[0].id;
      // Update metadata
      await db
        .update(schema.galleries)
        .set({
          title: g.title,
          tags: g.tags,
          language: g.language,
          category: g.category,
          pages: g.pages,
          thumbnail: g.thumbnail,
        })
        .where(eq(schema.galleries.id, galleryId));
    } else {
      const result = await db.insert(schema.galleries).values({
        nhentaiId: g.id,
        title: g.title,
        tags: g.tags,
        language: g.language,
        category: g.category,
        pages: g.pages,
        thumbnail: g.thumbnail,
      });
      galleryId = result[0].insertId;
    }

    // Link to user (ignore duplicate)
    try {
      await db.insert(schema.userFavorites).values({
        userId,
        galleryId,
      });
    } catch (err: any) {
      // Duplicate entry is fine
      if (!err.message?.includes("Duplicate")) {
        log.warn(`Failed to link gallery ${g.id} to user ${userId}:`, err.message);
      }
    }
  }

  log.info(`Saved ${galleries.length} galleries for user ${userId}`);
}

/** Get all galleries for a user from DB */
export async function getUserGalleries(
  userId: number
): Promise<Gallery[]> {
  const db = getDb();

  const rows = await db
    .select({
      nhentaiId: schema.galleries.nhentaiId,
      title: schema.galleries.title,
      tags: schema.galleries.tags,
      language: schema.galleries.language,
      category: schema.galleries.category,
      pages: schema.galleries.pages,
      thumbnail: schema.galleries.thumbnail,
    })
    .from(schema.userFavorites)
    .innerJoin(
      schema.galleries,
      eq(schema.userFavorites.galleryId, schema.galleries.id)
    )
    .where(eq(schema.userFavorites.userId, userId));

  return rows.map((r) => ({
    id: r.nhentaiId,
    title: r.title,
    tags: r.tags,
    language: r.language,
    category: r.category,
    pages: r.pages,
    thumbnail: r.thumbnail,
    uploadDate: "",
    mediaId: "",
    imagePages: [],
  }));
}
