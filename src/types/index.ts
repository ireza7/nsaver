/** Image page type code from nhentai API (j=jpg, p=png, g=gif, w=webp) */
export type ImageTypeCode = "j" | "p" | "g" | "w";

/** A single image page from the nhentai API */
export interface ImagePage {
  t: ImageTypeCode;
  w: number;
  h: number;
}

/** Represents a single nhentai gallery extracted from favorites */
export interface Gallery {
  id: number;
  title: string;
  tags: string[];
  language: string;
  category: string;
  thumbnail: string;
  pages: number;
  uploadDate: string;
  /** nhentai media_id — needed to build image download URLs */
  mediaId: string;
  /** Per-page image metadata from the API (type, width, height) */
  imagePages: ImagePage[];
}

/** User-provided nhentai session cookies */
export interface NhentaiSession {
  sessionId: string;
  csrfToken: string;
  cfClearance: string;
  userAgent?: string;
}

/** Result of a scrape operation */
export interface ScrapeResult {
  galleries: Gallery[];
  totalPages: number;
  scrapedPages: number;
  errors: string[];
}

/** Filter options for gallery export */
export interface FilterOptions {
  tags?: string[];
  excludeTags?: string[];
  maxCount?: number;
  language?: string;
}

/** Channel cache entry info */
export interface ChannelCacheInfo {
  messageId: number;
  fileId: string;
  description: string;
  tags: string[];
  createdAt: Date;
}
