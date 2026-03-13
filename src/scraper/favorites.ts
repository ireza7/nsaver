import * as cheerio from "cheerio";
import { env } from "../config/env.js";
import { createLogger, sleep } from "../utils/index.js";
import type { Gallery, NhentaiSession, ScrapeResult } from "../types/index.js";

const log = createLogger("scraper");

const BASE_URL = "https://nhentai.net";

function buildHeaders(session: NhentaiSession): Record<string, string> {
  return {
    Cookie: `sessionid=${session.sessionId}; csrftoken=${session.csrfToken}; cf_clearance=${session.cfClearance}`,
    "User-Agent": session.userAgent || env.NHENTAI_USER_AGENT,
    Referer: BASE_URL,
  };
}

/** Fetch a single HTML page with retry */
async function fetchPage(
  url: string,
  headers: Record<string, string>,
  retries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (res.status === 403) {
        throw new Error("403 Forbidden — session cookies may be expired");
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      log.warn(`Attempt ${attempt} failed for ${url}, retrying...`);
      await sleep(2000 * attempt);
    }
  }
  throw new Error("Unreachable");
}

/** Parse tags from a gallery detail page HTML */
function parseTags($: cheerio.CheerioAPI): string[] {
  const tags: string[] = [];
  $(".tag-container")
    .filter(function () {
      const label = $(this).text().trim().toLowerCase();
      return label.startsWith("tags:");
    })
    .find("a.tag span.name")
    .each(function () {
      const name = $(this).text().trim();
      if (name) tags.push(name);
    });
  return tags;
}

/** Parse language from tag container */
function parseLanguage($: cheerio.CheerioAPI): string {
  let language = "";
  $(".tag-container")
    .filter(function () {
      return $(this).text().trim().toLowerCase().startsWith("languages:");
    })
    .find("a.tag span.name")
    .each(function () {
      const name = $(this).text().trim().toLowerCase();
      if (name !== "translated") language = name;
    });
  return language;
}

/** Parse category from tag container */
function parseCategory($: cheerio.CheerioAPI): string {
  let category = "";
  $(".tag-container")
    .filter(function () {
      return $(this).text().trim().toLowerCase().startsWith("categories:");
    })
    .find("a.tag span.name")
    .each(function () {
      category = $(this).text().trim();
    });
  return category;
}

