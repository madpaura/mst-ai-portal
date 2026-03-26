#!/bin/bash
set -e

echo "Building Docker images from local source..."
# Explicitly use docker-compose instead of docker compose, just in case
docker-compose build

echo "Pulling required external images (PostgreSQL)..."
docker pull postgres:16-alpine

echo "Saving images to a tarball (this may take a few minutes)..."
docker save -o mst-ai-portal-images.tar postgres:16-alpine mst-portal-backend:latest mst-portal-worker:latest mst-portal-frontend:latest

echo ""
echo "============================================================"
echo "Successfully exported images to 'mst-ai-portal-images.tar'!"
echo "Now follow these steps for your offline machine:"
echo "1. Copy this entire 'mst-ai-portal' directory (including the .tar file) to a USB drive or via network to your offline PC."
echo "2. On the offline PC, navigate into the copied directory."
echo "3. Run './load-offline.sh' to load images and start the portal."
echo "============================================================"
