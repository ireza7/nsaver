#!/usr/bin/env python3
"""
nsaver - nhentai Favorites Exporter via Telegram
Fetches all favorite gallery codes from an nhentai account
and sends them to a specified Telegram user.
"""

import os
import re
import sys
import time
import logging
import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("nsaver")

# ---------------------------------------------------------------------------
# Environment variables
# ---------------------------------------------------------------------------
NHENTAI_SESSIONID = os.environ.get("NHENTAI_SESSIONID", "")
NHENTAI_CSRFTOKEN = os.environ.get("NHENTAI_CSRFTOKEN", "")
NHENTAI_CF_CLEARANCE = os.environ.get("NHENTAI_CF_CLEARANCE", "")
NHENTAI_USER_AGENT = os.environ.get(
    "NHENTAI_USER_AGENT",
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/145.0.0.0 Safari/537.36"
    ),
)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# Optional: maximum number of pages to scrape (0 = unlimited)
MAX_PAGES = int(os.environ.get("MAX_PAGES", "0"))

# Delay between requests in seconds (be respectful)
REQUEST_DELAY = float(os.environ.get("REQUEST_DELAY", "2"))


def validate_env() -> None:
    """Make sure all required environment variables are set."""
    missing: list[str] = []
    if not NHENTAI_SESSIONID:
        missing.append("NHENTAI_SESSIONID")
    if not NHENTAI_CSRFTOKEN:
        missing.append("NHENTAI_CSRFTOKEN")
    if not NHENTAI_CF_CLEARANCE:
        missing.append("NHENTAI_CF_CLEARANCE")
    if not TELEGRAM_BOT_TOKEN:
        missing.append("TELEGRAM_BOT_TOKEN")
    if not TELEGRAM_CHAT_ID:
        missing.append("TELEGRAM_CHAT_ID")
    if missing:
        log.error("Missing required environment variables: %s", ", ".join(missing))
        sys.exit(1)


# ---------------------------------------------------------------------------
# nhentai scraper
# ---------------------------------------------------------------------------
BASE_URL = "https://nhentai.net"


def build_session() -> requests.Session:
    """Return a requests.Session pre-configured with nhentai cookies & headers."""
    sess = requests.Session()
    sess.cookies.set("csrftoken", NHENTAI_CSRFTOKEN, domain="nhentai.net", path="/")
    sess.cookies.set("sessionid", NHENTAI_SESSIONID, domain="nhentai.net", path="/")
    sess.cookies.set(
        "cf_clearance", NHENTAI_CF_CLEARANCE, domain="nhentai.net", path="/"
    )
    sess.headers.update(
        {
            "User-Agent": NHENTAI_USER_AGENT,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;"
                "q=0.9,image/avif,image/webp,image/apng,*/*;"
                "q=0.8,application/signed-exchange;v=b3;q=0.7"
            ),
            "Accept-Language": "en,fa;q=0.9",
            "Referer": f"{BASE_URL}/",
            "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
        }
    )
    return sess


def extract_gallery_codes(html: str) -> list[str]:
    """Extract gallery numeric codes from an nhentai favorites HTML page."""
    soup = BeautifulSoup(html, "html.parser")
    codes: list[str] = []

    # Each gallery on the favorites page is wrapped in an <a> tag
    # with class "cover" and href like /g/123456/
    for anchor in soup.select("a.cover"):
        href = anchor.get("href", "")
        match = re.search(r"/g/(\d+)/", href)
        if match:
            codes.append(match.group(1))

    return codes


def get_last_page(html: str) -> int:
    """Detect last page number from pagination on the favorites page."""
    soup = BeautifulSoup(html, "html.parser")
    last = 1

    # nhentai uses <a class="last" href="?page=N"> for the last page link
    last_link = soup.select_one("a.last")
    if last_link:
        href = last_link.get("href", "")
        match = re.search(r"page=(\d+)", href)
        if match:
            last = int(match.group(1))
            return last

    # Fallback: look at all page links
    for link in soup.select("section.pagination a"):
        href = link.get("href", "")
        match = re.search(r"page=(\d+)", href)
        if match:
            page_num = int(match.group(1))
            if page_num > last:
                last = page_num

    return last


