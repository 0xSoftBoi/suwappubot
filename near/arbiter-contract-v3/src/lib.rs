//! Suwappu Arbiter — escrow contract v3: a compile-time table of pinned rubrics.
//!
//! v3 = v2 + a second rubric, `http_json_v1` (enclave-fetched HTTPS JSON predicates, see
//! `near/arbiter-http`). The rubric table below is a compile-time constant: callers pick a rubric from the
//! table via `terms.context` but can never supply their own arbiter hash/url, so the "no caller-chosen
//! verdict source" property of v2 is preserved. Deployed as a NEW account; v2 (`arb2`) is untouched.
//!
//! The v2 flow documentation follows (still accurate for `github_pr_v1`):
//!
//! Flow:
//!   1. buyer calls `create_escrow(worker, terms)` with the escrow amount attached. `terms` is JSON
//!      `{context:"github_pr_v1", repo, pr_number, author, deadline_unix}`; it is immutable.
//!   2. worker delivers (merges the PR into `repo`).
//!   3. anyone calls `resolve(id)` (attaching the OutLayer fee). The contract asks OutLayer to run the
//!      hash-pinned arbiter WASM, which fetches the PR from the GitHub API inside the enclave and checks
//!      merged / author / repo / merged_at <= deadline. There is NO shared secret and NO caller-supplied
//!      evidence, so neither party can forge a verdict.
//!   4. callback: `pass` pays the worker; anything else (fail, error, malformed output) leaves the escrow
//!      open. The buyer can refund only after `deadline + grace`.
//!
//! Hardening: arbiter hash/url, rubric and WASM target are compile-time constants (callers cannot pick
//! their own verdict source); one escrow per (repo, PR) so a merged PR can't satisfy two escrows;
//! the callback only accepts output that echoes this escrow's id and rubric; payout failure is
//! recoverable; field lengths capped; minimum deposit covers storage.
//!
//! No admin keys. No upgrade path. Trust anchor for the verdict is the OutLayer contract's
//! behaviour (the worker key that calls `resolve_execution`), not an on-chain TDX quote check.

use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

const RESOLVER: &str = "outlayer.testnet";
const RESOLVE_GAS: Gas = Gas::from_tgas(200);
const CALLBACK_GAS: Gas = Gas::from_tgas(40);
/// resolve must carry enough gas for OutLayer + the pass callback + the payout callback, or a caller
/// could starve the callback and leave the escrow stuck in Resolving.
const MIN_RESOLVE_PREPAID: Gas = Gas::from_tgas(290);
/// After this many blocks a stuck Resolving escrow can be reset to Created by anyone.
const RESOLVING_TIMEOUT_BLOCKS: u64 = 300;
/// Deadlines are capped so a PR cannot be squatted for years and the u64 math cannot wrap.
const MAX_DEADLINE_SECS: u64 = 365 * 24 * 3600;

/// The shared `http_json_v1` term validator. SAME FILE the enclave compiles, so the contract rejects exactly
/// what the arbiter would reject.
#[path = "../../arbiter-http/src/terms.rs"]
mod terms;

/// Pinned arbiters. OutLayer refuses a file whose sha256 differs from the hash. Compile-time only.
struct Rubric {
    name: &'static str,
    wasm_hash: &'static str,
    wasm_url: &'static str,
}
const ARBITER_BUILD_TARGET: &str = "wasm32-wasip2";
const RUBRIC_GITHUB_PR: &str = "github_pr_v1";
const RUBRIC_HTTP_JSON: &str = terms::RUBRIC; // "http_json_v1"
const RUBRICS: [Rubric; 2] = [
    Rubric {
        name: RUBRIC_GITHUB_PR,
        wasm_hash: "f1818167768f6b2b84b2031071760395d3e4a88cf319de3539d0d2068ad6412b",
        wasm_url: "https://raw.githubusercontent.com/0xSoftBoi/suwappubot/936382f249223fbc2cd0dad3ad99f32a66646e93/near/arbiter-github/artifacts/arbiter-github.wasm",
    },
    // NOTE: wasm_url resolves only after the commit below is pushed to the remote. If arbiter-http
    // changes, rebuild, update BOTH fields to the new artifact hash + the commit that contains it.
    Rubric {
        name: RUBRIC_HTTP_JSON,
        wasm_hash: "2acc016a94a45d01ef31734a0e1dcca8592048f06013eb74a99a82461b8260a7",
        wasm_url: "https://raw.githubusercontent.com/0xSoftBoi/suwappubot/1f85a7eeeef5b8a207f89130019adb17a47dd4cf/near/arbiter-http/artifacts/arbiter-http.wasm",
    },
];

