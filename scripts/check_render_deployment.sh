#!/bin/bash
# Diagnostic script to check Render deployment readiness

echo "🔍 Render Deployment Diagnostic"
echo "================================"
echo ""

# Check 1: YAML syntax
echo "1. Checking render.yaml syntax..."
if python3 -c "import yaml; yaml.safe_load(open('render.yaml'))" 2>/dev/null; then
    echo "   ✅ render.yaml is valid YAML"
else
    echo "   ❌ render.yaml has syntax errors!"
    exit 1
fi

# Check 2: Dockerfile exists
echo ""
echo "2. Checking Dockerfile..."
if [ -f "Dockerfile" ]; then
    echo "   ✅ Dockerfile exists"
else
    echo "   ❌ Dockerfile not found!"
    exit 1
fi

# Check 3: Start script exists and is executable
echo ""
echo "3. Checking start script..."
if [ -f "scripts/start_all.sh" ]; then
    if [ -x "scripts/start_all.sh" ]; then
        echo "   ✅ scripts/start_all.sh exists and is executable"
    else
        echo "   ⚠️  scripts/start_all.sh exists but not executable"
        chmod +x scripts/start_all.sh
        echo "   ✅ Made executable"
    fi
else
    echo "   ❌ scripts/start_all.sh not found!"
    exit 1
fi

# Check 4: Requirements file
echo ""
echo "4. Checking requirements.txt..."
if [ -f "requirements.txt" ]; then
    echo "   ✅ requirements.txt exists"
    echo "   📦 Checking for critical dependencies..."
    if grep -q "fastapi\|uvicorn\|python-telegram-bot" requirements.txt; then
        echo "   ✅ Critical dependencies found"
    else
        echo "   ⚠️  Some critical dependencies may be missing"
    fi
else
    echo "   ❌ requirements.txt not found!"
    exit 1
fi

# Check 5: API main file
echo ""
echo "5. Checking API entry point..."
if [ -f "api/main.py" ]; then
    echo "   ✅ api/main.py exists"
    # Check for health endpoint
    if grep -q "@app.get.*health\|/health" api/main.py; then
        echo "   ✅ Health endpoint found"
    else
        echo "   ⚠️  Health endpoint may be missing"
    fi
else
    echo "   ❌ api/main.py not found!"
    exit 1
fi

# Check 6: Bot main file
echo ""
echo "6. Checking bot entry point..."
if [ -f "bot/main.py" ]; then
    echo "   ✅ bot/main.py exists"
else
    echo "   ❌ bot/main.py not found!"
    exit 1
fi

# Check 7: Test Docker build (optional, can be slow)
echo ""
echo "7. Testing Docker build (this may take a while)..."
read -p "   Run Docker build test? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if docker build -t suwappu-test . 2>&1 | tee /tmp/docker-build.log; then
        echo "   ✅ Docker build succeeded"
    else
        echo "   ❌ Docker build failed! Check /tmp/docker-build.log"
        exit 1
    fi
else
    echo "   ⏭️  Skipped (run manually: docker build -t suwappu-test .)"
fi

echo ""
echo "================================"
echo "✅ Basic checks complete!"
echo ""
echo "⚠️  IMPORTANT: Verify in Render Dashboard:"
echo "   1. Environment variables are set:"
echo "      - TELEGRAM_BOT_TOKEN"
echo "      - ENCRYPTION_KEY"
echo "      - DATABASE_URL (auto-set)"
echo "   2. Service is not suspended"
echo "   3. Check Events tab for deployment logs"
echo "   4. Check Logs tab for runtime errors"
echo ""
echo "🔗 Dashboard: https://dashboard.render.com/web/srv-d4qf44ili9vc739sl420"
