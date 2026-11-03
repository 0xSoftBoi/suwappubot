#!/bin/bash
# Enable Railway PR Deploys (ephemeral preview environments) for the suwappu project.
#
# Usage:
#   RAILWAY_API_TOKEN=<token> ./scripts/enable-railway-pr-deploys.sh
#
# Get a token: Railway dashboard → your profile → Tokens → New Token
# (needs Editor/Admin on the project).
#
# What this does:
#   - Sets prDeploys=true on the project via Railway's GraphQL API
#   - After this, every PR gets an ephemeral environment: Railway builds the
#     PR branch, deploys terminal + webapp, and posts preview URLs as a PR
#     comment via the Railway GitHub bot. Environments are deleted on merge/close.
#
# Alternative (no script): Railway dashboard → Project → Settings → enable "PR Deploys".
set -euo pipefail

TOKEN="${RAILWAY_API_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "Set RAILWAY_API_TOKEN first (Railway dashboard → profile → Tokens)." >&2
  exit 1
fi

# Find the project ID: prefer explicit arg, else first project with a terminal service
PROJECT_ID="${1:-}"
if [ -z "$PROJECT_ID" ]; then
  echo "Resolving project ID..."
  PROJECT_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    https://backboard.railway.com/graphql/v2 \
    -d '{"query":"{ projects { edges { node { id name } } } }"}' \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
for e in d['data']['projects']['edges']:
    print(e['node']['id'], e['node']['name'])
" | grep -i suwappu | head -1 | cut -d' ' -f1)
fi

if [ -z "$PROJECT_ID" ]; then
  echo "Could not resolve project ID. Pass it explicitly: $0 <project-id>" >&2
  exit 1
fi

echo "Enabling PR deploys on project ${PROJECT_ID}..."
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://backboard.railway.com/graphql/v2 \
  -d "$(python3 -c "
import json
print(json.dumps({
  'query': 'mutation(\$id: String!, \$input: ProjectUpdateInput!) { projectUpdate(id: \$id, input: \$input) { id name prDeploys } }',
  'variables': {'id': '$PROJECT_ID', 'input': {'prDeploys': True}}
}))")" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
n=d['data']['projectUpdate']
print(f\"Project '{n['name']}': prDeploys={n['prDeploys']}\")
assert n['prDeploys'] is True, 'toggle did not stick'
print('Done — open a PR and Railway will post preview URLs as a comment.')
"
