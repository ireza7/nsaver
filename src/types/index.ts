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
