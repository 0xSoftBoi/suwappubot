//! Suwappu Arbiter — attested evidence verifier (rubric #1: GitHub PRs).
//!
//! Input (stdin, JSON):
//! {
//!   "context": "github_pr",
//!   "repo": "owner/name",
//!   "pr_number": 123,
//!   "author": "octocat",
//!   "deadline_unix": 1760000000,          // optional; 0 = no deadline
//!   "payload_b64": "<base64 of raw webhook body>",
//!   "signature_hex": "<hex hmac-sha256 signature from x-hub-signature-256>"
//! }
//!
//! The webhook secret is injected into the enclave as env var `GITHUB_WEBHOOK_SECRET`
//! (OutLayer secrets). No network I/O. Deterministic: same input, same output, every time.
//!
//! Output (stdout, JSON):
//! { "verdict": "pass"|"fail", "reason": "...", "evidence_hash": "<sha256 hex of payload bytes>" }

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
struct Input {
    context: String,
    repo: Option<String>,
    pr_number: Option<u64>,
    author: Option<String>,
    deadline_unix: Option<i64>,
    payload_b64: String,
    signature_hex: String,
}

#[derive(Serialize)]
struct Output {
    verdict: String,
    reason: String,
    evidence_hash: String,
}

fn out(verdict: &str, reason: impl Into<String>, payload: &[u8]) -> Output {
    Output {
        verdict: verdict.to_string(),
        reason: reason.into(),
        evidence_hash: hex(Sha256::digest(payload).as_ref()),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut acc = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

fn main() {
    let raw = raw_or_read();
    // std::io::stdin() has no read_to_string on all wasi targets; read via Read impl.
    let input: Input = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            println!(
                r#"{{"verdict":"fail","reason":"bad_input_json","evidence_hash":""}}"#
            );
            return;
        }
    };

    let payload = match B64.decode(input.payload_b64.as_bytes()) {
        Ok(p) => p,
        Err(_) => {
            println!(
                r#"{{"verdict":"fail","reason":"payload_b64_decode_failed","evidence_hash":""}}"#
            );
            return;
        }
    };
    let evidence_hash = hex(Sha256::digest(&payload).as_ref());

    let secret = match std::env::var("GITHUB_WEBHOOK_SECRET") {
        Ok(s) => s,
        Err(_) => {
            println!(
                r#"{{"verdict":"fail","reason":"missing_enclave_secret","evidence_hash":"{}"}}"#,
                evidence_hash
            );
            return;
        }
    };

    if input.context != "github_pr" {
        println!(
            "{}",
            serde_json::to_string(&out("fail", "unknown_context", &payload)).unwrap()
        );
        return;
    }

    // 1) verify webhook signature
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(&payload);
    let expected = mac.finalize().into_bytes();
    let expected_hex = hex(&expected);
    if !constant_time_eq(input.signature_hex.as_bytes(), expected_hex.as_bytes()) {
        println!(
            "{}",
            serde_json::to_string(&out("fail", "bad_signature", &payload)).unwrap()
        );
        return;
    }

    // 2) parse payload
    let p: serde_json::Value = match serde_json::from_slice(&payload) {
        Ok(v) => v,
        Err(_) => {
            println!(
                "{}",
                serde_json::to_string(&out("fail", "payload_json_parse_failed", &payload)).unwrap()
            );
            return;
        }
    };

    let repo = p["repository"]["full_name"].as_str().unwrap_or("");
    let want_repo = input.repo.as_deref().unwrap_or("");
    if want_repo.is_empty() || !repo.eq_ignore_ascii_case(want_repo) {
        println!(
            "{}",
            serde_json::to_string(&out("fail", "repo_mismatch", &payload)).unwrap()
        );
        return;
    }

    let pr = &p["pull_request"];
    let number = pr["number"].as_u64().unwrap_or(0);
    if input.pr_number.map(|n| n != number).unwrap_or(true) {
        println!(
            "{}",
            serde_json::to_string(&out("fail", "pr_number_mismatch", &payload)).unwrap()
        );
        return;
    }

    let author = pr["user"]["login"].as_str().unwrap_or("");
    if let Some(a) = input.author.as_deref() {
        if !author.eq_ignore_ascii_case(a) {
            println!(
                "{}",
                serde_json::to_string(&out("fail", "author_mismatch", &payload)).unwrap()
            );
            return;
        }
    }

    let merged = pr["merged"].as_bool().unwrap_or(false);
    if !merged {
        println!(
            "{}",
            serde_json::to_string(&out("fail", "not_merged", &payload)).unwrap()
        );
        return;
    }

    if let Some(dl) = input.deadline_unix {
        if dl > 0 {
            let merged_at = pr["merged_at"].as_str().unwrap_or("");
            // merged_at is ISO-8601: 2026-11-03T12:34:56Z — parse coarsely via epoch string compare is
            // not possible without a date lib; use GitHub's own unix-ish ordering: compare against
            // deadline by converting merged_at with a minimal parser (seconds precision).
            match iso8601_to_unix(merged_at) {
                Some(ts) => {
                    if ts > dl {
                        println!(
                            "{}",
                            serde_json::to_string(&out("fail", "past_deadline", &payload)).unwrap()
                        );
                        return;
                    }
                }
                None => {
                    println!(
                        "{}",
                        serde_json::to_string(&out("fail", "merged_at_unparseable", &payload))
                            .unwrap()
                    );
                    return;
                }
            }
        }
    }

    println!(
        "{}",
        serde_json::to_string(&out("pass", "merged_as_required", &payload)).unwrap()
    );
}

// Reads stdin via wasi; kept separate because read_to_string on Stdin is not stable.
fn raw_or_read() -> String {
    use std::io::{Read, stdin};
    let mut s = String::new();
    let _ = stdin().lock().read_to_string(&mut s);
    s
}

// Minimal ISO-8601 (UTC, "YYYY-MM-DDTHH:MM:SSZ") → unix seconds. No external time crate.
fn iso8601_to_unix(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |i: usize, n: usize| -> Option<i64> {
        s.get(i..i + n)?.parse::<i64>().ok()
    };
    let year = num(0, 4)?;
    let month = num(5, 2)?;
    let day = num(8, 2)?;
    let hour = num(11, 2)?;
    let min = num(14, 2)?;
    let sec = num(17, 2)?;
    // days-from-civil (Howard Hinnant algorithm)
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}
