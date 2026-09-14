# Railway cost: free-only optimization research (2026-09-14)

Every recommendation here is **zero-cost**. Nothing below requires a paid API
tier, a paid provider plan, a paid Railway feature, or a new SaaS subscription.
Levers that only pay off on a paid plan were excluded rather than listed with a
caveat.

Companion to [`railway-cost-playbook.md`](railway-cost-playbook.md) (what
shipped and how Railway bills) and
[`railway-cost-audit.md`](railway-cost-audit.md) (the original measurements).

## The measurement that reframes the problem

Pulled from the Railway control plane on 2026-09-14. `python-api` and
`python-worker` run the **same image and the same entrypoint**, differing only
by `ENABLE_BACKGROUND_SERVICES` and `RUN_TELEGRAM_BOT`
(`bot/config/settings.py:41-49`).

| Service | Background services | 24 h avg RSS | 24 h min | 24 h max | 24 h avg CPU |
|---|---|---:|---:|---:|---:|
| `python-api` | off | 0.282 GB | 0.174 GB | 0.407 GB | 0.007 vCPU |
| `python-worker` | on | 1.957 GB | 0.158 GB | 2.341 GB | 0.242 vCPU |

`python-worker`, 7-day window: RSS avg 1.941 GB, max 27.53 GB; CPU avg 0.270
vCPU; network TX avg 0.0041 GB.

Three conclusions follow, and they set the ranking for everything below:

1. **The entire ~1.7 GB delta is the background service loops.** Not imports,
   not FastAPI, not the base image — the same image sits flat at 0.28 GB with
   the loops switched off.
2. **Interpreter-level and image-level tweaks can only ever touch the 0.28 GB
   floor.** Even a heroic 30 % cut there is ~$0.85/mo. They are ranked low here
   for that reason, not because they don't work.
3. **The bill is the plateau, not the spikes.** At $10/GB-RAM-month the worker's
   RAM line is ~$19.6/mo and CPU ~$5.4/mo. A 27.5 GB spike lasting minutes costs
   cents; the flat 1.96 GB costs every minute of every day.

The post-restart curve is the other half of the picture: the worker boots at
0.20 GB, reaches ~1.0 GB within about 2 h, and plateaus near 2.3 GB. It never
comes back down on its own.

## Ranked levers

Filled in below as each section is verified. Sections are appended
incrementally; an interrupted research run costs a section, not the document.

## Scheduled process recycle

**Verdict: the largest single free lever found. MONEY-PATH — gated on a fee
sweep idempotency review that is in progress.**

Because Railway bills the per-minute average, a process that climbs to a
plateau and stays there is billed at the plateau. Recycling it on a schedule
turns that flat line into a sawtooth and bills the *midpoint of the climb*
instead.

Fitting a saturating exponential to the three measured points (boot 0.20 GB,
~1.0 GB at t=2 h, plateau 2.3 GB):

```
RSS(t) = P - (P - R0)·e^(-t/τ)        P = 2.3, R0 = 0.2
1.0 = 2.3 - 2.1·e^(-2/τ)  →  e^(-2/τ) = 0.619  →  τ ≈ 4.17 h
```

Cross-check against the playbook's independent earlier observation (0.44 GB at
boot → 1.9 GB after ~8 h): the model predicts RSS(8 h) ≈ 1.99 GB. Consistent.

Time-averaged RSS over a recycle period T is
`avg(T) = P − (P−R0)·(τ/T)·(1 − e^(−T/τ))`:

| Recycle interval | Modeled avg RSS | RAM $/mo | Saved vs. $19.5/mo |
|---|---:|---:|---:|
| None (current) | 1.95 GB (measured) | $19.5 | — |
| 4 h | 0.95 GB | $9.5 | ≈ $10.0 (51 %) |
| 8 h | 1.37 GB | $13.7 | ≈ $5.8 (30 %) |
| 12 h | 1.61 GB | $16.1 | ≈ $3.4 (17 %) |

**This is not a novel hack.** It is the standard mitigation for exactly this
fragmentation-plateau shape, and every major Python server ships it:

- gunicorn `--max-requests` / `--max-requests-jitter` (jitter staggers restarts
  so they don't all fire at once) — https://gunicorn.org/reference/settings/
- uWSGI `reload-on-rss` / `evil-reload-on-rss` — an RSS-**threshold**-triggered
  recycle, the same mechanism built into the app server —
  https://uwsgi-docs.readthedocs.io/en/latest/Options.html
- Celery `worker_max_memory_per_child` / `worker_max_tasks_per_child` —
  https://docs.celeryq.dev/en/stable/userguide/optimizing.html
- Instagram's writeup on adaptive process/memory management for Python servers
  treats scheduled recycling as routine for allocator fragmentation —
  https://instagram-engineering.com/adaptive-process-and-memory-management-for-python-web-servers-15b0c410a043

Effort is **S**: the killing half already exists and is proven in production
(`bot/services/memory_guard.py`). Only the scheduled trigger is missing.

### Why this is not shipped yet

The worker runs money-path background services, and an `os._exit(137)` lands at
an arbitrary instant. A `money-path-reviewer` pass is auditing whether a kill
mid-fee-sweep can double-sweep or under-sweep, and whether a swap that
broadcast successfully but died before its transaction hash was persisted gets
falsely recorded as failed. **Findings and the safe interval go here when that
review returns.** Do not enable a recycle before then.

One implementation constraint is already established:
`railway.python-worker.json` sets `restartPolicyType: ON_FAILURE`, so a clean
exit code 0 would **not** restart — it would take the worker down permanently.
A graceful drain therefore requires either flipping the policy to `ALWAYS` or
exiting non-zero after draining. Reusing the existing `os._exit(137)` path
sidesteps that, at the cost of inheriting an ungraceful kill's risk profile.

Boot cost does not cancel the saving: the ~30 s restart is billed at
near-zero RSS while the process is gone, and the balance refresher's warmup
burst is a few seconds of CPU a handful of times a day against a $3.4–$10/mo
RAM saving.

## Sources

- Railway — right-size CPU and memory: https://docs.railway.com/guides/right-size-cpu-memory
- Railway — cost control: https://docs.railway.com/pricing/cost-control
- Railway — usage limits: https://docs.railway.com/reference/usage-limits
- gunicorn settings: https://gunicorn.org/reference/settings/
- uWSGI options (`reload-on-rss`): https://uwsgi-docs.readthedocs.io/en/latest/Options.html
- Celery optimizing: https://docs.celeryq.dev/en/stable/userguide/optimizing.html
- Instagram Engineering — adaptive process and memory management: https://instagram-engineering.com/adaptive-process-and-memory-management-for-python-web-servers-15b0c410a043