fn rubric_def(name: &str) -> Option<&'static Rubric> {
    RUBRICS.iter().find(|r| r.name == name)
}

/// Buyer cannot refund until deadline + grace, so a worker who merged just before the deadline can resolve.
const REFUND_GRACE_SECS: u64 = 3600;
const MIN_ESCROW: NearToken = NearToken::from_millinear(10);
/// OutLayer needs ~0.0041 NEAR; bounded so the unused part (refunded to the caller) is small.
const MIN_RESOLVE_FEE: NearToken = NearToken::from_millinear(5);
const MAX_RESOLVE_FEE: NearToken = NearToken::from_millinear(20);
const MAX_TERMS_LEN_GITHUB: usize = 1024;
const MAX_TERMS_LEN_HTTP: usize = 2048;

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum EscrowStatus {
    Created,
    Resolving,
    Paid,
    /// Payout transfer to the worker failed; buyer may recover funds immediately.
    PayoutFailed,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Escrow {
    pub id: u64,
    pub buyer: AccountId,
    pub worker: AccountId,
    pub amount: U128,
    /// Storage cost of this record, paid by the buyer on top of `amount`; returned only on refund.
    pub storage_deposit: U128,
    pub resolving_since_block: u64,
    /// Incremented on every `resolve`. The callback must echo the nonce it was created with, so a late
    /// callback from a superseded resolution (after `reset_stuck`) can never pay or reopen the escrow.
    pub resolve_nonce: u64,
    pub terms: String,
    /// Pinned rubric name for this escrow (`github_pr_v1` | `http_json_v1`), fixed at creation.
    pub rubric: String,
    pub arbiter_wasm_hash: String,
    pub status: EscrowStatus,
    pub last_verdict: Option<String>,
    pub last_reason: Option<String>,
    pub evidence_hash: Option<String>,
    pub created_at_block: u64,
    pub deadline_unix: u64,
}

#[near(contract_state)]
pub struct ArbiterEscrow {
    pub next_id: u64,
    pub escrows: near_sdk::collections::UnorderedMap<u64, Escrow>,
    /// github_pr_v1 only: "<buyer>|<repo lowercase>#<pr>" -> escrow id. http_json_v1 has no index: a true
    /// state may legitimately satisfy several escrows.
    pub pr_index: near_sdk::collections::UnorderedMap<String, u64>,
}

impl Default for ArbiterEscrow {
    fn default() -> Self {
        Self {
            next_id: 0,
            escrows: near_sdk::collections::UnorderedMap::new(b"e"),
            pr_index: near_sdk::collections::UnorderedMap::new(b"p"),
        }
    }
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

#[near]
impl ArbiterEscrow {
    /// Create and fund an escrow. Attached deposit = the escrowed amount.
    #[payable]
    pub fn create_escrow(&mut self, worker: AccountId, terms: String) -> u64 {
        let deposit = env::attached_deposit();
        assert!(deposit >= MIN_ESCROW, "attach at least 0.01 NEAR");
        assert!(terms.len() <= MAX_TERMS_LEN_HTTP, "terms too long");
        let t: Value = serde_json::from_str(&terms).expect("terms must be JSON");
        let rubric = t["context"].as_str().unwrap_or("").to_string();
        let def = rubric_def(&rubric).expect("unknown rubric context");
        let deadline_unix = t["deadline_unix"].as_u64().expect("terms.deadline_unix required");
        let now = env::block_timestamp() / 1_000_000_000;
        assert!(deadline_unix > now, "deadline must be in the future");
        assert!(deadline_unix <= now + MAX_DEADLINE_SECS, "deadline too far");

        let buyer = env::predecessor_account_id();
        let mut index_key: Option<String> = None;
        if def.name == RUBRIC_GITHUB_PR {
            assert!(terms.len() <= MAX_TERMS_LEN_GITHUB, "terms too long");
            let repo = t["repo"].as_str().expect("terms.repo required");
            assert!(valid_repo(repo), "invalid repo");
            let author = t["author"].as_str().expect("terms.author required");
            assert!(valid_slug(author), "invalid author");
            let pr = t["pr_number"].as_u64().expect("terms.pr_number required");
            assert!(pr > 0, "invalid pr_number");
            if let Some(nb) = t.get("not_before_unix") {
                assert!(nb.as_u64().map(|n| n <= deadline_unix).unwrap_or(false), "invalid not_before_unix");
            }
            // Index is per buyer so a stranger cannot squat someone else's PR.
            let key = format!("{}|{}#{}", buyer, repo.to_ascii_lowercase(), pr);
            assert!(self.pr_index.get(&key).is_none(), "you already have an escrow for this PR");
            index_key = Some(key);
        } else {
            // `escrow_id` is injected by the contract at resolve time; a buyer-supplied one would only mislead
            // anyone reading the stored terms (terms.rs permits the key because the enclave input carries it).
            assert!(t.get("escrow_id").is_none(), "escrow_id is set by the contract");
            // http_json_v1: the SAME validator the enclave runs (shared file), so unpayable terms never lock funds.
            if let Err(reason) = terms::validate_value(&t) {
                env::panic_str(reason);
            }
        }

        let usage_before = env::storage_usage();

        let id = self.next_id;
        self.next_id += 1;
        if let Some(k) = &index_key {
            self.pr_index.insert(k, &id);
        }
        let mut escrow = Escrow {
                id,
                buyer,
                worker,
                amount: U128(0),
                storage_deposit: U128(0),
                resolving_since_block: 0,
                resolve_nonce: 0,
                terms,
                rubric: rubric.clone(),
                arbiter_wasm_hash: def.wasm_hash.to_string(),
                status: EscrowStatus::Created,
                last_verdict: None,
                last_reason: None,
                evidence_hash: None,
                created_at_block: env::block_height(),
                deadline_unix,
        };
        self.escrows.insert(&id, &escrow);
        // Measure real storage growth (record + both map entries + index) and charge it to the buyer,
        // so storage is never paid out of other users' escrowed funds. The reserve (+384) also covers the
        // verdict/reason/evidence_hash fields written at resolve time (up to ~150 bytes), which v2's +64 did not.
        let used = env::storage_usage().saturating_sub(usage_before) + 384;
        let storage_cost = env::storage_byte_cost().saturating_mul(used as u128);
        assert!(deposit >= storage_cost.saturating_add(MIN_ESCROW), "deposit too small to cover storage + 0.01 NEAR");
        escrow.storage_deposit = U128(storage_cost.as_yoctonear());
        escrow.amount = U128(deposit.as_yoctonear() - storage_cost.as_yoctonear());
        self.escrows.insert(&id, &escrow);
        env::log_str(&format!(
            "arbiter_escrow_created id={} rubric={} pr_key={}",
            id,
            rubric,
            index_key.as_deref().unwrap_or("-")
        ));
        id
    }

    /// Ask OutLayer to run the pinned arbiter for this escrow. Anyone may call; the outcome depends
    /// only on the immutable terms and GitHub. Attach 0.005-0.02 NEAR for the OutLayer fee; the unused
    /// part is refunded to the caller (payer_account_id).
    #[payable]
    pub fn resolve(&mut self, id: u64) -> Promise {
        let deposit = env::attached_deposit();
        assert!(deposit >= MIN_RESOLVE_FEE && deposit <= MAX_RESOLVE_FEE, "attach 0.005-0.02 NEAR for OutLayer");
        assert!(env::prepaid_gas() >= MIN_RESOLVE_PREPAID, "attach at least 290 Tgas");
        let mut escrow = self.escrows.get(&id).expect("escrow not found");
        assert!(escrow.status == EscrowStatus::Created, "not resolvable");
        let def = rubric_def(&escrow.rubric).expect("escrow rubric not in table");
        if def.name == RUBRIC_HTTP_JSON {
            // http_json_v1 has no in-evidence timestamp (unlike a PR's merged_at), so the deadline is enforced
            // here with block time: a state check is only meaningful at or before the deadline.
            let now = env::block_timestamp() / 1_000_000_000;
            assert!(now <= escrow.deadline_unix, "deadline passed; only refund remains");
        }
        escrow.status = EscrowStatus::Resolving;
        escrow.resolving_since_block = env::block_height();
        escrow.resolve_nonce += 1;
        let nonce = escrow.resolve_nonce;
        self.escrows.insert(&id, &escrow);

        let t: Value = serde_json::from_str(&escrow.terms).expect("stored terms must be JSON");
        let input_data = if def.name == RUBRIC_GITHUB_PR {
            json!({
                "context": RUBRIC_GITHUB_PR,
                "escrow_id": id,
                "repo": t["repo"],
                "pr_number": t["pr_number"],
                "author": t["author"],
                "deadline_unix": t["deadline_unix"],
                "not_before_unix": t.get("not_before_unix").cloned().unwrap_or(json!(0)),
            })
            .to_string()
        } else {
            // Stored terms were validated at creation by the shared validator. Hand the enclave only the
            // predicate fields (deadline is contract-enforced) plus this escrow's id.
            let mut m = t.as_object().cloned().expect("stored terms must be an object");
            m.remove("deadline_unix");
            m.insert("escrow_id".to_string(), json!(id));
            Value::Object(m).to_string()
        };

        Promise::new(RESOLVER.parse().unwrap())
            .function_call(
                "request_execution".to_string(),
                json!({
                    "source": { "WasmUrl": {
                        "url": def.wasm_url,
                        "hash": def.wasm_hash,
                        "build_target": ARBITER_BUILD_TARGET,
                    }},
                    "input_data": input_data,
                    "resource_limits": {
                        "max_instructions": 2_000_000_000u64,
                        "max_memory_mb": 64u32,
                        "max_execution_seconds": 30u64,
                    },
                    "response_format": "Json",
                    "payer_account_id": env::predecessor_account_id(),
                })
                .to_string()
                .into_bytes(),
                deposit,
                RESOLVE_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_arbiter_result(id, nonce))
    }

    #[private]
    pub fn on_arbiter_result(&mut self, id: u64, nonce: u64) {
        let data_result = env::promise_result_checked(0, 16 * 1024);
        // The escrow may be gone (refunded after reset_stuck) or may belong to a newer resolution. Never panic and
        // never act on a stale callback: acting twice is how a paid escrow would be paid again or reopened.
        let mut escrow = match self.escrows.get(&id) {
            Some(e) => e,
            None => {
                env::log_str(&format!("arbiter_stale_callback id={} nonce={} reason=escrow_gone", id, nonce));
                return;
            }
        };
        if escrow.status != EscrowStatus::Resolving || escrow.resolve_nonce != nonce {
            env::log_str(&format!(
                "arbiter_stale_callback id={} nonce={} current_nonce={} status={:?}",
                id, nonce, escrow.resolve_nonce, escrow.status
            ));
            return;
        }
        let parsed: Option<Value> = data_result.ok().and_then(|d| serde_json::from_slice(&d).ok());
        // Accept the output only if it echoes this escrow's id and the pinned rubric.
        let valid = parsed
            .as_ref()
            .map(|v| v["escrow_id"].as_u64() == Some(id) && v["rubric"].as_str() == Some(escrow.rubric.as_str()))
            .unwrap_or(false);
        let (verdict, reason, evidence_hash) = if valid {
            let v = parsed.unwrap();
            (
                v["verdict"].as_str().unwrap_or("fail").to_string(),
                v["reason"].as_str().unwrap_or("").chars().take(64).collect::<String>(),
                v["evidence_hash"].as_str().unwrap_or("").chars().take(64).collect::<String>(),
            )
        } else {
            ("error".to_string(), "arbiter_output_invalid_or_failed".to_string(), String::new())
        };
        escrow.last_verdict = Some(verdict.clone());
        escrow.last_reason = Some(reason.clone());
        escrow.evidence_hash = Some(evidence_hash.clone());
        if verdict == "pass" {
            let amount = NearToken::from_yoctonear(escrow.amount.0);
            escrow.status = EscrowStatus::Paid;
            let worker = escrow.worker.clone();
            // pr_index entry is kept: a PR that has paid once can never pay another escrow.
            self.escrows.insert(&id, &escrow);
            env::log_str(&format!(
                "arbiter_attestation id={} worker={} verdict=pass evidence_hash={} arbiter={} rubric={}",
                id, worker, evidence_hash, escrow.arbiter_wasm_hash, escrow.rubric
            ));
            let _ = Promise::new(worker)
                .transfer(amount)
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_payout(id));
        } else {
            // A non-pass verdict never ends the escrow; it stays open for another resolve.
            escrow.status = EscrowStatus::Created;
            self.escrows.insert(&id, &escrow);
            env::log_str(&format!(
                "arbiter_attestation id={} worker={} verdict={} reason={} evidence_hash={} arbiter={} rubric={}",
                id, escrow.worker, verdict, reason, evidence_hash, escrow.arbiter_wasm_hash, escrow.rubric
            ));
        }
    }

    #[private]
    pub fn on_payout(&mut self, id: u64) {
        if env::promise_result_checked(0, 0).is_err() {
            if let Some(mut e) = self.escrows.get(&id).filter(|e| e.status == EscrowStatus::Paid) {
                e.status = EscrowStatus::PayoutFailed;
                self.escrows.insert(&id, &e);
                env::log_str(&format!("arbiter_payout_failed id={}", id));
            }
        }
    }

    /// Buyer recovers funds: only after deadline + grace without a pass (or immediately if the
    /// worker payout failed). A fail verdict alone never releases funds.
    pub fn cancel_expired(&mut self, id: u64) {
        let now = env::block_timestamp() / 1_000_000_000;
        let escrow = self.escrows.get(&id).expect("escrow not found");
        assert!(env::predecessor_account_id() == escrow.buyer, "buyer only");
        assert!(escrow.status != EscrowStatus::Paid, "already paid");
        assert!(escrow.status != EscrowStatus::Resolving, "resolution in flight");
        let immediate = escrow.status == EscrowStatus::PayoutFailed;
        assert!(immediate || now >= escrow.deadline_unix + REFUND_GRACE_SECS, "deadline + grace not passed");
        let amount = NearToken::from_yoctonear(escrow.amount.0 + escrow.storage_deposit.0);
        self.escrows.remove(&id);
        self.drop_index(&escrow);
        let _ = Promise::new(escrow.buyer).transfer(amount);
    }

    /// Anyone may un-stick an escrow whose resolution never called back (e.g. out of gas).
    pub fn reset_stuck(&mut self, id: u64) {
        let mut e = self.escrows.get(&id).expect("escrow not found");
        assert!(e.status == EscrowStatus::Resolving, "not resolving");
        assert!(env::block_height() >= e.resolving_since_block + RESOLVING_TIMEOUT_BLOCKS, "resolution still in flight");
        e.status = EscrowStatus::Created;
        self.escrows.insert(&id, &e);
        env::log_str(&format!("arbiter_reset_stuck id={}", id));
    }

    pub fn get_escrow(&self, id: u64) -> Option<Escrow> {
        self.escrows.get(&id)
    }

    pub fn total_escrows(&self) -> u64 {
        self.next_id
    }

    pub fn arbiter(&self) -> Value {
        let rubrics: Vec<Value> = RUBRICS
            .iter()
            .map(|r| json!({ "rubric": r.name, "wasm_hash": r.wasm_hash, "wasm_url": r.wasm_url }))
            .collect();
        // Top-level rubric/wasm_hash/wasm_url keep the v2 shape and describe github_pr_v1 ONLY; v3 consumers must
        // read `rubrics` (all pinned rubrics) and each escrow's own `rubric`.
        json!({
            "rubric": RUBRICS[0].name,
            "wasm_hash": RUBRICS[0].wasm_hash,
            "wasm_url": RUBRICS[0].wasm_url,
            "rubrics": rubrics,
            "build_target": ARBITER_BUILD_TARGET,
            "resolver": RESOLVER,
            "contract": "v3",
        })
    }
}

impl ArbiterEscrow {
    fn drop_index(&mut self, e: &Escrow) {
        if e.rubric != RUBRIC_GITHUB_PR {
            return;
        }
        if let Ok(t) = serde_json::from_str::<Value>(&e.terms) {
            if let (Some(repo), Some(pr)) = (t["repo"].as_str(), t["pr_number"].as_u64()) {
                self.pr_index.remove(&format!("{}|{}#{}", e.buyer, repo.to_ascii_lowercase(), pr));
            }
        }
    }
}
