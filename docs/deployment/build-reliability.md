# Railway build reliability

This is the operating contract for preventing one monorepo commit from creating a fleet
of unrelated Railway builds. The desired per-instance policy lives in
[`railway.services.json`](../../railway.services.json) and is checked by
`python3 scripts/validate_railway_services.py`.

## Invariants

1. Production GitHub services track `main`; persistent dev services track `dev`.
2. Every GitHub service has inclusion-only watch paths from the repository root.
3. Persistent services enable Railway **Wait for CI** and may deploy only after `CI gate`.
4. Preview, feature-branch, and one-shot services use a non-matching
   `/.manual-deploy-only/<service>/**` watch path. They move only through an explicit
   manual deploy.
5. A service build uses an explicit root, Dockerfile, healthcheck, restart policy, and
   lifecycle in the committed policy.
6. An unrelated documentation or harness change creates no application build.

## CI topology

`.github/workflows/test.yml` always starts. `scripts/ci_changed_domains.py` calculates
the affected components and skips only irrelevant expensive jobs. `CI gate` always
finishes and fails if any selected job failed or was cancelled. Require this one stable
check in branch rules; do not require the conditional jobs individually.

Main/dev runs are never cancelled because Railway uses their final check-suite result.
Superseded pull-request runs may be cancelled safely.

The deployment policy validator always runs, even for docs-only changes. A workflow
change runs every lane once so edits to the selector cannot silently weaken CI.

## Build contexts

| Service | Root | Dockerfile | Why |
|---|---|---|---|
| `python-api`, `python-worker` | `/` | `api/Dockerfile.railway` | Image copies Python code and root dependency files. |
| `api-ts` | `/api-ts` | `Dockerfile` | Isolated package. |
| `terminal` | `/` | `terminal/Dockerfile` | Needs `packages/design-tokens`. |
| `showcase` | `/` | `showcase/Dockerfile` | Needs `packages/design-tokens`; a showcase-only archive is invalid. |
| `webapp` | `/` | `webapp/Dockerfile` | Needs `packages/design-tokens`. |

Railway watch patterns remain repository-root relative even when a Root Directory is
set. Use `/api-ts/**`, not `/**`, for the isolated API service.

## Frozen instances

The following instances were switched to manual-only watch paths on 2026-08-26 without
deleting or redeploying their current images: `testnet-runner`, both signal-lab and pump
ingest pairs, the three `*-marketdata` previews, `market-data-capture`, and
`suwappu-primitives-ui`.

Before re-enabling one, integrate its source into `main`/`dev`, give it a committed build
contract, add focused watch paths, and make its lifecycle persistent in the policy.

## Railway IaC transition

Railway deprecated per-service `railway.json`/`railway.toml`; existing legacy services
stop reading them on **2026-12-01**. The replacement is one project-level
`.railway/railway.ts`.

Do not hand-write the initial project file. In Railway IaC, omission means deletion.
Authenticate the Railway CLI, link the exact environment, and import live state first:

```bash
railway config pull
railway config plan
```

The first plan must report no changes. Migrate legacy service config with
`railway config migrate`, review the plan for unexpected deletes, then apply per
environment. Keep `railway.services.json` for Dockerfile paths, watch paths, restart
policy, lifecycle, and Wait for CI until Railway's IaC DSL can express those controls.

For CI drift checks after import, run `railway config plan --detailed-exit-code` with a
read-only project token. Exit `0` means no drift; exit `2` means a plan is pending.

## Rollout and rollback

1. Validate and merge the CI/policy change while application watch paths exclude it.
2. Normalize one dev service and manually redeploy it as a canary.
3. Confirm the deployed SHA, health payload, and clean build/runtime logs.
4. Enable Wait for CI on dev persistent services, then production services.
5. Apply root/Dockerfile/watch settings one service at a time.

Rollback a bad configuration by restoring the previous values from Railway deployment
history and redeploying the last successful image. Never delete a service to fix a build
trigger.
