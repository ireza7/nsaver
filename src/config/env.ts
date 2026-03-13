import "dotenv/config";

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const env = {
  // Telegram
  TELEGRAM_BOT_TOKEN: required("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_CHANNEL_ID: required("TELEGRAM_CHANNEL_ID"),
  ADMIN_USER_IDS: optional("ADMIN_USER_IDS", "")
    .split(",")
    .filter(Boolean)
    .map(Number),

  // MySQL
  MYSQL_HOST: optional("MYSQL_HOST", "127.0.0.1"),
  MYSQL_PORT: optionalInt("MYSQL_PORT", 3306),
  MYSQL_USER: optional("MYSQL_USER", "nsaver"),
  MYSQL_PASSWORD: optional("MYSQL_PASSWORD", "nsaver_password"),
  MYSQL_DATABASE: optional("MYSQL_DATABASE", "nsaver"),

  // nZip
  NZIP_BASE_URL: optional("NZIP_BASE_URL", "https://nhentai.zip"),

  // Scraping
  MAX_PAGES: optionalInt("MAX_PAGES", 0),
  REQUEST_DELAY: optionalInt("REQUEST_DELAY", 2),
  MAX_GALLERIES_PER_PDF: optionalInt("MAX_GALLERIES_PER_PDF", 50),
  NHENTAI_USER_AGENT: optional(
    "NHENTAI_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  ),
};

export type Env = typeof env;
