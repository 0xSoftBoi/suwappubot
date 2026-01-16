#!/bin/bash
# Start both Telegram bot and API server in one container

echo "🚀 Starting Suwappu services..."

# Start the Telegram bot in background
echo "📱 Starting Telegram Bot..."
python -m bot.main &
BOT_PID=$!

# Give bot a moment to initialize
sleep 2

# Start the API server (foreground - this keeps container alive)
echo "🔌 Starting API Server on port $PORT..."
exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}

