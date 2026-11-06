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

const RUBRIC: &str = "http_json_v1";
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_URL: usize = 300;
const MAX_POST_BODY: usize = 512;
const MAX_CHECKS: usize = 4;
const MAX_PATH: usize = 128;
const MAX_STR: usize = 128;
const MAX_CONTAINS: usize = 64;

#[derive(Deserialize)]
struct Check {
    path: String,
    op: String,
    #[serde(default)]
    value: Option<Value>,
}

#[derive(Deserialize)]
struct Input {
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

// ---------- term validation (the contract validates too; this is defense in depth) ----------

fn valid_host(h: &str) -> bool {
    if h.is_empty() || h.len() > 253 {
        return false;
    }
    let h = h.to_ascii_lowercase();
    if h == "localhost" || [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain"].iter().any(|s| h.ends_with(s)) {
        return false;
    }
    let labels: Vec<&str> = h.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    for l in &labels {
        if l.is_empty() || l.len() > 63 || l.starts_with('-') || l.ends_with('-') {
            return false;
        }
        if !l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return false;
        }
    }
    // An alphabetic TLD of >= 2 chars rules out every IPv4 spelling (dotted, decimal, hex, octal).
    let tld = labels[labels.len() - 1];
    tld.len() >= 2 && tld.bytes().all(|b| b.is_ascii_alphabetic())
}

fn valid_url(url: &str) -> bool {
    if url.len() > MAX_URL || !url.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        return false;
    }
    let rest = match url.strip_prefix("https://") {
        Some(r) => r,
        None => return false,
    };
    let end = rest.find(|c| c == '/' || c == '?' || c == '#').unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.is_empty() || authority.contains('@') || authority.contains('[') || authority.contains('\\') {
        return false;
    }
    let host = match authority.split_once(':') {
        Some((h, p)) => {
            if p != "443" {
                return false;
            }
            h
        }
        None => authority,
    };
    valid_host(host)
}

fn valid_path(p: &str) -> bool {
    if p.len() > MAX_PATH {
        return false;
    }
    if p.is_empty() {
        return true;
    }
    if !p.starts_with('/') {
        return false;
    }
    let b = p.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'~' {
            match b.get(i + 1) {
                Some(b'0') | Some(b'1') => i += 1,
                _ => return false,
            }
        }
        i += 1;
    }
    true
}

fn parse_dec(s: &str) -> Option<i128> {
    let (neg, d) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s),
    };
    if d.is_empty() || d.len() > 38 || !d.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if d.len() > 1 && d.starts_with('0') {
        return None;
    }
    let n: i128 = d.parse().ok()?;
    Some(if neg { -n } else { n })
}

fn num_int(n: &serde_json::Number) -> Option<i128> {
    n.as_i64().map(i128::from).or_else(|| n.as_u64().map(i128::from))
}

/// Decimal-integer string or JSON integer. Floats and everything else are rejected.
fn parse_int(v: &Value) -> Option<i128> {
    match v {
        Value::String(s) => parse_dec(s),
        Value::Number(n) => num_int(n),
        _ => None,
    }
}

fn valid_check(c: &Check) -> bool {
    if !valid_path(&c.path) {
        return false;
    }
    match c.op.as_str() {
        "exists" => c.value.is_none(),
        "eq" => match &c.value {
            Some(Value::String(s)) => s.len() <= MAX_STR,
            Some(Value::Bool(_)) => true,
            Some(Value::Number(n)) => num_int(n).is_some(),
            _ => false,
        },
        "gte_int" | "lte_int" => c.value.as_ref().and_then(parse_int).is_some(),
        "contains" => matches!(&c.value, Some(Value::String(s)) if !s.is_empty() && s.len() <= MAX_CONTAINS),
        _ => false,
    }
}

fn validate(i: &Input) -> Result<(), &'static str> {
    if i.context != RUBRIC {
        return Err("unknown_context");
    }
    if !valid_url(&i.url) {
        return Err("invalid_terms");
    }
    match i.method.as_str() {
        "GET" => {
            if !i.body.is_empty() {
                return Err("invalid_terms");
            }
        }
        "POST" => {
            if i.body.is_empty() || i.body.len() > MAX_POST_BODY || serde_json::from_str::<Value>(&i.body).is_err() {
                return Err("invalid_terms");
            }
        }
        _ => return Err("invalid_terms"),
    }
    if i.checks.len() > MAX_CHECKS || !i.checks.iter().all(valid_check) {
        return Err("invalid_terms");
    }
    let has_hash = !i.expect_sha256.is_empty();
    if has_hash && !(i.expect_sha256.len() == 64 && i.expect_sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))) {
        return Err("invalid_terms");
    }
    if i.checks.is_empty() && !has_hash {
        return Err("invalid_terms");
    }
    Ok(())
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
    let input: Input = match serde_json::from_str(&raw) {
        Ok(i) => i,
        Err(_) => {
            println!(r#"{{"verdict":"fail","reason":"bad_input_json","evidence_hash":"","escrow_id":0,"rubric":"{}","url_hash":""}}"#, RUBRIC);
            return;
        }
    };
    if let Err(reason) = validate(&input) {
        return emit(&input, "fail", reason, b"");
    }
    let (status, body) = match fetch(&input) {
        Ok(x) => x,
        Err(reason) => return emit(&input, "fail", reason, b""),
    };
    let (verdict, reason) = evaluate(&input, status, &body);
    emit(&input, verdict, &reason, &body)
}
