//! Suwappu Arbiter — production rubric `github_pr_v1`.
//!
//! The enclave fetches the pull request itself from the public GitHub API and checks it against
//! the escrow terms. There is NO shared secret and NO worker-supplied evidence, so neither party can
//! forge a verdict. Deterministic given the GitHub response; the response body hash is the
//! evidence hash.
//!
//! Input (stdin, JSON, built by the escrow contract from immutable terms):
//!   { "context": "github_pr_v1", "escrow_id": 7, "repo": "owner/name", "pr_number": 123,
//!     "author": "octocat", "deadline_unix": 1760000000 }
//!
//! Output (stdout, JSON, < 900 bytes):
//!   { "verdict": "pass"|"fail", "reason": "...", "evidence_hash": "<sha256 hex of GitHub body>",
//!     "escrow_id": 7, "repo": "...", "pr_number": 123, "rubric": "github_pr_v1" }
//!
//! Trust model: the GitHub response is trusted by the enclave (TLS to api.github.com), not
//! independently proven. Anything unexpected (HTTP error, rate limit, malformed JSON) yields a
//! non-pass verdict, which never releases funds.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;

const RUBRIC: &str = "github_pr_v1";
const MAX_BODY: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
struct Input {
    context: String,
    escrow_id: u64,
    repo: String,
    pr_number: u64,
    author: String,
    deadline_unix: i64,
}

#[derive(Serialize)]
struct Output {
    verdict: &'static str,
    reason: String,
    evidence_hash: String,
    escrow_id: u64,
    repo: String,
    pr_number: u64,
    rubric: &'static str,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn emit(i: &Input, verdict: &'static str, reason: &str, evidence: &[u8]) {
    let o = Output {
        verdict,
        reason: reason.to_string(),
        evidence_hash: if evidence.is_empty() { String::new() } else { hex(Sha256::digest(evidence).as_ref()) },
        escrow_id: i.escrow_id,
        repo: i.repo.clone(),
        pr_number: i.pr_number,
        rubric: RUBRIC,
    };
    println!("{}", serde_json::to_string(&o).unwrap());
}

fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn valid_repo(r: &str) -> bool {
    let mut it = r.split('/');
    match (it.next(), it.next(), it.next()) {
        (Some(o), Some(n), None) => valid_slug(o) && valid_slug(n),
        _ => false,
    }
}

fn main() {
    let mut raw = String::new();
    let _ = std::io::stdin().lock().read_to_string(&mut raw);
    let input: Input = match serde_json::from_str(&raw) {
        Ok(i) => i,
        Err(_) => {
            println!(r#"{{"verdict":"fail","reason":"bad_input_json","evidence_hash":"","escrow_id":0,"repo":"","pr_number":0,"rubric":"{}"}}"#, RUBRIC);
            return;
        }
    };
    if input.context != RUBRIC {
        return emit(&input, "fail", "unknown_context", b"");
    }
    if !valid_repo(&input.repo) || !valid_slug(&input.author) || input.pr_number == 0 || input.deadline_unix <= 0 {
        return emit(&input, "fail", "invalid_terms", b"");
    }

    let url = format!("https://api.github.com/repos/{}/pulls/{}", input.repo, input.pr_number);
    let resp = match wasi_http_client::Client::new()
        .get(&url)
        .header("User-Agent", "suwappu-arbiter/1")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .connect_timeout(std::time::Duration::from_secs(10))
        .send()
    {
        Ok(r) => r,
        Err(_) => return emit(&input, "fail", "github_unreachable", b""),
    };
    let status = resp.status();
    let body = match resp.body() {
        Ok(b) => b,
        Err(_) => return emit(&input, "fail", "github_body_error", b""),
    };
    if body.len() > MAX_BODY {
        return emit(&input, "fail", "github_body_too_large", b"");
    }
    if status != 200 {
        let reason = match status {
            404 => "pr_not_found".to_string(),
            403 | 429 => "github_rate_limited".to_string(),
            s => format!("github_status_{}", s),
        };
        return emit(&input, "fail", &reason, &body);
    }
    let v: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return emit(&input, "fail", "github_bad_json", &body),
    };

    // Same repo (case-insensitive) — guards against redirects / renamed repos.
    let base_repo = v["base"]["repo"]["full_name"].as_str().unwrap_or("");
    if !base_repo.eq_ignore_ascii_case(&input.repo) {
        return emit(&input, "fail", "repo_mismatch", &body);
    }
    if v["number"].as_u64() != Some(input.pr_number) {
        return emit(&input, "fail", "pr_number_mismatch", &body);
    }
    if v["merged"].as_bool() != Some(true) {
        return emit(&input, "fail", "not_merged", &body);
    }
    let author = v["user"]["login"].as_str().unwrap_or("");
    if !author.eq_ignore_ascii_case(&input.author) {
        return emit(&input, "fail", "author_mismatch", &body);
    }
    let merged_at = match v["merged_at"].as_str().and_then(iso8601_to_unix) {
        Some(t) => t,
        None => return emit(&input, "fail", "merged_at_missing", &body),
    };
    if merged_at > input.deadline_unix {
        return emit(&input, "fail", "merged_after_deadline", &body);
    }
    emit(&input, "pass", "merged_as_required", &body)
}

// Minimal ISO-8601 (UTC, "YYYY-MM-DDTHH:MM:SSZ") → unix seconds. No external time crate.
fn iso8601_to_unix(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |i: usize, n: usize| -> Option<i64> { s.get(i..i + n)?.parse::<i64>().ok() };
    let (year, month, day) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (hour, min, sec) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}
