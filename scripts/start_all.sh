#!/bin/bash
# Start both Telegram bot and API server in one container

set -e  # Exit on error

echo "🚀 Starting Suwappu services..."

# Render sets PORT dynamically, default to 10000 if not set
PORT=${PORT:-10000}
echo "📡 Using PORT: $PORT"

# Start the Telegram bot in background
echo "📱 Starting Telegram Bot..."
python -m bot.main &
BOT_PID=$!

# Give bot a moment to initialize
sleep 3

# Check if bot process is still running
if ! kill -0 $BOT_PID 2>/dev/null; then
    echo "❌ Bot process failed to start!"
    exit 1
fi

# Start the API server (foreground - this keeps container alive)
echo "🔌 Starting API Server on port $PORT..."
exec uvicorn api.main:app --host 0.0.0.0 --port $PORT

