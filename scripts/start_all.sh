#!/bin/bash
# Start both Telegram bot and API server in one container
# The API server is the primary service (required for health checks)
# The bot is optional and can fail without stopping the API

echo "🚀 Starting Suwappu services..."

# Render sets PORT dynamically, default to 10000 if not set
PORT=${PORT:-10000}
echo "📡 Using PORT: $PORT"

# Start the Telegram bot in background (allow it to fail)
echo "📱 Starting Telegram Bot..."
python -m bot.main &
BOT_PID=$!

# Give bot a moment to initialize
sleep 5

# Check if bot process is still running
if kill -0 $BOT_PID 2>/dev/null; then
    echo "✅ Bot process started successfully (PID: $BOT_PID)"
else
    echo "⚠️ Bot process failed to start - continuing with API server only"
    echo "   (This is expected if TELEGRAM_BOT_TOKEN is not configured)"
fi

# Start the API server (foreground - this keeps container alive)
# The API server MUST start for health checks to pass
echo "🔌 Starting API Server on port $PORT..."
exec uvicorn api.main:app --host 0.0.0.0 --port $PORT