def extract_gallery_titles(html: str) -> dict[str, str]:
    """Extract gallery codes and their titles from the favorites page."""
    soup = BeautifulSoup(html, "html.parser")
    result: dict[str, str] = {}

    for container in soup.select("div.gallery"):
        anchor = container.select_one("a.cover")
        caption = container.select_one("div.caption")
        if anchor:
            href = anchor.get("href", "")
            match = re.search(r"/g/(\d+)/", href)
            if match:
                code = match.group(1)
                title = caption.get_text(strip=True) if caption else ""
                result[code] = title

    return result


def fetch_all_favorites(sess: requests.Session) -> list[dict]:
    """Scrape all favorites pages and return list of {code, title, url}."""
    log.info("Fetching first favorites page ...")
    resp = sess.get(f"{BASE_URL}/favorites/")
    resp.raise_for_status()

    last_page = get_last_page(resp.text)
    if MAX_PAGES > 0:
        last_page = min(last_page, MAX_PAGES)
    log.info("Total pages to scrape: %d", last_page)

    all_galleries: list[dict] = []

    # Process page 1
    galleries = extract_gallery_titles(resp.text)
    for code, title in galleries.items():
        all_galleries.append(
            {"code": code, "title": title, "url": f"{BASE_URL}/g/{code}/"}
        )
    log.info("Page 1: found %d galleries", len(galleries))

    # Process remaining pages
    for page in range(2, last_page + 1):
        time.sleep(REQUEST_DELAY)
        log.info("Fetching page %d/%d ...", page, last_page)
        resp = sess.get(f"{BASE_URL}/favorites/", params={"page": page})
        resp.raise_for_status()

        galleries = extract_gallery_titles(resp.text)
        for code, title in galleries.items():
            all_galleries.append(
                {"code": code, "title": title, "url": f"{BASE_URL}/g/{code}/"}
            )
        log.info("Page %d: found %d galleries", page, len(galleries))

    log.info("Total galleries collected: %d", len(all_galleries))
    return all_galleries


# ---------------------------------------------------------------------------
# Telegram sender
# ---------------------------------------------------------------------------
TELEGRAM_API = "https://api.telegram.org"
MAX_MSG_LENGTH = 4000  # Telegram limit is 4096, leave some margin


def send_telegram_message(text: str) -> None:
    """Send a message to the configured Telegram chat."""
    url = f"{TELEGRAM_API}/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    resp = requests.post(url, json=payload, timeout=30)
    if not resp.ok:
        log.error("Telegram API error: %s %s", resp.status_code, resp.text)
    resp.raise_for_status()


def format_and_send(galleries: list[dict]) -> None:
    """Format the gallery list and send via Telegram (chunked if needed)."""
    if not galleries:
        send_telegram_message("<b>nsaver:</b> No favorites found.")
        return

    header = f"<b>nsaver - nhentai Favorites</b>\nTotal: <b>{len(galleries)}</b>\n\n"
    lines: list[str] = []
    for i, g in enumerate(galleries, 1):
        title_part = f" - {g['title']}" if g["title"] else ""
        lines.append(f"{i}. <code>{g['code']}</code>{title_part}")

    # Build chunks that fit within Telegram message size limit
    chunks: list[str] = []
    current_chunk = header
    for line in lines:
        if len(current_chunk) + len(line) + 1 > MAX_MSG_LENGTH:
            chunks.append(current_chunk)
            current_chunk = ""
        current_chunk += line + "\n"
    if current_chunk.strip():
        chunks.append(current_chunk)

    log.info("Sending %d message(s) to Telegram ...", len(chunks))
    for idx, chunk in enumerate(chunks, 1):
        send_telegram_message(chunk)
        log.info("Sent message %d/%d", idx, len(chunks))
        if idx < len(chunks):
            time.sleep(1)  # Rate limit


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=== nsaver started ===")
    validate_env()

    sess = build_session()

    try:
        galleries = fetch_all_favorites(sess)
    except requests.HTTPError as exc:
        log.error("HTTP error while fetching favorites: %s", exc)
        try:
            send_telegram_message(
                f"<b>nsaver error:</b> Failed to fetch favorites.\n"
                f"<code>{exc}</code>"
            )
        except Exception:
            pass
        sys.exit(1)

    format_and_send(galleries)
    log.info("=== nsaver finished ===")


if __name__ == "__main__":
    main()
