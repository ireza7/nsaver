# nsaver v2.0

nhentai favorites exporter — a Telegram bot that lets each user send their session cookies, scrapes favorites, generates compact PDFs, caches them in a private channel, and forwards on demand.

## Features

- **Per-user sessions** — each user sends their own nhentai cookies via the bot (no hardcoded env vars)
- **PDF export** — compact, small-size PDFs with gallery info, tags, nZip download links
- **Private channel caching** — PDFs are uploaded to a private channel with tags + user info in the description; subsequent requests forward from cache instead of re-uploading
- **Tag filtering** — `/filter tag1,tag2` to export only galleries matching specific tags
- **Tag exclusion** — `/exclude tag1,tag2` to exclude unwanted tags
- **Count limits** — `/export 20` to limit the number of galleries
- **nZip integration** — each gallery includes a direct nZip download link
- **MySQL + Drizzle ORM** — structured database with auto-migration on build
- **Modular architecture** — separate modules for bot, scraper, PDF, channel, DB, config
- **Polling mode** — no webhook setup required

## Architecture

```
src/
├── index.ts              # Entry point
├── config/               # Environment & configuration
├── types/                # TypeScript interfaces
├── utils/                # Logger, helpers
├── db/
│   ├── schema/           # Drizzle ORM table definitions
│   ├── migrations/       # Auto-generated migrations
│   ├── connection.ts     # MySQL pool & Drizzle instance
│   └── migrate.ts        # Migration runner
├── scraper/
│   ├── favorites.ts      # nhentai scraping logic
│   └── filter.ts         # Tag filtering & analysis
├── pdf/
│   └── generator.ts      # PDFKit-based PDF generation
├── channel/
│   └── manager.ts        # Telegram channel cache management
├── bot/
│   ├── index.ts          # Bot creation & polling setup
│   ├── handlers/         # Command handlers (start, session, export, filter)
│   └── middleware/        # Logging middleware
└── services/
    ├── user.ts           # User & session DB operations
    └── gallery.ts        # Gallery DB operations
```

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and help |
| `/session` | Interactive session setup (step-by-step cookie input) |
| `/session_quick <sessionid> <csrftoken> <cf_clearance> [user-agent]` | One-shot session setup |
| `/status` | Check current session status |
| `/export [maxCount]` | Export all favorites as PDF |
| `/filter tag1,tag2 [maxCount]` | Export filtered by tags |
| `/exclude tag1,tag2 [maxCount]` | Export excluding specific tags |
| `/tags` | Show top 30 tags from your favorites |
| `/skip` | Skip optional step during session setup |
| `/help` | Show help message |

## Quick Start

### 1. Prerequisites

- Node.js >= 20
- MySQL 8.0+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A private Telegram channel (bot must be admin)

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run with Docker

```bash
docker compose up --build -d
```

### 4. Run locally

```bash
npm install
npm run build    # Compiles TypeScript + runs migrations
npm start        # Starts the bot
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
| `MYSQL_HOST` | Yes | MySQL host (default: 127.0.0.1) |
| `MYSQL_PORT` | Yes | MySQL port (default: 3306) |
| `MYSQL_USER` | Yes | MySQL username |
| `MYSQL_PASSWORD` | Yes | MySQL password |
| `MYSQL_DATABASE` | Yes | MySQL database name |
| `NZIP_BASE_URL` | No | nZip base URL (default: https://nhentai.zip) |
| `MAX_PAGES` | No | Max favorites pages to scrape (0 = all) |
| `REQUEST_DELAY` | No | Seconds between requests (default: 2) |
| `MAX_GALLERIES_PER_PDF` | No | Max galleries per PDF (default: 50) |

## How It Works

1. User sends `/session` → bot walks through cookie input (sessionid, csrftoken, cf_clearance)
2. Cookies are stored encrypted in MySQL, linked to user's Telegram ID
3. User sends `/export` → bot scrapes nhentai favorites using stored cookies
4. Galleries are saved to DB with tags, language, category metadata
5. A compact PDF is generated with all gallery info + nZip download links
6. PDF is uploaded to the private channel with tags + user info in caption
7. The channel message is cached in DB (file_id + filter hash)
8. On subsequent requests with same filters, the cached file is forwarded directly
9. Tag filtering with `/filter` and `/exclude` creates separate cached exports

## License

MIT
