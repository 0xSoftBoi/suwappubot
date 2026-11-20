#!/usr/bin/env bash
# Suwappu Arbiter — verify the live testnet deployment from a clean clone. No funds, no accounts, no keys.
# Needs: curl, sha256sum, python3. (near-cli is optional; this uses the public RPC directly.)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTRACT="arb2.suwappu-arbiter.testnet"
RPC="https://test.rpc.fastnear.com"
WASM="near/arbiter-github/artifacts/arbiter-github.wasm"
PASS_TX="Ez3bwp3ZLrFVxeak53WaBgasqXFbf8jeyEBZDPv3vq3b"

echo "== 1. hash of the committed arbiter binary"
LOCAL=$(sha256sum "$WASM" | cut -d' ' -f1); echo "$LOCAL"

echo
echo "== 2. what the contract has pinned on-chain (view call, public RPC)"
PINNED=$(curl -s -X POST "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$CONTRACT\",\"method_name\":\"arbiter\",\"args_base64\":\"e30=\"}}" \
  | python3 -c "import sys,json;print(bytes(json.load(sys.stdin)['result']['result']).decode())")
echo "$PINNED"

echo
if echo "$PINNED" | grep -q "$LOCAL"; then echo "MATCH: committed binary == contract-pinned arbiter hash"; else echo "MISMATCH — do not trust"; exit 1; fi

echo
echo "== 3. the settlement tx (look for the arbiter_attestation log line)"
curl -s -X POST "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"EXPERIMENTAL_tx_status\",\"params\":{\"tx_hash\":\"$PASS_TX\",\"sender_account_id\":\"suwappu-arbiter.testnet\",\"wait_until\":\"FINAL\"}}" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin).get('result', {})
for o in r.get('receipts_outcome', []):
    for l in o['outcome'].get('logs', []):
        if l.startswith('arbiter_attestation'):
            print(l)
"

echo
echo "== 4. the evidence the enclave saw is public (PR #993): check the fields yourself"
curl -s https://api.github.com/repos/0xSoftBoi/suwappubot/pulls/993 | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('merged:', d['merged'], '| author:', d['user']['login'], '| merged_by:', d['merged_by']['login'], '| merged_at:', d['merged_at'])"

echo
echo "Live page: https://www.suwappu.bot/arbiter   Evidence JSON: https://www.suwappu.bot/arbiter.json"
