# nsaver v3.0

nhentai gallery downloader Telegram bot -- downloads all images and packs them into ZIP files, with cover images, channel caching, and concurrent downloads inspired by [nZip](https://github.com/nZip-Team/nZip).

## Features

- **Per-user sessions** -- each user sends their own nhentai cookies via the bot
- **nZip-style ZIP download** -- concurrent image downloads with retry & exponential backoff, packed into ZIP archives (STORE mode, no compression)
- **Cover images from gallery** -- the first image of each gallery is used as the Telegram cover photo (no separate thumbnail lookup)
- **Gallery by code** -- `/get 177013` or just send a number to get a specific gallery
- **Private channel caching** -- ZIPs are uploaded to a private channel; subsequent requests forward from cache
- **Tag filtering** -- `/filter tag1,tag2` to export only galleries matching specific tags
- **Tag exclusion** -- `/exclude tag1,tag2` to exclude unwanted tags
- **Count limits** -- `/export 20` to limit the number of galleries
- **External MySQL** -- uses an external MySQL database to reduce server load
- **Modular architecture** -- separate modules for bot, scraper, ZIP, channel, DB, config
- **Polling mode** -- no webhook setup required

## Architecture

```
src/
├── index.ts              # Entry point (runs migrations + starts bot)
├── config/               # Environment & configuration
├── types/                # TypeScript interfaces (Gallery, ImagePage, etc.)
├── utils/
│   ├── logger.ts         # Color-coded logger
│   ├── helpers.ts        # Hash, chunk, escape utilities
│   └── thumbnail.ts      # Thumbnail download & cleanup (legacy, used as fallback)
├── db/
│   ├── schema/           # Drizzle ORM table definitions
│   ├── migrations/       # Auto-generated migrations
│   ├── connection.ts     # MySQL pool & Drizzle instance
│   └── migrate.ts        # Migration runner (runs at startup)
├── scraper/
│   ├── favorites.ts      # nhentai scraping logic (extracts mediaId + imagePages)
│   └── filter.ts         # Tag filtering & analysis
├── zip/
│   ├── generator.ts      # nZip-style download + archiver ZIP generation
│   └── index.ts          # Module exports
├── channel/
│   └── manager.ts        # Telegram channel cache + cover image (first gallery image)
├── bot/
│   ├── index.ts          # Bot creation & polling setup
│   ├── handlers/
│   │   ├── start.ts      # /start, /help
│   │   ├── session.ts    # /session, /session_quick, /status, /skip
│   │   ├── export.ts     # /export (ZIP)
│   │   ├── filter.ts     # /filter, /exclude, /tags (ZIP)
│   │   └── get.ts        # /get <code> + plain numeric messages (ZIP)
│   └── middleware/        # Logging middleware
└── services/
    ├── user.ts           # User & session DB operations
    └── gallery.ts        # Gallery DB operations
```

## Download Pipeline (nZip-inspired)

The download logic is ported from [nZip's Go core](https://github.com/nZip-Team/nZip/tree/main/Core):

1. **Image URL generation** -- builds URLs from `mediaId` + `imagePages` data (e.g., `https://i.nhentai.net/galleries/{mediaId}/{page}.{ext}`)
2. **Concurrent downloads** -- worker pool with configurable concurrency (default: 8)
3. **Retry with backoff** -- up to 10 retries per image, exponential backoff (500ms base, max 30s)
4. **CDN host rotation** -- tries multiple nhentai CDN hosts (i, i2, i3, i5, i7) on failure
5. **Atomic file writes** -- writes to `.tmp` then renames (prevents corrupt partial files)
6. **ZIP packing** -- uses `archiver` with STORE method (no compression) for maximum speed
7. **Cover from first image** -- the first downloaded image is sent as a Telegram photo alongside the ZIP

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and help |
| `/session` | Interactive session setup (step-by-step cookie input) |
| `/session_quick <sessionid> <csrftoken> <cf_clearance> [user-agent]` | One-shot session setup |
| `/status` | Check current session status |
| `/export [maxCount]` | Export gallery as ZIP with cover image |
| `/filter tag1,tag2 [maxCount]` | Export filtered by tags |
| `/exclude tag1,tag2 [maxCount]` | Export excluding specific tags |
| `/get <code>` | Get a specific gallery by nhentai code (e.g., `/get 177013`) |
| `<number>` | Send any number (1-7 digits) to get that gallery directly |
| `/tags` | Show top 30 tags from your favorites |
| `/skip` | Skip optional step during session setup |
| `/help` | Show help message |

## Quick Start

### 1. Prerequisites

- Docker (for containerized deployment)
- An external MySQL 8.0+ database
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A private Telegram channel (bot must be admin)

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your values (Telegram token, external MySQL credentials, etc.)
```

### 3. Run with Docker

```bash
docker build -t nsaver .
docker run -d --name nsaver --env-file .env --restart unless-stopped nsaver
```

### 4. Run locally

```bash
npm install
npm run build    # Compiles TypeScript
npm start        # Starts the bot (runs migrations automatically)
```

### 5. Development

```bash
npm run dev      # Watch mode with tsx
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token from BotFather |
| `TELEGRAM_CHANNEL_ID` | Yes | Private channel ID (bot must be admin) |
| `ADMIN_USER_IDS` | No | Comma-separated allowed Telegram user IDs |
| `MYSQL_HOST` | Yes | External MySQL host |
| `MYSQL_PORT` | Yes | MySQL port (default: 3306) |
| `MYSQL_USER` | Yes | MySQL username |
| `MYSQL_PASSWORD` | Yes | MySQL password |
| `MYSQL_DATABASE` | Yes | MySQL database name |
| `MAX_PAGES` | No | Max favorites pages to scrape (0 = all) |
| `REQUEST_DELAY` | No | Seconds between requests (default: 2) |
| `MAX_GALLERIES_PER_PDF` | No | Max galleries per export (default: 50) |

## How It Works

1. User sends `/session` -> bot walks through cookie input (sessionid, csrftoken, cf_clearance)
2. Cookies are stored in external MySQL, linked to user's Telegram ID
3. User sends `/export` or `/get <code>` -> bot fetches gallery metadata via nhentai API
4. Gallery `mediaId` and `imagePages` are extracted from the API response
5. All gallery images are downloaded concurrently (nZip-style worker pool with retry)
6. Images are packed into a ZIP archive (STORE mode, no compression)
7. **First image** of the gallery is sent as a cover photo alongside the ZIP
8. ZIP is uploaded to the private channel with cover + tags in caption
9. The channel message is cached in DB (file_id + filter hash)
10. On subsequent requests with same parameters, the cached file is forwarded directly

## License

MIT
