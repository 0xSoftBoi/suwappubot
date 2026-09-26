# Connecting `showcase` in the Railway `dev` environment

**Status:** blocked on one credential/click. Root cause identified and verified.
**Date:** 2026-08-23

## The symptom

`showcase-dev.up.railway.app/autopilot` returns 404. The `showcase` service in the
`dev` environment has `latestDeployment: null` — it has never deployed, and
pushes to `dev` do not trigger it.

## Root cause (verified, not inferred)

Railway models two separate things that are easy to conflate:

| | mutation | what it does |
|---|---|---|
| source **config** | `serviceInstanceUpdate` | writes `repo` / `branch` / build fields onto the service instance |
| repo **connection** | `serviceConnect` | performs the GitHub authorization + webhook handshake |

The service has the **first** and not the **second**. `get-service-config` shows
`source: {repo: "0xSoftBoi/suwappubot", branch: "dev"}`, which reads like it is
connected — but no trigger exists, so no push ever builds it.

Two pieces of evidence make this conclusive rather than a guess:

1. **The sibling controls for every other variable.** `suwappu-primitives-ui`
   builds from the *same* repo, the *same* `dev` branch, the *same*
   `/showcase/Dockerfile`, and the *same* `/showcase/**` watch patterns. A push
   at 16:34 built it within seconds (`SUCCESS 16:34:24`) and did nothing to
   `showcase`. The webhook works; this service is not wired to it.
2. **Railway's own agent said so.** Asked directly to call `serviceConnect`, it
   replied: *"I don't have a tool that can call `serviceConnect` — my available
   tools only support updating the service config … but they don't handle the
   actual GitHub authorization/webhook handshake."*

A second, independent bug explains why the "deploy" attempts reported success
and produced nothing: `serviceInstanceDeployV2` **without** a `commitSha`
deploys "the commit currently associated with the service". A service that has
never deployed has no such commit, so the call is a well-formed no-op.

## Avenues tried, and why each fails

| avenue | result |
|---|---|
| `update-service` (MCP) | documented: "source changes are not handled by this tool" |
| `railway-agent` | wrote config fields; **has no `serviceConnect` tool** (its own words) |
| push to `dev` touching `/showcase/**` | sibling built in seconds; `showcase` untouched — no trigger |
| `redeploy` (MCP) | documented: "does NOT give a service its first deployment" |
| `create-deployment` (MCP) | creates a *new* service — takes no `serviceId` |
| raw GraphQL `serviceConnect` | **correct call**; needs a Railway token this container does not have |

The GraphQL endpoint *is* reachable from the session container
(`POST https://backboard.railway.com/graphql/v2` → 200), and unauthenticated
introspection confirms the input shape:

```
ServiceConnectInput { branch: String, image: String, repo: String }
```

So the only missing ingredient is authentication.

## The fix

Two mutations, in order.

```graphql
# 1. create the GitHub connection (the missing step)
mutation serviceConnect($id: String!, $input: ServiceConnectInput!) {
  serviceConnect(id: $id, input: $input) { id }
}
# variables:
# { "id": "dd2129de-aa42-476c-810d-a43737cec227",
#   "input": { "repo": "0xSoftBoi/suwappubot", "branch": "dev" } }

# 2. deploy an explicit commit — without commitSha this is a no-op on a
#    service that has never deployed
mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!, $commitSha: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
}
# variables:
# { "serviceId": "dd2129de-aa42-476c-810d-a43737cec227",
#   "environmentId": "ebbeb375-d576-4aeb-b14d-280412743028",
#   "commitSha": "<HEAD of origin/dev>" }
```

### Option A — dashboard (recommended)

showcase-dev → Settings → Source → connect `0xSoftBoi/suwappubot`, branch `dev`.
One click, no credential leaves your machine, and it performs exactly the
handshake `serviceConnect` performs. Everything else is already in place.

### Option B — you run the API calls

No secret is shared, and it is copy-paste:

```bash
export RAILWAY_TOKEN='<account or workspace token from railway.com/account/tokens>'
SVC=dd2129de-aa42-476c-810d-a43737cec227
ENV=ebbeb375-d576-4aeb-b14d-280412743028
SHA=$(git rev-parse origin/dev)

curl -s https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation(\$id:String!,\$input:ServiceConnectInput!){serviceConnect(id:\$id,input:\$input){id}}\",\"variables\":{\"id\":\"$SVC\",\"input\":{\"repo\":\"0xSoftBoi/suwappubot\",\"branch\":\"dev\"}}}"

curl -s https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation(\$s:String!,\$e:String!,\$c:String!){serviceInstanceDeployV2(serviceId:\$s,environmentId:\$e,commitSha:\$c)}\",\"variables\":{\"s\":\"$SVC\",\"e\":\"$ENV\",\"c\":\"$SHA\"}}"
```

### Option C — hand me a token and I run it

Same two calls, from here. Prefer the **narrowest token that works**. A project
token is environment-scoped (`Project-Access-Token` header, not `Bearer`), which
would be ideal least-privilege — but `serviceConnect` is a service-level
mutation, so a project token may be rejected; that is untested. An account or
workspace token definitely works and is correspondingly broad. Rotate it after.

### Option D — replace the service (not recommended)

`create-deployment` can build a *new* service from the repo with a first deploy,
after which the `showcase-dev.up.railway.app` domain would be moved and the old
empty service deleted. This is the only path that needs nothing from you, and it
is the one worth avoiding: it churns a service in a shared project to work around
a missing click.

## Verification, once connected

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://showcase-dev.up.railway.app/autopilot   # expect 200
curl -s https://showcase-dev.up.railway.app/autopilot | grep -o 'suwappu-alpha'          # expect a hit
```

The second check matters more than the first: it proves the client bundle was
built against the dev API rather than the production default.

## Already done, and independent of the above

- **`NEXT_PUBLIC_API_URL`** is set on the dev showcase service.
- **The Dockerfile now passes `NEXT_PUBLIC_*` into the build** (`showcase/Dockerfile`).
  This was a real bug, not bookkeeping: those values are inlined into the client
  bundle at build time, so a runtime-only variable reaches server components and
  silently misses the browser. Without it the dashboard would have server-rendered
  from the dev API while its 20s poll and "raw API" links stayed baked against
  production — right on load, then quietly stale.
- **The page itself is live on dev already**, proving the build is sound:
  `https://suwappu-primitives-ui-dev.up.railway.app/autopilot` returns 200 and
  renders. It shows "No agent is running" because *that* service has no
  `NEXT_PUBLIC_API_URL` — which is the very failure mode the Dockerfile fix
  addresses, visible in the wild.
