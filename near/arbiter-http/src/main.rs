//! Suwappu Arbiter — rubric `http_json_v1`.
//!
//! The enclave fetches an HTTPS endpoint itself and checks buyer-committed predicates against the
//! response. No shared secret and no caller-supplied evidence. Deterministic given the response bytes;
//! `evidence_hash` is the sha256 of the response body.
//!
//! Input (stdin, JSON, built by the escrow contract from immutable terms):
//!   { "context": "http_json_v1", "escrow_id": 7,
//!     "url": "https://rpc.testnet.near.org", "method": "POST", "body": "{...json...}",
//!     "checks": [ { "path": "/result/amount", "op": "gte_int", "value": "1000000000000000000000000" } ],
//!     "expect_sha256": "" }
//!
//! Ops (all checks ANDed, at most 4):
//!   exists                       value absent; target must exist and be non-null
//!   eq                           value: string | bool | integer; strict type match, no coercion
//!   gte_int / lte_int            value: decimal-integer string or JSON integer; target parsed the same
//!                                way (i128). Floats are rejected, so ~1e24 yocto amounts are exact.
//!   contains                     value: non-empty string <= 64 bytes; target must be a string
//! `path` is an RFC 6901 JSON Pointer ("" = whole document).
//!
//! Output (stdout, JSON, < 900 bytes):
//!   { "verdict": "pass"|"fail", "reason": "...", "evidence_hash": "<sha256 hex of body>",
//!     "escrow_id": 7, "rubric": "http_json_v1", "url_hash": "<sha256 of METHOD url\nbody>" }
//!
//! Trust model: the endpoint's response is trusted by the enclave (TLS), not independently proven. If
//! the worker controls the endpoint, the worker controls the verdict. Time is NOT checked here: the
//! contract rejects `resolve` after the deadline using block time. Anything unexpected (non-200 incl.
//! redirects, timeout, malformed JSON, oversize body) yields a non-pass verdict, which never releases funds.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;

mod terms;
use terms::{num_int, parse_int, RUBRIC};

const MAX_BODY: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
struct Check {
    path: String,
    op: String,
    #[serde(default)]
    value: Option<Value>,
}

#[derive(Deserialize)]
struct Input {
    #[allow(dead_code)] // checked by terms::validate_value on the raw object
    context: String,
    escrow_id: u64,
    url: String,
    #[serde(default = "default_method")]
    method: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    checks: Vec<Check>,
    #[serde(default)]
    expect_sha256: String,
}

fn default_method() -> String {
    "GET".to_string()
}

