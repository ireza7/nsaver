import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { createLogger } from "../utils/index.js";

const log = createLogger("user-service");

/** Ensure user exists in DB, create if not. Returns internal user ID. */
export async function ensureUser(
  telegramId: number,
  username?: string,
  firstName?: string
): Promise<number> {
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.telegramId, telegramId))
    .limit(1);

  if (existing.length > 0) {
    // Update username/firstName if changed
    await db
      .update(schema.users)
      .set({
        username: username || existing[0].username,
        firstName: firstName || existing[0].firstName,
      })
      .where(eq(schema.users.id, existing[0].id));
    return existing[0].id;
  }

  const result = await db.insert(schema.users).values({
    telegramId,
    username: username || null,
    firstName: firstName || null,
  });

  log.info(`New user created: ${telegramId} (${username || "no username"})`);
  return result[0].insertId;
}

/** Save or update user session */
export async function saveSession(
  userId: number,
  sessionId: string,
  csrfToken: string,
  cfClearance: string,
  userAgent?: string
): Promise<void> {
  const db = getDb();

  // Invalidate old sessions
  await db
    .update(schema.sessions)
    .set({ isValid: false })
    .where(eq(schema.sessions.userId, userId));

  // Insert new session
  await db.insert(schema.sessions).values({
    userId,
    sessionId,
    csrfToken,
    cfClearance,
    userAgent: userAgent || null,
  });

  log.info(`Session saved for user ${userId}`);
}

/** Get the latest valid session for a user */
export async function getActiveSession(
  userId: number
): Promise<{
  sessionId: string;
  csrfToken: string;
  cfClearance: string;
  userAgent: string | null;
} | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        eq(schema.sessions.isValid, true)
      )
    )
    .orderBy(desc(schema.sessions.createdAt))
    .limit(1);

  if (rows.length === 0) return null;
  const s = rows[0];

  return {
    sessionId: s.sessionId,
    csrfToken: s.csrfToken,
    cfClearance: s.cfClearance,
    userAgent: s.userAgent,
  };
}
