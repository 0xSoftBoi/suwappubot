//! Suwappu Arbiter — escrow contract.
//!
//! Flow:
//!   1. buyer calls `create_escrow` with attached NEAR + human-readable `terms` (JSON string)
//!      describing the rubric (repo, pr_number, author, deadline) + the arbiter WASM reference.
//!   2. worker delivers (e.g. merges the PR).
//!   3. anyone calls `resolve` with the evidence (raw webhook payload + HMAC signature, base64).
//!      The contract forwards verification to OutLayer (`outlayer.testnet`) via yield/resume.
//!   4. callback parses the verdict; `pass` pays the worker, `fail` keeps funds refundable by
//!      the buyer after the deadline. No admin keys. Rubric is immutable once created.
//!
//! Attestation: the verdict + evidence hash is returned from the enclave and logged on-chain in
//! the tx. `get_attestation(id)` returns the material needed to verify independently.

use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

const RESOLVER: &str = "outlayer.testnet";
const RESOLVE_GAS: Gas = Gas::from_tgas(200);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

// --- Hardening (money-path review) -------------------------------------------------------
// The verdict source is pinned at compile time: callers cannot supply their own arbiter WASM
// or rubric context. Demo build: only the public demo rubric is allowed, so this contract is
// TESTNET-ONLY and must not hold real funds (the demo HMAC secret is public).
const ALLOWED_WASM_HASH: &str = "2e4f74d47e770b252dec155e909329e220f5f731ef8b3563d8246f3bc197534e";
const ALLOWED_WASM_URL: &str = "https://raw.githubusercontent.com/0xSoftBoi/suwappubot/hackathon/arbiter/near/arbiter-wasm/artifacts/arbiter-wasm.wasm";
const ALLOWED_CONTEXT: &str = "github_pr_demo";
/// Buyer cannot refund until deadline + grace, so a worker who merged just before the deadline can still resolve.
const REFUND_GRACE_SECS: u64 = 3600;
/// Covers storage for the escrow record and keeps spam uneconomic.
const MIN_ESCROW: NearToken = NearToken::from_millinear(10);
/// OutLayer needs ~0.0041 NEAR; cap the forward so unused fee is not stranded in large amounts.
const MIN_RESOLVE_FEE: NearToken = NearToken::from_millinear(5);
const MAX_RESOLVE_FEE: NearToken = NearToken::from_millinear(20);
const MAX_TERMS_LEN: usize = 1024;
const MAX_FIELD_LEN: usize = 256;

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
    pub terms: String,        // raw JSON: { context, repo, pr_number, author, deadline_unix }
    pub arbiter_wasm_url: String,
    pub arbiter_wasm_hash: String,
    pub status: EscrowStatus,
    pub verdict: Option<String>,
    pub evidence_hash: Option<String>,
    pub created_at_block: u64,
    pub deadline_unix: u64,   // seconds; buyer may cancel after this if not resolved
}

#[near(contract_state)]
pub struct ArbiterEscrow {
    pub next_id: u64,
    pub escrows: near_sdk::collections::UnorderedMap<u64, Escrow>,
}

impl Default for ArbiterEscrow {
    fn default() -> Self {
        Self {
            next_id: 0,
            escrows: near_sdk::collections::UnorderedMap::new(b"e"),
        }
    }
}

#[near]
impl ArbiterEscrow {
    /// Create and fund an escrow. Attached deposit = the escrowed amount.
    #[payable]
    pub fn create_escrow(
        &mut self,
        worker: AccountId,
        terms: String,
        arbiter_wasm_url: String,
        arbiter_wasm_hash: String,
    ) -> u64 {
        let deposit = env::attached_deposit();
        assert!(deposit >= MIN_ESCROW, "attach at least 0.01 NEAR");
        assert!(terms.len() <= MAX_TERMS_LEN, "terms too long");
        assert!(arbiter_wasm_url.len() <= MAX_FIELD_LEN && arbiter_wasm_hash.len() <= MAX_FIELD_LEN, "field too long");
        assert!(arbiter_wasm_hash == ALLOWED_WASM_HASH && arbiter_wasm_url == ALLOWED_WASM_URL, "arbiter not allowlisted");

        // terms is stored verbatim; cheap structural sanity checks only.
        let t: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(&terms).expect("terms must be JSON");
        let context = t["context"].as_str().unwrap_or("");
        assert!(context == ALLOWED_CONTEXT, "context not allowlisted (demo build)");
        let deadline_unix = t["deadline_unix"].as_u64().unwrap_or(0);
        assert!(deadline_unix > 0, "terms.deadline_unix required");

        let id = self.next_id;
        self.next_id += 1;
        self.escrows.insert(
            &id,
            &Escrow {
                id,
                buyer: env::predecessor_account_id(),
                worker,
                amount: U128(deposit.as_yoctonear()),
                terms,
                arbiter_wasm_url,
                arbiter_wasm_hash,
                status: EscrowStatus::Created,
                verdict: None,
                evidence_hash: None,
                created_at_block: env::block_height(),
                deadline_unix,
            },
        );
        env::log_str(&format!("arbiter_escrow_created id={}", id));
        id
    }

