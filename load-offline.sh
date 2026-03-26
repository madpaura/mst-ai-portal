#!/bin/bash
set -e

if [ ! -f "mst-ai-portal-images.tar" ]; then
    echo "Error: mst-ai-portal-images.tar not found!"
    echo "Make sure you ran './export-offline.sh' on the online machine first and copied the file over."
    exit 1
fi

echo "Loading Docker images from mst-ai-portal-images.tar..."
docker load -i mst-ai-portal-images.tar

echo "Starting services offline..."
# Use --no-build so docker-compose doesn't attempt to build from source or pull
docker-compose up -d --no-build

echo ""
echo "============================================================"
echo "Offline setup complete!"
echo "Check running services with: docker-compose ps"
echo "============================================================"
