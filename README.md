# nsaver

nhentai favorites exporter — fetches all gallery codes from your nhentai favorites and sends them to you via Telegram.

## How it works

1. Container starts, reads session cookies and Telegram config from environment variables
2. Scrapes all pages of your nhentai favorites list
3. Extracts gallery codes and titles
4. Sends a formatted list to a specified Telegram chat
5. Container exits

## Quick Start

### 1. Get your nhentai session cookies

Open nhentai in your browser, log in, then:
- **Chrome**: DevTools → Application → Cookies → `nhentai.net`
- Copy values for: `sessionid`, `csrftoken`, `cf_clearance`

### 2. Create a Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the steps
3. Copy the **bot token**
4. Send a message to your new bot, then get your **chat ID** via:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 4. Run

```bash
# With docker compose
docker compose up --build

# Or with plain docker
docker build -t nsaver .
docker run --rm --env-file .env nsaver
```

The container will scrape all favorites, send results to Telegram, and exit automatically.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NHENTAI_SESSIONID` | Yes | `sessionid` cookie from nhentai |
| `NHENTAI_CSRFTOKEN` | Yes | `csrftoken` cookie from nhentai |
| `NHENTAI_CF_CLEARANCE` | Yes | `cf_clearance` cookie (Cloudflare) |
| `NHENTAI_USER_AGENT` | No | Browser User-Agent string (has sensible default) |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot API token from BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Target Telegram user/chat ID |
| `MAX_PAGES` | No | Limit number of pages to scrape (0 = all, default: 0) |
| `REQUEST_DELAY` | No | Seconds between requests (default: 2) |

## Output Example

The bot sends messages like:

```
nsaver - nhentai Favorites
Total: 125

1. 632562 - [Title Here]
2. 627977 - [Another Title]
3. 626430 - [Title]
...
```

## Notes

- `cf_clearance` cookie expires frequently. If you get 403 errors, refresh it from your browser.
- The script respects rate limits with a configurable delay between requests (default 2s).
- Long lists are automatically split into multiple Telegram messages.
