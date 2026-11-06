# Arbiter rubric #2: `http_json_v1` (design, 2026-11-05)

Goal: make "Arbiter is a primitive, not a PR checker" true in code. A non-PR rubric that is deterministic, enclave-fetched (attested mode only; no proxy-witnessed evidence), and demoable on testnet with no new accounts on third-party services.

## What the code forces (read from source)

- `near/arbiter-contract/src/lib.rs`: `RUBRIC`, `ARBITER_WASM_HASH/URL/BUILD_TARGET` are compile-time constants (L40-43); `create_escrow` asserts `context == "github_pr_v1"` and validates PR-specific fields (L122-135); `resolve` builds PR-specific `input_data` (L191-199); `on_arbiter_result` accepts output only if it echoes the escrow id and the pinned `RUBRIC` (L234-237). No admin, no upgrade.
- Consequence: a second rubric = **new contract (new account, e.g. `arb3.suwappu-arbiter.testnet`)** with a compile-time rubric table. `arb2` stays untouched, so existing live evidence and txs remain valid.
- `near/arbiter-github/src/main.rs`: fetch via `wasi_http_client`, 2 MiB cap, 10 s connect timeout, any non-200 or malformed response yields `fail` (never releases), output echoes `escrow_id` + `rubric`. Reuse as-is.

## The rubric

`http_json_v1`: pass iff, at resolve time, an HTTPS endpoint the enclave fetches returns a body satisfying all buyer-committed checks. Evaluated by the enclave, never by a party.

Terms (immutable at creation, JSON, <= 2048 bytes; raise `MAX_TERMS_LEN` from 1024):

```json
{
  "context": "http_json_v1",
  "url": "https://rpc.testnet.near.org",
  "method": "POST",
  "body": "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"treasury.testnet\"}}",
  "checks": [
    {"path": "/result/amount", "op": "gte_int", "value": "1000000000000000000000000"}
  ],
  "deadline_unix": 1763500000
}
```

- `method`: `GET` or `POST` (POST body <= 512 B, sent as `application/json`). POST exists so on-chain state via JSON-RPC is checkable.
- `checks`: 1-4, ANDed. `path` is an RFC 6901 JSON Pointer. Ops: `exists`, `eq` (JSON string/bool/int equality), `gte_int` / `lte_int` (decimal integers parsed as i128; **floats rejected**, so NEAR yocto amounts of ~1e24 are exact), `contains` (string substring, <= 64 B).
- Optional `expect_sha256`: body hash must equal this (content-addressed deliverables).
- Always required: HTTP status exactly 200, body <= 2 MiB, body parses as JSON when any `checks` present.

Output (same shape as `github_pr_v1`, < 900 B): `{verdict, reason, evidence_hash (sha256 of body), escrow_id, rubric: "http_json_v1", url_hash}`. Reasons: `http_status_N`, `fetch_failed`, `body_too_large`, `bad_json`, `check_failed_<i>`, `hash_mismatch`, `invalid_terms`.

## Contract v3 changes

1. **Rubric table** (compile-time, still immutable): `const RUBRICS: [(&str, hash, url); 2]`. `create_escrow` picks the entry by `terms.context`; the caller still cannot supply a verdict source. Store the chosen rubric name on `Escrow`; `on_arbiter_result` checks the echo against *that escrow's* rubric.
2. **Per-rubric term validation**: PR validation unchanged. HTTP validation: `https://` only, length <= 300, no userinfo, no IP-literal or `localhost`/`.local`/`.internal` host, no explicit port other than 443, checks count/op/path syntax, deadline rules as today (future, <= 365 d).
3. **`resolve` input_data per rubric.** For HTTP, pass the validated terms plus `escrow_id`.
4. **Deadline semantics differ.** HTTP checks have no `merged_at` timestamp, so the enclave cannot prove *when* the state held. Rule: for `http_json_v1`, `resolve` is rejected after `deadline_unix` (block time); refund path unchanged (`deadline + 1h`). This keeps time enforcement on-chain instead of trusting the enclave clock.
5. **No `pr_index` for HTTP.** A true state may legitimately satisfy several escrows; dedupe only matters for the PR rubric. Keep the existing index for `github_pr_v1`.
6. Everything else (gas floor, `reset_stuck`, storage deposit, bounded fee, payout recovery, no admin) unchanged.

## Enclave (`near/arbiter-http`, new crate, `wasm32-wasip2`)

Copy `arbiter-github`'s I/O skeleton. New work: URL/host validation (defense in depth, same rules as the contract), JSON Pointer eval, i128 compare, POST. **Must verify before relying on it:** whether `wasi_http_client` follows redirects. If yes, disable or re-validate each hop (HTTPS only, same-host); an https URL that 302s to an internal address is the SSRF case.

## Trust model (state it in the page and docs)

- Proves: the pinned arbiter fetched *that URL* and the *response bytes* satisfied *those checks* at resolve time.
- Does not prove: that the endpoint told the truth, that the endpoint is neutral, or the work was good. **If the worker controls the URL, the worker controls the verdict.** Workers should accept only endpoints neither party controls (public RPC, a public API, GitHub). Buyers should pick checks that are false at creation (the contract cannot fetch to confirm; the web UI can do a dry fetch).
- Hardening (v1.1, not in scope): `url2` + quorum (two independent hosts must agree), which covers a single lying RPC.

## Demo and acceptance (testnet, no new third-party accounts)

- Pass: "pay worker when `treasury` account holds >= N NEAR" against the public testnet RPC `view_account`; create, fund the treasury, resolve -> `pass`, worker paid, `arbiter_attestation` log with `rubric=http_json_v1`.
- Fail: same escrow shape with an unreachable threshold -> `fail check_failed_0`, no transfer, escrow stays open.
- Probes (must be rejected on-chain): `http://` url, IP-literal host, port 8080, userinfo URL, 5 checks, float value, POST body > 512 B, resolve after deadline, unknown context, PR terms against an HTTP-only rubric field mix.
- Docs: add the rubric to `docs/arbiter-attestation-v1.md` and `docs/arbiter-production.md`; update `showcase` `/arbiter` and `/arbiter.json` only after live txs exist (no "live" claim before then).

## Cost and constraints

~4 days: arbiter-http 1.0, contract v3 + validation 1.5, testnet deploy + live txs 0.5, docs 0.5, review 0.5. Two hard dependencies:
1. The pinned WASM URL is a commit-specific raw GitHub URL, so the arbiter crate and artifact must be **pushed to the remote** before the contract can pin it. Pushing needs your go-ahead.
2. Contract v3 touches the escrow/payout path: **MONEY-PATH**, `money-path-reviewer` before any claim of "reviewed", and mainnet remains out of scope.

## Decisions needed

1. New contract `arb3` alongside `arb2` (recommended) vs. no second rubric.
2. POST in v1 (recommended; it enables the on-chain-state demo) vs. GET-only.
3. Go/no-go gate: proceed only if the new WASM runs on OutLayer testnet by Nov 8; otherwise drop it and ship the current entry unchanged.
