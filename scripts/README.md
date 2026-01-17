# Scripts

Utility scripts for Suwappubot development and deployment.

## Migration Scripts

### validate-migrations.py

Validates Alembic database migrations before commit. Called by the pre-commit hook.

```bash
# Run manually
python3 scripts/validate-migrations.py

# Run with full SQL validation (requires DATABASE_URL)
VALIDATE_SQL=1 python3 scripts/validate-migrations.py
```

**Checks performed:**
- Migration file syntax (Python compile check)
- Revision chain integrity (no multiple heads)
- SQL generation (optional, with `VALIDATE_SQL=1`)

## Deployment Scripts

### start_all.sh

Starts both the Telegram bot and FastAPI server. Used as the Docker CMD.

```bash
./scripts/start_all.sh
```

### deploy.sh

Deployment helper script.

```bash
./scripts/deploy.sh
```

### deploy_server.sh

Server-specific deployment script.

```bash
./scripts/deploy_server.sh
```

### start_web.sh

Starts only the web server component.

```bash
./scripts/start_web.sh
```

## Debug Scripts

### debug.py

General debugging utilities.

```bash
python3 scripts/debug.py
```

### debug_web3.py

Web3/blockchain debugging utilities.

```bash
python3 scripts/debug_web3.py
```

### debug_sign.py

Transaction signing debugging.

```bash
python3 scripts/debug_sign.py
```

## Setup Scripts

### init_hot_wallets.py

Initialize hot wallets for the fee collector.

```bash
python3 scripts/init_hot_wallets.py
```

### test_turnkey_integration.py

Test Turnkey wallet integration.

```bash
python3 scripts/test_turnkey_integration.py
```

## Monitoring Scripts

### check_render_deployment.sh

Check Render deployment status.

```bash
./scripts/check_render_deployment.sh
```
