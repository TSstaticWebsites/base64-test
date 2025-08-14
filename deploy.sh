#!/bin/bash

# DigitalOcean App Platform Deployment Script
# This script helps deploy the application to DigitalOcean

echo "🚀 Base64 Test - DigitalOcean Deployment"
echo "========================================"

# Check if doctl is installed
if ! command -v doctl &> /dev/null; then
    echo "❌ doctl CLI is not installed."
    echo "Please install it from: https://docs.digitalocean.com/reference/doctl/how-to/install/"
    exit 1
fi

# Check authentication
if ! doctl auth list &> /dev/null; then
    echo "❌ Not authenticated with DigitalOcean."
    echo "Please run: doctl auth init"
    exit 1
fi

echo "✅ Prerequisites checked"

# Deploy using app spec
echo "📦 Deploying application..."
doctl apps create --spec .do/app.yaml

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "Next steps:"
echo "1. Monitor deployment: doctl apps list"
echo "2. Get app URL: doctl apps get <app-id>"
echo "3. View logs: doctl apps logs <app-id>"
echo ""
echo "For manual deployment:"
echo "1. Go to: https://cloud.digitalocean.com/apps"
echo "2. Click 'Create App'"
echo "3. Connect GitHub repo: TSstaticWebsites/base64-test"
echo "4. Use the Dockerfile.digitalocean for deployment"