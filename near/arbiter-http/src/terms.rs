//! `http_json_v1` term validation and integer helpers.
//!
//! SINGLE SOURCE OF TRUTH: this file is compiled into BOTH the enclave (`arbiter-http`) and the escrow
//! contract (`arbiter-contract-v3`, via `#[path]`). The contract must reject exactly the terms the enclave
//! would reject, otherwise a buyer could lock funds under terms the arbiter can never pass. Keep this file
//! dependency-free apart from `serde_json::Value`; do not add enclave- or contract-specific code here.

use serde_json::Value;

pub const RUBRIC: &str = "http_json_v1";
pub const MAX_URL: usize = 300;
pub const MAX_POST_BODY: usize = 512;
pub const MAX_CHECKS: usize = 4;
pub const MAX_PATH: usize = 128;
pub const MAX_STR: usize = 128;
pub const MAX_CONTAINS: usize = 64;

const INVALID: &str = "invalid_terms";

/// Top-level keys accepted in terms. `escrow_id` is added by the contract when it builds the enclave input;
/// `deadline_unix` is enforced on-chain by the contract and ignored by the enclave.
const ALLOWED_KEYS: [&str; 8] = ["context", "escrow_id", "url", "method", "body", "checks", "expect_sha256", "deadline_unix"];

pub fn valid_host(h: &str) -> bool {
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

pub fn valid_url(url: &str) -> bool {
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

pub fn valid_path(p: &str) -> bool {
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

pub fn parse_dec(s: &str) -> Option<i128> {
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

pub fn num_int(n: &serde_json::Number) -> Option<i128> {
    n.as_i64().map(i128::from).or_else(|| n.as_u64().map(i128::from))
}

/// Decimal-integer string or JSON integer. Floats and everything else are rejected.
pub fn parse_int(v: &Value) -> Option<i128> {
    match v {
        Value::String(s) => parse_dec(s),
        Value::Number(n) => num_int(n),
        _ => None,
    }
}

fn valid_check(c: &Value) -> bool {
    let o = match c.as_object() {
        Some(o) => o,
        None => return false,
    };
    if o.keys().any(|k| k != "path" && k != "op" && k != "value") {
        return false;
    }
    let path = match o.get("path").and_then(Value::as_str) {
        Some(p) => p,
        None => return false,
    };
    if !valid_path(path) {
        return false;
    }
    let op = match o.get("op").and_then(Value::as_str) {
        Some(p) => p,
        None => return false,
    };
    let value = o.get("value");
    match op {
        "exists" => value.is_none(),
        "eq" => match value {
            Some(Value::String(s)) => s.len() <= MAX_STR,
            Some(Value::Bool(_)) => true,
            Some(Value::Number(n)) => num_int(n).is_some(),
            _ => false,
        },
        "gte_int" | "lte_int" => value.and_then(parse_int).is_some(),
        "contains" => matches!(value, Some(Value::String(s)) if !s.is_empty() && s.len() <= MAX_CONTAINS),
        _ => false,
    }
}

/// Validate http_json_v1 terms (raw JSON object). Err is the verdict `reason` the enclave emits.
pub fn validate_value(v: &Value) -> Result<(), &'static str> {
    let o = v.as_object().ok_or(INVALID)?;
    if o.keys().any(|k| !ALLOWED_KEYS.contains(&k.as_str())) {
        return Err(INVALID);
    }
    if o.get("context").and_then(Value::as_str) != Some(RUBRIC) {
        return Err("unknown_context");
    }
    let url = o.get("url").and_then(Value::as_str).ok_or(INVALID)?;
    if !valid_url(url) {
        return Err(INVALID);
    }
    let method = match o.get("method") {
        None => "GET",
        Some(Value::String(s)) => s.as_str(),
        _ => return Err(INVALID),
    };
    let body = match o.get("body") {
        None => "",
        Some(Value::String(s)) => s.as_str(),
        _ => return Err(INVALID),
    };
    match method {
        "GET" => {
            if !body.is_empty() {
                return Err(INVALID);
            }
        }
        "POST" => {
            if body.is_empty() || body.len() > MAX_POST_BODY || serde_json::from_str::<Value>(body).is_err() {
                return Err(INVALID);
            }
        }
        _ => return Err(INVALID),
    }
    let checks: &[Value] = match o.get("checks") {
        None => &[],
        Some(Value::Array(a)) => a.as_slice(),
        _ => return Err(INVALID),
    };
    if checks.len() > MAX_CHECKS || !checks.iter().all(valid_check) {
        return Err(INVALID);
    }
    let hash = match o.get("expect_sha256") {
        None => "",
        Some(Value::String(s)) => s.as_str(),
        _ => return Err(INVALID),
    };
    let has_hash = !hash.is_empty();
    if has_hash && !(hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))) {
        return Err(INVALID);
    }
    if checks.is_empty() && !has_hash {
        return Err(INVALID);
    }
    Ok(())
}