    /// Resolve an escrow: verify evidence in the TEE and settle. Attach 1 yocto for the outcall.
    #[payable]
    pub fn resolve(&mut self, id: u64, webhook_payload_b64: String, webhook_signature_hex: String) -> Promise {
        let deposit = env::attached_deposit();
        assert!(deposit >= MIN_RESOLVE_FEE && deposit <= MAX_RESOLVE_FEE, "attach 0.005-0.02 NEAR for OutLayer");

        let mut escrow = self.escrows.get(&id).expect("escrow not found");
        assert!(escrow.status == EscrowStatus::Created, "not resolvable");
        escrow.status = EscrowStatus::Resolving;
        self.escrows.insert(&id, &escrow);

        let terms: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(&escrow.terms).expect("stored terms must be JSON");

        let input_data = json!({
            "context": terms["context"],
            "repo": terms["repo"],
            "pr_number": terms["pr_number"],
            "author": terms["author"],
            "deadline_unix": terms["deadline_unix"],
            "payload_b64": webhook_payload_b64,
            "signature_hex": webhook_signature_hex,
        })
        .to_string();

        Promise::new(RESOLVER.parse().unwrap()).function_call(
            "request_execution".to_string(),
            json!({
                "source": {
                    "WasmUrl": {
                        "url": escrow.arbiter_wasm_url,
                        "hash": escrow.arbiter_wasm_hash,
                        "build_target": "wasm32-wasip1",
                    }
                },
                "input_data": input_data,
                "resource_limits": {
                    "max_instructions": 1_000_000_000u64,
                    "max_memory_mb": 64u32,
                    "max_execution_seconds": 30u64,
                },
                "response_format": "Json",
            })
            .to_string()
            .into_bytes(),
            deposit,
            RESOLVE_GAS,
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_arbiter_result(id),
        )
    }

    #[private]
    pub fn on_arbiter_result(&mut self, id: u64) {
        let data_result = env::promise_result_checked(0, 16 * 1024);
        let mut escrow = self.escrows.get(&id).expect("escrow not found");
        match data_result {
            Ok(data) => {
                let v: near_sdk::serde_json::Value =
                    near_sdk::serde_json::from_slice(&data).unwrap_or(json!({ "verdict": "fail", "reason": "bad_verdict_json" }));
                let verdict = v["verdict"].as_str().unwrap_or("fail").to_string();
                let evidence_hash = v["evidence_hash"].as_str().unwrap_or("").to_string();
                escrow.verdict = Some(verdict.clone());
                escrow.evidence_hash = Some(evidence_hash.clone());
                if verdict == "pass" {
                    let amount = NearToken::from_yoctonear(escrow.amount.0);
                    escrow.status = EscrowStatus::Paid;
                    self.escrows.insert(&id, &escrow);
                    env::log_str(&format!("arbiter_attestation id={} worker={} verdict=pass evidence_hash={}", id, escrow.worker, evidence_hash));
                    let _ = Promise::new(escrow.worker).transfer(amount).then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(CALLBACK_GAS)
                            .on_payout(id),
                    );
                } else {
                    // A non-pass verdict (including junk evidence from anyone) never ends the
                    // escrow: it is recorded and the escrow stays open for a valid resolve.
                    escrow.status = EscrowStatus::Created;
                    self.escrows.insert(&id, &escrow);
                    env::log_str(&format!("arbiter_attestation id={} worker={} verdict=fail evidence_hash={}", id, escrow.worker, evidence_hash));
                }
            }
            Err(_) => {
                // Enclave failed: leave escrow open; buyer can cancel after deadline.
                escrow.status = EscrowStatus::Created;
                self.escrows.insert(&id, &escrow);
            }
        }
    }

    #[private]
    pub fn on_payout(&mut self, id: u64) {
        if env::promise_result_checked(0, 0).is_err() {
            if let Some(mut e) = self.escrows.get(&id) {
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
        let escrow = self
            .escrows
            .get(&id)
            .expect("escrow not found");
        assert!(
            env::predecessor_account_id() == escrow.buyer,
            "buyer only"
        );
        assert!(escrow.status != EscrowStatus::Resolving, "resolution in flight");
        let immediate = escrow.status == EscrowStatus::PayoutFailed;
        assert!(immediate || now >= escrow.deadline_unix + REFUND_GRACE_SECS, "deadline + grace not passed");
        assert!(escrow.status != EscrowStatus::Paid, "already paid");
        let amount = NearToken::from_yoctonear(escrow.amount.0);
        self.escrows.remove(&id);
        let _ = Promise::new(escrow.buyer).transfer(amount);
    }

    pub fn get_escrow(&self, id: u64) -> Option<Escrow> {
        self.escrows.get(&id)
    }

    pub fn total_escrows(&self) -> u64 {
        self.next_id
    }
}
