FROM python:3.12-slim

# Install system dependencies (git for forge sync, ffmpeg for transcoding, node for remotion banner)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    curl \
    # Chromium deps required by Remotion's headless browser
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libxshmfence1 libx11-xcb1 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt httpx

# Copy application code
COPY . .

# Create storage directories
RUN mkdir -p storage/videos storage/thumbnails storage/media

EXPOSE 8000

# Default: run the API server on the internal service port
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
