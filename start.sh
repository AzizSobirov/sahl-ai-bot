#!/bin/bash

# Telegram AI Assistant Bot Startup Script
# This script starts the bot with proper error handling and logging

echo "🚀 Starting Telegram AI Assistant Bot..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure your tokens."
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the bot
echo "🤖 Launching bot..."
npm start