#[derive(Serialize)]
struct Output {
    verdict: &'static str,
    reason: String,
    evidence_hash: String,
    escrow_id: u64,
    rubric: &'static str,
    url_hash: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn url_hash(i: &Input) -> String {
    hex(Sha256::digest(format!("{} {}\n{}", i.method, i.url, i.body).as_bytes()).as_ref())
}

fn emit(i: &Input, verdict: &'static str, reason: &str, evidence: &[u8]) {
    let o = Output {
        verdict,
        reason: reason.to_string(),
        evidence_hash: if evidence.is_empty() { String::new() } else { hex(Sha256::digest(evidence).as_ref()) },
        escrow_id: i.escrow_id,
        rubric: RUBRIC,
        url_hash: url_hash(i),
    };
    println!("{}", serde_json::to_string(&o).unwrap());
}

// ---------- evaluation (pure: status + body -> verdict) ----------

fn check_passes(c: &Check, doc: &Value) -> bool {
    let target = doc.pointer(&c.path);
    match c.op.as_str() {
        "exists" => matches!(target, Some(v) if !v.is_null()),
        "eq" => match (target, c.value.as_ref()) {
            (Some(Value::String(a)), Some(Value::String(b))) => a == b,
            (Some(Value::Bool(a)), Some(Value::Bool(b))) => a == b,
            (Some(Value::Number(a)), Some(Value::Number(b))) => {
                let (x, y) = (num_int(a), num_int(b));
                x.is_some() && x == y
            }
            _ => false,
        },
        "gte_int" => match (target.and_then(parse_int), c.value.as_ref().and_then(parse_int)) {
            (Some(a), Some(b)) => a >= b,
            _ => false,
        },
        "lte_int" => match (target.and_then(parse_int), c.value.as_ref().and_then(parse_int)) {
            (Some(a), Some(b)) => a <= b,
            _ => false,
        },
        "contains" => match (target, c.value.as_ref()) {
            (Some(Value::String(a)), Some(Value::String(b))) => a.contains(b.as_str()),
            _ => false,
        },
        _ => false,
    }
}

fn evaluate(i: &Input, status: u16, body: &[u8]) -> (&'static str, String) {
    if status != 200 {
        // 3xx lands here too: redirects are never followed or trusted.
        return ("fail", format!("http_status_{}", status));
    }
    if body.len() > MAX_BODY {
        return ("fail", "body_too_large".to_string());
    }
    if !i.expect_sha256.is_empty() && hex(Sha256::digest(body).as_ref()) != i.expect_sha256 {
        return ("fail", "hash_mismatch".to_string());
    }
    if !i.checks.is_empty() {
        let doc: Value = match serde_json::from_slice(body) {
            Ok(v) => v,
            Err(_) => return ("fail", "bad_json".to_string()),
        };
        for (idx, c) in i.checks.iter().enumerate() {
            if !check_passes(c, &doc) {
                return ("fail", format!("check_failed_{}", idx));
            }
        }
    }
    ("pass", "checks_satisfied".to_string())
}

// ---------- fetch ----------

#[cfg(target_arch = "wasm32")]
fn fetch(i: &Input) -> Result<(u16, Vec<u8>), &'static str> {
    let client = wasi_http_client::Client::new();
    let mut rb = if i.method == "POST" {
        client.post(&i.url).header("Content-Type", "application/json").body(i.body.as_bytes())
    } else {
        client.get(&i.url)
    };
    rb = rb
        .header("User-Agent", "suwappu-arbiter/1")
        .header("Accept", "application/json")
        .connect_timeout(std::time::Duration::from_secs(10));
    let resp = rb.send().map_err(|_| "fetch_failed")?;
    let status = resp.status();
    let mut body = Vec::new();
    loop {
        match resp.chunk(64 * 1024) {
            Ok(Some(c)) => {
                body.extend_from_slice(&c);
                if body.len() > MAX_BODY {
                    return Ok((status, body));
                }
            }
            Ok(None) => break,
            Err(_) => return Err("fetch_failed"),
        }
    }
    Ok((status, body))
}

/// Native builds exist only to run recorded fixtures: `ARBITER_HTTP_FIXTURE=<status>:<body-file>`.
/// This function is not compiled into the wasm artifact.
#[cfg(not(target_arch = "wasm32"))]
fn fetch(_i: &Input) -> Result<(u16, Vec<u8>), &'static str> {
    let spec = std::env::var("ARBITER_HTTP_FIXTURE").map_err(|_| "fetch_failed")?;
    let (status, path) = spec.split_once(':').ok_or("fetch_failed")?;
    let status: u16 = status.parse().map_err(|_| "fetch_failed")?;
    let body = if path.is_empty() { Vec::new() } else { std::fs::read(path).map_err(|_| "fetch_failed")? };
    Ok((status, body))
}

fn main() {
    let mut raw = String::new();
    let _ = std::io::stdin().lock().read_to_string(&mut raw);
    let raw_value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    let input: Input = match serde_json::from_value(raw_value.clone()) {
        Ok(i) => i,
        Err(_) => {
            println!(r#"{{"verdict":"fail","reason":"bad_input_json","evidence_hash":"","escrow_id":0,"rubric":"{}","url_hash":""}}"#, RUBRIC);
            return;
        }
    };
    // Validate the RAW object (unknown keys, null-vs-absent value fields) with the same code the contract uses.
    if let Err(reason) = terms::validate_value(&raw_value) {
        return emit(&input, "fail", reason, b"");
    }
    let (status, body) = match fetch(&input) {
        Ok(x) => x,
        Err(reason) => return emit(&input, "fail", reason, b""),
    };
    let (verdict, reason) = evaluate(&input, status, &body);
    emit(&input, verdict, &reason, &body)
}
