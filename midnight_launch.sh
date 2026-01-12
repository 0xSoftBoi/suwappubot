#!/bin/bash
echo "🚀 Initiating Midnight Launch Sequence (Bare Metal Mode)..."

# Kill existing
pkill -f "next" || true
pkill -f "uvicorn" || true
pkill -f "bot.main" || true

# Environment (Ensure we use SQLite if Postgres isn't available)
export DATABASE_URL="sqlite:///./suwappubot.db"

# Start API
echo ">> Starting API..."
./venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000 > api.log 2>&1 &
echo "API PID: $!"

# Start Bot
echo ">> Starting Bot..."
./venv/bin/python3 -m bot.main > bot.log 2>&1 &
echo "Bot PID: $!"

# Start Dashboard
echo ">> Starting Dashboard..."
cd dashboard
nohup npm run dev -- -p 3000 > dashboard.log 2>&1 &
echo "Dashboard PID: $!"

echo "=========================================="
echo "✅ MIDNIGHT LAUNCH SUCCESSFUL"
echo "=========================================="
echo "📊 Dashboard: http://localhost:3000"
echo "🔌 API Docs:  http://localhost:8000/docs"
echo "🤖 Bot:       Running in background"
echo "=========================================="
