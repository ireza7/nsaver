# nsaver v2.1

nhentai favorites exporter — a Telegram bot that lets each user send their session cookies, scrapes favorites, generates compact PDFs with cover images, caches them in a private channel, and forwards on demand.

## Features

- **Per-user sessions** — each user sends their own nhentai cookies via the bot (no hardcoded env vars)
- **PDF export** — compact, small-size PDFs with gallery info and tags
- **Cover images** — each export includes the cover thumbnail sent alongside the PDF
- **Gallery by code** — `/get 177013` or just send a number to get a specific gallery
- **Private channel caching** — PDFs are uploaded to a private channel with tags + user info; subsequent requests forward from cache
- **Tag filtering** — `/filter tag1,tag2` to export only galleries matching specific tags
- **Tag exclusion** — `/exclude tag1,tag2` to exclude unwanted tags
- **Count limits** — `/export 20` to limit the number of galleries
- **External MySQL** — uses an external MySQL database to reduce server load
- **Modular architecture** — separate modules for bot, scraper, PDF, channel, DB, config
- **Polling mode** — no webhook setup required

## Architecture

```
src/
├── index.ts              # Entry point (runs migrations + starts bot)
├── config/               # Environment & configuration
├── types/                # TypeScript interfaces
├── utils/
│   ├── logger.ts         # Color-coded logger
│   ├── helpers.ts        # Hash, chunk, escape utilities
│   └── thumbnail.ts      # Thumbnail download & cleanup
├── db/
│   ├── schema/           # Drizzle ORM table definitions
│   ├── migrations/       # Auto-generated migrations
│   ├── connection.ts     # MySQL pool & Drizzle instance
│   └── migrate.ts        # Migration runner (runs at startup)
├── scraper/
│   ├── favorites.ts      # nhentai scraping logic
│   └── filter.ts         # Tag filtering & analysis
├── pdf/
│   └── generator.ts      # PDFKit-based PDF generation
├── channel/
│   └── manager.ts        # Telegram channel cache + cover image handling
├── bot/
│   ├── index.ts          # Bot creation & polling setup
│   ├── handlers/
│   │   ├── start.ts      # /start, /help
│   │   ├── session.ts    # /session, /session_quick, /status, /skip
│   │   ├── export.ts     # /export
│   │   ├── filter.ts     # /filter, /exclude, /tags
│   │   └── get.ts        # /get <code> + plain numeric messages
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
| `/export [maxCount]` | Export all favorites as PDF with cover image |
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
| `MAX_GALLERIES_PER_PDF` | No | Max galleries per PDF (default: 50) |

## How It Works

1. User sends `/session` → bot walks through cookie input (sessionid, csrftoken, cf_clearance)
2. Cookies are stored in external MySQL, linked to user's Telegram ID
3. User sends `/export` → bot scrapes nhentai favorites using stored cookies
4. Galleries are saved to DB with tags, language, category metadata
5. A compact PDF is generated with all gallery info
6. **Cover image** of the first gallery is sent as a photo alongside the PDF
7. PDF is uploaded to the private channel with cover + tags in caption
8. The channel message is cached in DB (file_id + filter hash)
9. On subsequent requests with same filters, the cached file is forwarded directly
10. User can send `/get 123456` or just type `123456` to get a specific gallery with cover + PDF

## License

MIT
