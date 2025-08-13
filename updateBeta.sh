#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status

# Read current version from file
current_version=$(cat lastbetaversion.txt)

# Split version into components
IFS='.' read -r X Y Z <<< "$current_version"

# Increment Z component
Z=$((Z + 1))

# Create new version
new_version="$X.$Y.$Z"

echo "Upgrading from version $current_version to $new_version"

# Ensure Buildx builder exists
if ! docker buildx inspect multiarch-builder &>/dev/null; then
  echo "Creating buildx builder 'multiarch-builder'..."
  docker buildx create --name multiarch-builder --use
else
  echo "Using existing buildx builder 'multiarch-builder'..."
  docker buildx use multiarch-builder
fi

# Bootstrap the builder (ensure QEMU emulation is set up)
docker buildx inspect --bootstrap

# Build for linux/amd64 and load into local Docker daemon
docker buildx build --platform linux/amd64 -t content-analysis-utility:latest --load .

# Tag and push to GCR
docker tag content-analysis-utility:latest gcr.io/miko3-performance-cluster/dev2.0/miko3/content-analysis-utility:$new_version
docker push gcr.io/miko3-performance-cluster/dev2.0/miko3/content-analysis-utility:$new_version

# Update version file
echo "Push successful, updating version file..."
echo "$new_version" > lastbetaversion.txt

echo "Done. Current version is $new_version"

# Clean up local Docker images
echo "Cleaning up local Docker images..."

# Force remove all GCR content-analysis-utility images (including specific versions like 3.0.9)
echo "Removing all GCR content-analysis-utility images..."
docker images --format "{{.Repository}}:{{.Tag}}" | grep -E 'gcr.io/miko3-performance-cluster/dev2.0/miko3/content-analysis-utility' | xargs -r docker rmi -f || true

# Clean up any dangling images
echo "Cleaning up dangling images..."
docker image prune -f

# Clean up builder cache
echo "Cleaning up builder cache..."
docker builder prune -f --filter type=exec.cachemount --filter=unused-for=24h

open https://console.cloud.google.com/kubernetes/deployment/us-west1/preprod-cluster/prodbeta/content-analysis-utility/yaml/edit?project=miko3-performance-cluster