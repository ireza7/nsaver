FROM node:22-slim

LABEL maintainer="nsaver"
LABEL description="nhentai favorites exporter Telegram bot with PDF, channel caching, and external MySQL"

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# Copy source
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src

# Build TypeScript (skip migration — external DB not available at build time)
RUN npx tsc

# Run as non-root user
RUN useradd --create-home appuser
USER appuser

# Migration runs at startup, then bot starts
CMD ["node", "dist/index.js"]
