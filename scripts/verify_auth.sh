#!/usr/bin/env bash
# End-to-end verification of dashboard authentication against PRODUCTION.
#
# Exists because the dashboard shipped with auth that could never work: it sent
# `Authorization: Bearer <token>` to /enterprise/*, which was guarded by
# telegramAuth() — a middleware that reads ONLY X-Telegram-Init-Data. Every
# request 401'd and the login screen reported the token as rejected. Nothing
# in the test suite caught it, because the failure was in the SEAM between two
# services that are each individually fine.
#
# So this probes the real deployed seam. Run it after any auth deploy.
#
# Requires: railway CLI (reads JWT_SECRET + DB url), python3 with pyjwt.
# Mints a token exactly as python-api's create_jwt_token does (HS256, userId
# alias) so it exercises the genuine verification path in api-ts.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
API=https://api.suwappu.bot
PY=https://python-api-production-8526.up.railway.app

echo "waiting for api-ts (flexAuth) ..."
until curl -s --max-time 12 "$API/enterprise/orgs/me" | grep -q "Authentication required"; do sleep 20; done
echo "  api-ts: flexAuth live"

echo "waiting for python-api (cookie domain) ..."
until curl -s -D- -o /dev/null --max-time 15 -X POST "$PY/auth/logout" | grep -qi "domain=.suwappu.bot"; do sleep 20; done
echo "  python-api: parent-domain cookie live"

SEC=$(railway variables --service api-ts --kv 2>/dev/null | grep '^JWT_SECRET=' | cut -d= -f2-)
DBURL=$(railway variables --service postgres --kv 2>/dev/null | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
DBUID=$(python3.12 -c "
import sqlalchemy as sa
from sqlalchemy import text
e=sa.create_engine('$DBURL')
with e.connect() as c: print(c.execute(text('SELECT id FROM users ORDER BY id LIMIT 1')).scalar())")
TOKEN=$(python3.12 -c "
import jwt,datetime
p={'address':'0x0000000000000000000000000000000000000001','user_id':$DBUID,'userId':$DBUID,
'exp':datetime.datetime.utcnow()+datetime.timedelta(hours=1),'iat':datetime.datetime.utcnow()}
print(jwt.encode(p,'''$SEC''',algorithm='HS256'))" 2>/dev/null)

echo
echo "=== E2E RESULTS (real user_id=$DBUID) ==="
echo "1 no credential        : $(curl -s --max-time 15 "$API/enterprise/orgs/me" | head -c 90)"
echo "2 valid COOKIE         : $(curl -s -o /dev/null -w 'HTTP %{http_code} ' --max-time 15 "$API/enterprise/orgs/me" -H "Cookie: suwappu_auth=$TOKEN")$(curl -s --max-time 15 "$API/enterprise/orgs/me" -H "Cookie: suwappu_auth=$TOKEN" | head -c 90)"
echo "3 tampered cookie      : $(curl -s -o /dev/null -w 'HTTP %{http_code} ' --max-time 15 "$API/enterprise/orgs/me" -H "Cookie: suwappu_auth=${TOKEN}x")"
echo "4 valid Bearer header  : $(curl -s -o /dev/null -w 'HTTP %{http_code}' --max-time 15 "$API/enterprise/orgs/me" -H "Authorization: Bearer $TOKEN")"
echo
echo "=== OAuth authorize accepts showcase redirect ==="
curl -s -o /dev/null -w "  suwappu.bot/dashboard -> HTTP %{http_code} (302=allowlisted)\n" --max-time 20 \
  "$PY/auth/oauth/google/authorize?redirect_url=https%3A%2F%2Fsuwappu.bot%2Fdashboard"
curl -s -o /dev/null -w "  evil.example          -> HTTP %{http_code} (must NOT be 302)\n" --max-time 20 \
  "$PY/auth/oauth/google/authorize?redirect_url=https%3A%2F%2Fevil.example%2Fx"
echo
echo "=== cookie domain on a real auth response ==="
curl -s -D- -o /dev/null --max-time 15 -X POST "$PY/auth/logout" | grep -i "^set-cookie" | head -2
