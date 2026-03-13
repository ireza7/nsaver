import crypto from "crypto";
import type { FilterOptions } from "../types/index.js";

/** Sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Create a deterministic hash for filter options (used for cache lookup) */
export function hashFilters(
  userId: number,
  filters: FilterOptions
): string {
  const payload = JSON.stringify({ userId, ...filters });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/** Chunk an array into smaller pieces */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** Escape Telegram MarkdownV2 special chars */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/** Truncate text to maxLen and add ellipsis */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
