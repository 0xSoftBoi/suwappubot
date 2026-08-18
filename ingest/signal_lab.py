"""Suwappu Signal Lab — plain-English dashboard over canonical on-chain facts.

The dashboard intentionally exposes how every research score is produced. It is
not a trading endpoint and does not hide opaque model output behind a number.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import psycopg2
from aiohttp import web
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ["DATABASE_URL"]
PORT = int(os.getenv("PORT", "8080"))


def db():
    return psycopg2.connect(DATABASE_URL, connect_timeout=10, cursor_factory=RealDictCursor)


def rows(sql: str, params=()):
    with db() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def one(sql: str, params=()):
    rs = rows(sql, params)
    return rs[0] if rs else {}


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def token_score(r: dict[str, Any]) -> dict[str, Any]:
    tx5 = int(r.get("tx_5m") or 0)
    tx30 = int(r.get("tx_30m") or 0)
    buyers = int(r.get("buyers_5m") or 0)
    sellers = int(r.get("sellers_5m") or 0)
    repeat = int(r.get("repeat_buyers_5m") or 0)
    baseline_5m = max((tx30 - tx5) / 5.0, 1.0)
    acceleration = tx5 / baseline_5m

    velocity = round(clamp(acceleration * 12.0, 0, 40), 1)
    breadth = round(clamp(buyers * 3.0, 0, 30), 1)
    balance = round(clamp(10 + (buyers - sellers) * 1.5, 0, 20), 1)
    repeat_score = round(clamp(repeat * 2.0, 0, 10), 1)
    total = round(velocity + breadth + balance + repeat_score, 1)

    if total >= 75:
        label = "Strong on-chain attention"
    elif total >= 55:
        label = "Building attention"
    elif total >= 35:
        label = "Early activity"
    else:
        label = "Low activity"

    return {
        **r,
        "score": total,
        "label": label,
        "components": {
            "Flow acceleration": {"points": velocity, "max": 40, "why": f"{tx5} transactions in 5m vs ~{baseline_5m:.1f} per 5m baseline"},
            "Buyer breadth": {"points": breadth, "max": 30, "why": f"{buyers} distinct receiving wallets in 5m"},
            "Buy/sell balance": {"points": balance, "max": 20, "why": f"{buyers} buyers vs {sellers} sellers in 5m"},
            "Repeat participants": {"points": repeat_score, "max": 10, "why": f"{repeat} wallets also active across 3+ mints in 24h"},
        },
        "warning": "Research score only. It measures observable attention and participant behavior, not expected return.",
    }


async def api_overview(_: web.Request):
    data = one("""
      SELECT
        count(*)::bigint AS total_transactions,
        count(*) FILTER (WHERE ingested_at > now()-interval '5 minutes')::bigint AS tx_5m,
        count(DISTINCT fee_payer) FILTER (WHERE ingested_at > now()-interval '1 hour')::bigint AS wallets_1h,
        max(ingested_at) AS last_ingest,
        COALESCE(sum(raw_compressed_bytes) FILTER (WHERE raw_gzip IS NOT NULL),0)::bigint AS raw_bytes
      FROM pump_ingest_transactions
    """)
    mint = one("""
      SELECT count(DISTINCT mint)::bigint AS mints_1h
      FROM pump_ingest_token_deltas d
      JOIN pump_ingest_transactions t USING(signature)
      WHERE t.ingested_at > now()-interval '1 hour'
    """)
    metrics = one("""
      SELECT COALESCE(sum(rows_inserted),0)::bigint AS rows_1h,
             COALESCE(sum(errors),0)::bigint AS errors_1h,
             COALESCE(sum(raw_compressed_bytes),0)::bigint AS compressed_written_1h
      FROM pump_ingest_metrics WHERE minute > now()-interval '1 hour'
    """)
    cursors = rows("SELECT source_program, newest_slot, updated_at FROM pump_ingest_cursor ORDER BY source_program")
    def iso(v): return v.isoformat() if hasattr(v, "isoformat") else v
    out = {**data, **mint, **metrics, "cursors": cursors}
    out["last_ingest"] = iso(out.get("last_ingest"))
    for c in out["cursors"]: c["updated_at"] = iso(c.get("updated_at"))
    return web.json_response(out)


async def api_tokens(request: web.Request):
    limit = min(max(int(request.query.get("limit", "20")), 1), 100)
    rs = rows("""
      WITH repeat_wallets AS (
        SELECT owner
        FROM pump_ingest_token_deltas d
        JOIN pump_ingest_transactions t USING(signature)
        WHERE d.owner<>'' AND d.delta>0 AND t.ingested_at > now()-interval '24 hours'
        GROUP BY owner HAVING count(DISTINCT mint) >= 3
      ), base AS (
        SELECT d.mint, d.owner, d.delta, t.signature, t.ingested_at
        FROM pump_ingest_token_deltas d
        JOIN pump_ingest_transactions t USING(signature)
        WHERE d.owner<>'' AND t.ingested_at > now()-interval '30 minutes'
      )
      SELECT mint,
        count(DISTINCT signature) FILTER (WHERE ingested_at > now()-interval '5 minutes')::int AS tx_5m,
        count(DISTINCT signature)::int AS tx_30m,
        count(DISTINCT owner) FILTER (WHERE delta>0 AND ingested_at > now()-interval '5 minutes')::int AS buyers_5m,
        count(DISTINCT owner) FILTER (WHERE delta<0 AND ingested_at > now()-interval '5 minutes')::int AS sellers_5m,
        count(DISTINCT owner) FILTER (
          WHERE delta>0 AND ingested_at > now()-interval '5 minutes' AND owner IN (SELECT owner FROM repeat_wallets)
        )::int AS repeat_buyers_5m,
        max(ingested_at) AS last_seen
      FROM base GROUP BY mint
      HAVING count(DISTINCT signature) FILTER (WHERE ingested_at > now()-interval '5 minutes') > 0
      ORDER BY tx_5m DESC, buyers_5m DESC
      LIMIT %s
    """, (limit,))
    for r in rs:
        if r.get("last_seen"): r["last_seen"] = r["last_seen"].isoformat()
    return web.json_response([token_score(r) for r in rs])


async def api_wallets(request: web.Request):
    limit = min(max(int(request.query.get("limit", "20")), 1), 100)
    rs = rows("""
      SELECT d.owner AS wallet,
        count(DISTINCT d.mint)::int AS mints_24h,
        count(DISTINCT d.signature)::int AS transactions_24h,
        count(*) FILTER (WHERE d.delta>0)::int AS receive_events,
        count(*) FILTER (WHERE d.delta<0)::int AS send_events,
        max(t.ingested_at) AS last_seen
      FROM pump_ingest_token_deltas d
      JOIN pump_ingest_transactions t USING(signature)
      WHERE d.owner<>'' AND t.ingested_at > now()-interval '24 hours'
      GROUP BY d.owner
      ORDER BY mints_24h DESC, transactions_24h DESC
      LIMIT %s
    """, (limit,))
    for r in rs:
        if r.get("last_seen"): r["last_seen"] = r["last_seen"].isoformat()
        m = int(r["mints_24h"])
        n = int(r["transactions_24h"])
        r["label"] = "High-frequency multi-token participant" if m >= 10 else ("Repeat multi-token participant" if m >= 3 else "Single/few-token participant")
        r["plain_english"] = f"This wallet touched {m} different token mints across {n} observed transactions in the last 24 hours."
    return web.json_response(rs)


async def api_activity(request: web.Request):
    limit = min(max(int(request.query.get("limit", "30")), 1), 100)
    rs = rows("""
      SELECT signature, source_program, slot, fee_payer, success, fee_lamports,
             compute_units, instruction_count, token_delta_count, ingested_at
      FROM pump_ingest_transactions
      ORDER BY ingested_at DESC LIMIT %s
    """, (limit,))
    for r in rs:
        r["ingested_at"] = r["ingested_at"].isoformat() if r.get("ingested_at") else None
        r["what_it_means"] = (
            f"{r['token_delta_count']} token balance changes across {r['instruction_count']} instructions; "
            f"fee payer {short(r.get('fee_payer'))}."
        )
    return web.json_response(rs)


def short(v: Any) -> str:
    s = str(v or "")
    return s if len(s) <= 12 else s[:6] + "…" + s[-4:]


async def api_evidence(request: web.Request):
    mint = request.match_info["mint"]
    rs = rows("""
      SELECT t.signature, t.ingested_at, t.fee_payer, t.fee_lamports,
             d.owner, d.delta::text AS delta, d.decimals
      FROM pump_ingest_token_deltas d
      JOIN pump_ingest_transactions t USING(signature)
      WHERE d.mint=%s
      ORDER BY t.ingested_at DESC LIMIT 50
    """, (mint,))
    for r in rs:
        r["ingested_at"] = r["ingested_at"].isoformat() if r.get("ingested_at") else None
        r["direction"] = "received" if int(r["delta"]) > 0 else "sent"
    return web.json_response(rs)


async def health(_: web.Request):
    try:
        one("SELECT 1 AS ok")
        return web.json_response({"status": "ok"})
    except Exception as exc:
        return web.json_response({"status": "error", "detail": str(exc)}, status=503)


HTML = r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Suwappu Signal Lab</title><style>
:root{--bg:#090b0f;--panel:#10141b;--panel2:#151a22;--line:#252c37;--text:#f5f7fb;--muted:#8f9aaa;--good:#6ee7b7;--warn:#fbbf24;--hot:#fb7185;--blue:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1440px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--blue);font-weight:700}.title{font-size:31px;font-weight:720;letter-spacing:-.035em;margin:5px 0 4px}.sub{color:var(--muted);max-width:760px}.live{display:flex;align-items:center;gap:8px;color:var(--muted);white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 16px var(--good)}.grid{display:grid;gap:12px}.kpis{grid-template-columns:repeat(5,1fr);margin-bottom:12px}.card{background:linear-gradient(180deg,var(--panel),#0d1117);border:1px solid var(--line);border-radius:14px;padding:16px}.k-label{color:var(--muted);font-size:12px}.k-value{font-size:27px;font-weight:700;letter-spacing:-.03em;margin:5px 0}.k-note{color:var(--muted);font-size:11px}.main{grid-template-columns:1.45fr .85fr}.section-title{font-size:16px;font-weight:680;margin-bottom:3px}.section-sub{color:var(--muted);font-size:12px;margin-bottom:14px}.token{border-top:1px solid var(--line);padding:14px 0}.token:first-of-type{border-top:0}.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.mint{font-weight:650}.score{font-size:21px;font-weight:750}.pill{font-size:11px;border:1px solid var(--line);padding:3px 7px;border-radius:99px;color:var(--muted)}.bar{height:5px;background:#1a2029;border-radius:99px;overflow:hidden;margin:9px 0 10px}.bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--good));border-radius:99px}.components{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.component{background:var(--panel2);border:1px solid var(--line);padding:9px;border-radius:9px}.component b{display:block;font-size:12px}.component span{color:var(--muted);font-size:10px}.explain{display:none;margin-top:10px;background:#0b0e13;border-left:2px solid var(--blue);padding:10px 12px;color:var(--muted)}.token.open .explain{display:block}.recipe{padding:12px 0;border-top:1px solid var(--line)}.recipe:first-of-type{border-top:0}.recipe strong{display:block}.formula{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--blue);background:#0b0e13;padding:6px 8px;border-radius:6px;margin-top:6px}.tabs{display:flex;gap:7px;margin-bottom:12px}.tabs button{background:transparent;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer}.tabs button.on{color:var(--text);background:var(--panel2)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 7px;border-top:1px solid var(--line);font-size:12px}th{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em}.lower{margin-top:12px;grid-template-columns:1fr 1fr}.muted{color:var(--muted)}a{color:var(--blue);text-decoration:none}.empty{padding:30px;text-align:center;color:var(--muted)}.legend{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:11px;margin-top:8px}.legend b{color:var(--text)}@media(max-width:950px){.kpis{grid-template-columns:repeat(2,1fr)}.main,.lower{grid-template-columns:1fr}.components{grid-template-columns:repeat(2,1fr)}.top{flex-direction:column}}@media(max-width:560px){.wrap{padding:16px}.kpis{grid-template-columns:1fr 1fr}.title{font-size:26px}.components{grid-template-columns:1fr}.card{padding:13px}th:nth-child(n+4),td:nth-child(n+4){display:none}}
</style></head><body><div class="wrap"><div class="top"><div><div class="eyebrow">Suwappu research</div><div class="title">Signal Lab</div><div class="sub">A human-readable view of what Suwappu sees on-chain. Every score below is built only from Solana transactions and balance changes, and every point can be explained.</div></div><div class="live"><span class="dot"></span><span id="status">Connecting to ledger…</span></div></div>
<div class="grid kpis"><div class="card"><div class="k-label">Transactions observed</div><div class="k-value" id="total">—</div><div class="k-note">Canonical rows in SuwappuDB</div></div><div class="card"><div class="k-label">Last 5 minutes</div><div class="k-value" id="tx5">—</div><div class="k-note">Fresh on-chain transactions</div></div><div class="card"><div class="k-label">Active wallets · 1h</div><div class="k-value" id="wallets">—</div><div class="k-note">Distinct transaction fee payers</div></div><div class="card"><div class="k-label">Token mints · 1h</div><div class="k-value" id="mints">—</div><div class="k-note">Distinct mints with balance changes</div></div><div class="card"><div class="k-label">Ingest health</div><div class="k-value" id="errors">—</div><div class="k-note">Errors in the last hour</div></div></div>
<div class="grid main"><section class="card"><div class="row"><div><div class="section-title">What is heating up now?</div><div class="section-sub">Transparent attention score, 0–100. Click a token to see exactly why.</div></div><span class="pill">5m signal window</span></div><div id="tokens"><div class="empty">Waiting for on-chain token flow…</div></div><div class="legend"><span><b>40</b> flow acceleration</span><span><b>30</b> buyer breadth</span><span><b>20</b> buy/sell balance</span><span><b>10</b> repeat participants</span></div></section>
<aside class="card"><div class="section-title">How Suwappu gets a signal</div><div class="section-sub">No social feeds, token metadata, influencer posts or hidden model output.</div><div class="recipe"><strong>1 · Flow acceleration</strong><span class="muted">Is activity increasing versus the token’s own recent baseline?</span><div class="formula">5m tx ÷ prior 5m-equivalent baseline → 0–40 pts</div></div><div class="recipe"><strong>2 · Buyer breadth</strong><span class="muted">Are many distinct wallets receiving the token, or only one wallet?</span><div class="formula">distinct receiving wallets × 3 → 0–30 pts</div></div><div class="recipe"><strong>3 · Buy/sell balance</strong><span class="muted">Is observed wallet breadth skewed toward receiving or sending?</span><div class="formula">10 + 1.5 × (buyers − sellers) → 0–20 pts</div></div><div class="recipe"><strong>4 · Repeat participants</strong><span class="muted">Are wallets that repeatedly appear across multiple mints showing up here too?</span><div class="formula">repeat wallets × 2 → 0–10 pts</div></div><div class="recipe"><strong>Then: evidence</strong><span class="muted">The dashboard retains the transaction signatures and wallet/mint balance deltas behind each observation.</span></div></aside></div>
<div class="grid lower"><section class="card"><div class="section-title">Wallet behavior</div><div class="section-sub">Labels describe observed behavior only. They do not claim a wallet is profitable or identify its owner.</div><div id="walletTable"></div></section><section class="card"><div class="section-title">Latest chain evidence</div><div class="section-sub">The raw facts underneath the dashboard.</div><div id="activityTable"></div></section></div></div>
<script>
const fmt=n=>Number(n||0).toLocaleString();const sh=s=>!s?'—':s.length>14?s.slice(0,7)+'…'+s.slice(-5):s;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function get(p){const r=await fetch(p);if(!r.ok)throw Error(await r.text());return r.json()}
function renderTokens(ts){const el=document.querySelector('#tokens');if(!ts.length){el.innerHTML='<div class="empty">No 5-minute token activity yet.</div>';return}el.innerHTML=ts.map((t,i)=>{const comps=Object.entries(t.components).map(([n,c])=>`<div class="component"><b>${esc(n)} · ${c.points}/${c.max}</b><span>${esc(c.why)}</span></div>`).join('');return `<div class="token" onclick="this.classList.toggle('open')"><div class="row"><div><div class="mint mono">${esc(sh(t.mint))}</div><span class="pill">${esc(t.label)}</span></div><div class="score">${t.score}</div></div><div class="bar"><i style="width:${t.score}%"></i></div><div class="components">${comps}</div><div class="explain"><b style="color:var(--text)">What this means:</b> ${esc(t.warning)}<br><br><a href="https://solscan.io/token/${encodeURIComponent(t.mint)}" target="_blank" rel="noopener">Inspect mint on Solscan ↗</a></div></div>`}).join('')}
function renderWallets(ws){document.querySelector('#walletTable').innerHTML=ws.length?`<table><thead><tr><th>Wallet</th><th>Plain-English label</th><th>Mints</th><th>Tx</th></tr></thead><tbody>${ws.map(w=>`<tr><td class="mono"><a href="https://solscan.io/account/${encodeURIComponent(w.wallet)}" target="_blank">${esc(sh(w.wallet))}</a></td><td><b>${esc(w.label)}</b><div class="muted">${esc(w.plain_english)}</div></td><td>${fmt(w.mints_24h)}</td><td>${fmt(w.transactions_24h)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No wallet history yet.</div>'}
function renderActivity(xs){document.querySelector('#activityTable').innerHTML=xs.length?`<table><thead><tr><th>Transaction</th><th>What happened</th><th>Fee</th><th>Status</th></tr></thead><tbody>${xs.map(x=>`<tr><td class="mono"><a href="https://solscan.io/tx/${encodeURIComponent(x.signature)}" target="_blank">${esc(sh(x.signature))}</a></td><td>${esc(x.what_it_means)}</td><td>${fmt(x.fee_lamports)} lamports</td><td>${x.success?'✓ confirmed':'failed'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Waiting for transactions.</div>'}
async function refresh(){try{const [o,t,w,a]=await Promise.all([get('/api/overview'),get('/api/tokens?limit=12'),get('/api/wallets?limit=12'),get('/api/activity?limit=20')]);document.querySelector('#total').textContent=fmt(o.total_transactions);document.querySelector('#tx5').textContent=fmt(o.tx_5m);document.querySelector('#wallets').textContent=fmt(o.wallets_1h);document.querySelector('#mints').textContent=fmt(o.mints_1h);document.querySelector('#errors').textContent=fmt(o.errors_1h);const when=o.last_ingest?new Date(o.last_ingest).toLocaleTimeString(): 'no rows yet';document.querySelector('#status').textContent='Ledger updated '+when;renderTokens(t);renderWallets(w);renderActivity(a)}catch(e){document.querySelector('#status').textContent='Dashboard cannot reach the ledger';console.error(e)}}refresh();setInterval(refresh,10000);
</script></body></html>'''


async def index(_: web.Request):
    return web.Response(text=HTML, content_type="text/html")


def make_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/health", health)
    app.router.add_get("/api/overview", api_overview)
    app.router.add_get("/api/tokens", api_tokens)
    app.router.add_get("/api/wallets", api_wallets)
    app.router.add_get("/api/activity", api_activity)
    app.router.add_get("/api/evidence/{mint}", api_evidence)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=PORT, access_log=None)
