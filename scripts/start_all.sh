#!/bin/bash
# Start the Suwappu API server (which includes the Telegram bot)
# 
# The api/main.py lifespan manager handles:
# - Database initialization
# - Telegram bot initialization and polling
# - All background services (fee sweeper, alerts, orders, tx poller, health monitor)
# - Graceful shutdown
#
# This unified approach prevents duplicate bot instances.

echo "🚀 Starting Suwappu Monolith..."

# Render sets PORT dynamically, default to 10000 if not set
PORT=${PORT:-10000}
echo "📡 Using PORT: $PORT"

# Start the API server (includes bot + all services)
echo "🔌 Starting API Server with integrated bot..."
exec uvicorn api.main:app --host 0.0.0.0 --port $PORT
