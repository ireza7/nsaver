import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  json,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/** Telegram users who interact with the bot */
export const users = mysqlTable("users", {
  id: int("id").primaryKey().autoincrement(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: varchar("username", { length: 255 }),
  firstName: varchar("first_name", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/** Stored nhentai sessions per user */
export const sessions = mysqlTable("sessions", {
  id: int("id").primaryKey().autoincrement(),
  userId: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id", { length: 512 }).notNull(),
  csrfToken: varchar("csrf_token", { length: 512 }).notNull(),
  cfClearance: varchar("cf_clearance", { length: 512 }).notNull(),
  userAgent: text("user_agent"),
  isValid: boolean("is_valid").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/** Gallery metadata cache */
export const galleries = mysqlTable(
  "galleries",
  {
    id: int("id").primaryKey().autoincrement(),
    nhentaiId: int("nhentai_id").notNull(),
    title: varchar("title", { length: 1024 }).notNull(),
    tags: json("tags").$type<string[]>().notNull(),
    language: varchar("language", { length: 64 }).notNull().default(""),
    category: varchar("category", { length: 64 }).notNull().default(""),
    pages: int("pages").notNull().default(0),
    thumbnail: varchar("thumbnail", { length: 1024 }).notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("nhentai_id_idx").on(table.nhentaiId)]
);

/** Tracks which users have which galleries as favorites */
export const userFavorites = mysqlTable(
  "user_favorites",
  {
    id: int("id").primaryKey().autoincrement(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    galleryId: int("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_gallery_idx").on(table.userId, table.galleryId),
  ]
);

/** Channel message cache — avoids re-uploading PDFs */
export const channelCache = mysqlTable("channel_cache", {
  id: int("id").primaryKey().autoincrement(),
  userId: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  telegramMessageId: int("telegram_message_id").notNull(),
  telegramFileId: varchar("telegram_file_id", { length: 512 }).notNull(),
  description: text("description"),
  filterHash: varchar("filter_hash", { length: 128 }).notNull(),
  tags: json("tags").$type<string[]>().notNull().default([]),
  galleryCount: int("gallery_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Export jobs / history */
export const exportJobs = mysqlTable("export_jobs", {
  id: int("id").primaryKey().autoincrement(),
  userId: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  filterHash: varchar("filter_hash", { length: 128 }).notNull().default(""),
  galleryCount: int("gallery_count").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
