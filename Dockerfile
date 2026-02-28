FROM python:3.12-slim

LABEL maintainer="nsaver"
LABEL description="nhentai favorites exporter via Telegram"

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY main.py .

# Run as non-root user
RUN useradd --create-home appuser
USER appuser

CMD ["python", "-u", "main.py"]