/** Parse a gallery listing page and return gallery IDs and titles */
function parseFavoritesPage(
  html: string
): { id: number; title: string; thumbnail: string }[] {
  const $ = cheerio.load(html);
  const items: { id: number; title: string; thumbnail: string }[] = [];

  $(".gallery-favorite").each(function () {
    const link = $(this).find("a").first();
    const href = link.attr("href") || "";
    const match = href.match(/\/g\/(\d+)\//);
    if (!match) return;

    const id = parseInt(match[1], 10);
    const title = $(this).find(".caption").text().trim() || `#${id}`;
    const thumb = $(this).find("img").attr("data-src") || $(this).find("img").attr("src") || "";

    items.push({ id, title, thumbnail: thumb });
  });

  return items;
}

/** Get total number of favorites pages */
function parseTotalPages(html: string): number {
  const $ = cheerio.load(html);
  const lastPage = $(".pagination .last").attr("href");
  if (lastPage) {
    const match = lastPage.match(/page=(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  // Check current page buttons
  let max = 1;
  $(".pagination a.page").each(function () {
    const num = parseInt($(this).text().trim(), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  return max;
}

/** Fetch full detail for a gallery to get tags, pages, etc. */
export async function fetchGalleryDetail(
  galleryId: number,
  session: NhentaiSession
): Promise<Partial<Gallery>> {
  const url = `${BASE_URL}/g/${galleryId}/`;
  const headers = buildHeaders(session);
  const html = await fetchPage(url, headers);
  const $ = cheerio.load(html);

  const tags = parseTags($);
  const language = parseLanguage($);
  const category = parseCategory($);

  let pages = 0;
  $(".tag-container")
    .filter(function () {
      return $(this).text().trim().toLowerCase().startsWith("pages:");
    })
    .find("a.tag span.name")
    .each(function () {
      pages = parseInt($(this).text().trim(), 10) || 0;
    });

  return { tags, language, category, pages };
}

/**
 * Fetch gallery detail via the public nhentai API (no session required).
 * Uses https://nhentai.net/api/gallery/{id} which returns JSON.
 */
export async function fetchGalleryPublic(
  galleryId: number
): Promise<Gallery> {
  const url = `${BASE_URL}/api/gallery/${galleryId}`;
  const headers: Record<string, string> = {
    "User-Agent": env.NHENTAI_USER_AGENT,
    Accept: "application/json",
  };

  let body: string;
  try {
    body = await fetchPage(url, headers);
  } catch (err: any) {
    throw new Error(`Failed to fetch gallery #${galleryId}: ${err.message}`);
  }

  const data = JSON.parse(body);

  // Parse title
  const title =
    data.title?.pretty ||
    data.title?.english ||
    data.title?.japanese ||
    `#${galleryId}`;

  // Parse tags grouped by type
  const tags: string[] = [];
  let language = "";
  let category = "";

  if (Array.isArray(data.tags)) {
    for (const tag of data.tags) {
      if (tag.type === "tag") {
        tags.push(tag.name);
      } else if (tag.type === "language" && tag.name !== "translated") {
        language = tag.name;
      } else if (tag.type === "category") {
        category = tag.name;
      }
    }
  }

  // Pages count
  const pages = data.num_pages || (Array.isArray(data.images?.pages) ? data.images.pages.length : 0);

  // Thumbnail
  const mediaId = data.media_id || "";
  let thumbnail = "";
  if (mediaId && data.images?.cover) {
    const ext = data.images.cover.t === "j" ? "jpg" : data.images.cover.t === "p" ? "png" : "jpg";
    thumbnail = `https://t.nhentai.net/galleries/${mediaId}/cover.${ext}`;
  }

  // Upload date
  const uploadDate = data.upload_date
    ? new Date(data.upload_date * 1000).toISOString().split("T")[0]
    : "";

  return {
    id: galleryId,
    title,
    tags,
    language,
    category,
    pages,
    thumbnail,
    uploadDate,
  };
}

/** Main scraping function: fetches all favorites for a session */
export async function scrapeFavorites(
  session: NhentaiSession,
  onProgress?: (current: number, total: number) => void
): Promise<ScrapeResult> {
  const headers = buildHeaders(session);
  const result: ScrapeResult = {
    galleries: [],
    totalPages: 0,
    scrapedPages: 0,
    errors: [],
  };

  log.info("Starting favorites scrape...");

  // Fetch first page to determine total
  const firstPageUrl = `${BASE_URL}/favorites/`;
  let firstHtml: string;
  try {
    firstHtml = await fetchPage(firstPageUrl, headers);
  } catch (err: any) {
    result.errors.push(`Failed to fetch first page: ${err.message}`);
    return result;
  }

  result.totalPages = parseTotalPages(firstHtml);
  const maxPages =
    env.MAX_PAGES > 0
      ? Math.min(env.MAX_PAGES, result.totalPages)
      : result.totalPages;

  log.info(`Found ${result.totalPages} pages, will scrape ${maxPages}`);

  // Process all pages
  for (let page = 1; page <= maxPages; page++) {
    try {
      const url =
        page === 1 ? firstPageUrl : `${BASE_URL}/favorites/?page=${page}`;
      const html = page === 1 ? firstHtml : await fetchPage(url, headers);
      const items = parseFavoritesPage(html);

      for (const item of items) {
        result.galleries.push({
          id: item.id,
          title: item.title,
          tags: [],
          language: "",
          category: "",
          thumbnail: item.thumbnail,
          pages: 0,
          uploadDate: "",
        });
      }

      result.scrapedPages++;
      if (onProgress) onProgress(page, maxPages);
      log.info(`Page ${page}/${maxPages}: ${items.length} galleries`);

      if (page < maxPages) {
        await sleep(env.REQUEST_DELAY * 1000);
      }
    } catch (err: any) {
      result.errors.push(`Page ${page}: ${err.message}`);
      log.error(`Error on page ${page}:`, err.message);
    }
  }

  // Fetch details for each gallery (tags, language, etc.)
  log.info(`Fetching details for ${result.galleries.length} galleries...`);
  for (let i = 0; i < result.galleries.length; i++) {
    const g = result.galleries[i];
    try {
      const detail = await fetchGalleryDetail(g.id, session);
      g.tags = detail.tags || [];
      g.language = detail.language || "";
      g.category = detail.category || "";
      g.pages = detail.pages || 0;
      if (onProgress) onProgress(i + 1, result.galleries.length);
    } catch (err: any) {
      log.warn(`Failed to get details for ${g.id}: ${err.message}`);
    }
    if (i < result.galleries.length - 1) {
      await sleep(env.REQUEST_DELAY * 1000);
    }
  }

  log.info(
    `Scrape complete: ${result.galleries.length} galleries from ${result.scrapedPages} pages`
  );
  return result;
}
