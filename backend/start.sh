#!/bin/bash

# Plasma ECC Backend Startup Script

echo "🚀 Starting Plasma ECC Backend..."

# Check if .env exists
if [ ! -f "../.env" ]; then
    echo "❌ Error: .env file not found in project root"
    echo "Please create .env file with required variables"
    exit 1
fi

# Kill existing process on port 3001 if exists
echo "🔍 Checking for existing process on port 3001..."
lsof -ti:3001 | xargs kill -9 2>/dev/null && echo "✅ Killed existing process" || echo "✅ Port 3001 is free"

# Start the server
echo "🎯 Starting backend server..."
npm run dev
