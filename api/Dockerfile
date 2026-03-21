FROM python:3.12-slim

# Install system dependencies (git for forge sync, ffmpeg for transcoding)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    curl \
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

# Default: run the API server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
