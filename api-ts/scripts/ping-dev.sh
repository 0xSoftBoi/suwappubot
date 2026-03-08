#!/bin/bash
# Ping devapi.suwappu.dev endpoints

API_URL="http://devapi.suwappu.dev"
API_KEY="f943ac8b4d6cec5200234216a95d1272948cc96ca45c493b73fff41b17e7d232"

echo "🏓 Pinging devapi.suwappu.dev"
echo "=============================="
echo ""

# Health check
echo -n "GET /health ... "
HEALTH=$(curl -s -w "%{http_code}" -o /tmp/health.json "$API_URL/health" 2>/dev/null)
if [ "$HEALTH" = "200" ]; then
  echo "✅ $HEALTH"
  cat /tmp/health.json | jq -c . 2>/dev/null || cat /tmp/health.json
else
  echo "❌ $HEALTH"
fi
echo ""

# Tools (requires API key)
echo -n "GET /tools ... "
TOOLS=$(curl -s -w "%{http_code}" -o /tmp/tools.json -H "X-Agent-Key: $API_KEY" "$API_URL/tools" 2>/dev/null)
if [ "$TOOLS" = "200" ]; then
  echo "✅ $TOOLS"
  cat /tmp/tools.json | jq -c '{name:.name,tools:.tools|length}' 2>/dev/null || echo "OK"
else
  echo "❌ $TOOLS"
fi
echo ""

# Webapp validate (no auth)
echo -n "POST /webapp/validate ... "
VALIDATE=$(curl -s -w "%{http_code}" -o /tmp/validate.json -X POST "$API_URL/webapp/validate" 2>/dev/null)
if [ "$VALIDATE" = "200" ]; then
  echo "✅ $VALIDATE"
  cat /tmp/validate.json | jq -c . 2>/dev/null || cat /tmp/validate.json
else
  echo "❌ $VALIDATE"
fi
echo ""

# Clean up
rm -f /tmp/health.json /tmp/tools.json /tmp/validate.json

echo "=============================="
echo "Done"
