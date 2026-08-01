# Testing

The Python suite is **1381 tests, fully green**, and takes about 5 minutes.

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pytest tests/                       # full suite
pytest tests/test_wallet.py -v      # one file
pytest tests/ --cov=bot --cov=api   # with coverage
```

Give the suite a generous timeout. Five minutes is normal — a slow run is not a hung run.

---

## `pytest-asyncio` is required, and its absence looks like something else

`pyproject.toml` sets `asyncio_mode = "auto"` together with `--strict-markers`. Without
`pytest-asyncio` installed, roughly 25 files fail at **collection** with:

```
Failed: 'asyncio' not found in markers configuration
```

and async tests in files that *do* still collect fail with `async def functions are not natively
supported`. The result is a run that reports a large, alarming failure count that has nothing to
do with the code under test.

It is pinned in `requirements.in` / `requirements.txt` (`pytest-asyncio==1.4.0`, compatible with
the pinned `pytest==9.1.1`, which requires `pytest<10,>=8.4`). CI installs it separately in
`.github/workflows/test.yml`, so CI stayed green while local runs following the README did not —
if your numbers disagree with CI's, check this first.

**Rule of thumb:** before treating a failure count as a backlog of bugs, confirm the environment
is complete. Re-measure rather than trusting a count from an earlier run.

---

## Import-order pollution: tests that pass alone and fail in the suite

Some state in this codebase is computed **once, at module import time**. Because pytest runs the
whole session in a single process, the first test file to import such a module freezes that state
for every test that follows. A test can therefore pass in isolation and fail in the full suite —
which usually means test pollution, not a product bug.

The known instance is the JWT secret. `api/main.py` resolves `JWT_SECRET` at import:

```python
JWT_SECRET = (settings.jwt_secret_key or ... or os.environ.get("SECRET_KEY"))
if not JWT_SECRET:
    JWT_SECRET = secrets.token_hex(32)   # ephemeral, random per process
```

Setting `os.environ["SECRET_KEY"]` at the top of your test file only wins if **nothing has already
imported `api.main`**. Under the full suite something usually has — `tests/test_heartbeat_thresholds.py`
sorts alphabetically early and imports it without setting a secret — so the baked-in value is a
random one and your hand-signed tokens get `401`.

Patch the resolved value instead of the environment:

```python
def app_client(monkeypatch):
    import api.main as main_mod
    monkeypatch.setattr(main_mod, "JWT_SECRET", "test-secret")
    ...
```

Use `monkeypatch` rather than a bare `setattr` so the value is restored and you don't create the
next test-pollution bug while fixing this one. See `tests/test_webapp_referrals.py` and
`tests/test_webapp_limit_orders.py` for the pattern.

### Diagnosing a suspected pollution failure

```bash
pytest tests/test_suspect.py                          # passes alone?
pytest tests/test_polluter.py tests/test_suspect.py   # fails together? → pollution
```

Bisect by pairing the failing file with each file that touches the same global. Usual suspects:
module-level singletons (settings, engines, `redis_cache`, `event_bus`), `sys.modules` stubs
installed by one file and never removed, a shared SQLite DB that isn't reset, and event-loop reuse.

A related case: `tests/test_admin_failclosed.py` stubs `qrcode`/`PIL` into `sys.modules`. Its
`__getattr__` must raise `AttributeError` for dunders — if it fabricates a value for `__file__`,
Pydantic's docstring extraction walks `sys.modules`, calls `getattr(m, "__file__")`, and dies with
`AttributeError: type object '__file__' has no attribute 'endswith'`.

---

## Static checks worth running before pushing

```bash
black --check --line-length=100 bot/ api/ tests/    # CI enforces this
python3 -c "import ast; ast.parse(open('path/to/file.py').read())"
cd api-ts && bun run check                          # TypeScript
```

**CI green does not mean the bot boots.** The quality-gates job does not exercise `bot/main.py`'s
startup import chain, so a bad import passes CI and then crashes at runtime. After deploying, check
`python3 scripts/status.py` and confirm the logs have no `ImportError` / `ModuleNotFound`.

---

## Cross-branch drift

The Expo app in `mobile/` is **not on `main`** — it lives on `dev` and feature branches — while its
backend (`api/routes/mobile.py`, mounted at `/v1/mobile`) *is* on `main` and deployed. A
single-branch audit of either side will look consistent while the pair is broken.

When changing either side, check both:

```bash
git show origin/dev:mobile/lib/api.ts          # client
git show origin/main:api/routes/mobile.py      # server
```

The same caution applies to `packages/shared`, which `api-ts`, `webapp`, and the mobile client all
consume — a change there has a blast radius across all three.
