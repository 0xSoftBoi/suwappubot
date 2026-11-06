/**
 * Arbiter page data: single source for the UI, JSON-LD and /arbiter.json.
 * Production design v2.1 (docs/arbiter-production.md). Verdicts below are the
 * real live testnet outputs; the enclave fetched each PR from the GitHub API.
 * Do not hand-edit hashes.
 */

export const CONTRACT = 'arb2.suwappu-arbiter.testnet';
export const ARBITER_WASM_HASH = 'f1818167768f6b2b84b2031071760395d3e4a88cf319de3539d0d2068ad6412b';
export const REPO_URL = 'https://github.com/0xSoftBoi/suwappubot';
export const DOC_URL = `${REPO_URL}/blob/main/docs/arbiter-production.md`;
export const NEARBLOCKS_TX = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
export const NEARBLOCKS_ACCOUNT = `https://testnet.nearblocks.io/address/${CONTRACT}`;
export const SPEC_ID = 'suwappu.arbiter/v1';

export type ScenarioKey = 'pass' | 'fail-self-merged';

export interface Scenario {
  key: ScenarioKey;
  title: string;
  blurb: string;
  tone: 'pass' | 'fail';
  input: {
    context: string;
    repo: string;
    pr_number: number;
    author: string;
  };
  output: { verdict: 'pass' | 'fail'; reason: string; evidence_hash: string };
  /** What the enclave found in the GitHub API response, in one line. */
  evidenceNote: string;
  payout: string;
  /** Short label for the tab. */
  tab: string;
  /** Large typographic result. */
  result: 'Paid' | 'Held';
  summary: string;
  /** The five rules, in the order the arbiter evaluates them, with what it found. */
  checks: { rule: string; found: string; ok: boolean }[];
  resolveTx: string;
  settlement: string;
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'pass',
    title: 'Merged by someone else',
    blurb: 'PR #993 by nanofaxcopy was merged by another account. The rubric holds.',
    tone: 'pass',
    evidenceNote: 'merged: true, author nanofaxcopy, merged by a different account',
    payout: 'Released to worker (minus storage deposit)',
    tab: 'PR #993',
    result: 'Paid',
    summary: 'PR #993 by nanofaxcopy passed every check. 0.1 NEAR went to the worker, less the storage deposit.',
    checks: [
      { rule: 'Repository matches the terms', found: '0xSoftBoi/suwappubot', ok: true },
      { rule: 'Pull request is merged', found: 'merged: true', ok: true },
      { rule: 'Author is the named worker', found: 'nanofaxcopy', ok: true },
      { rule: 'Merged before the deadline', found: '2026-10-04 10:01 UTC', ok: true },
      { rule: 'Merged by someone else', found: 'merged by 0xSoftBoi', ok: true },
    ],
    resolveTx: 'Ez3bwp3ZLrFVxeak53WaBgasqXFbf8jeyEBZDPv3vq3b',
    settlement: 'Worker paid',
    input: { context: 'github_pr_v1', repo: '0xSoftBoi/suwappubot', pr_number: 993, author: 'nanofaxcopy' },
    output: {
      verdict: 'pass',
      reason: 'merged_as_required',
      evidence_hash: '72f9abbd262913d08f251fa51ab53bedbb1f024c9cf1a53d3cba2b24a4f8760e',
    },
  },
  {
    key: 'fail-self-merged',
    title: 'Self-merged',
    blurb: 'PR #1096 was authored and merged by the same account. Not independent delivery.',
    tone: 'fail',
    evidenceNote: 'merged: true, author 0xSoftBoi, merged by 0xSoftBoi (merger must differ from author)',
    payout: 'No transfer, escrow stays open',
    tab: 'PR #1096',
    result: 'Held',
    summary: 'PR #1096 failed one check. Nothing moved, and the escrow stays open.',
    checks: [
      { rule: 'Repository matches the terms', found: '0xSoftBoi/suwappubot', ok: true },
      { rule: 'Pull request is merged', found: 'merged: true', ok: true },
      { rule: 'Author is the named worker', found: '0xSoftBoi', ok: true },
      { rule: 'Merged before the deadline', found: '2026-11-05 23:38 UTC', ok: true },
      { rule: 'Merged by someone else', found: 'author and merger are both 0xSoftBoi', ok: false },
    ],
    resolveTx: 'G1oidSEPmAKVBQVP1FSHzpLEi4Bi7KcJ6LT5tNv7jDLr',
    settlement: 'No transfer',
    input: { context: 'github_pr_v1', repo: '0xSoftBoi/suwappubot', pr_number: 1096, author: '0xSoftBoi' },
    output: {
      verdict: 'fail',
      reason: 'self_merged',
      evidence_hash: '54d01ef6c76fd4da378ed47a8833f6f54b3e6cc61622fa65aed1b900f3e92b55',
    },
  },
];

export interface LiveTx {
  hash: string;
  step: string;
  detail: string;
  case: 'pass' | 'fail';
  kind: 'create' | 'resolve';
}

export const LIVE_TXS: LiveTx[] = [
  { case: 'pass', kind: 'create', hash: 'DtNk28WFznwZVXXQrLReeD8hC3czaAti1Wzm2vXF5img', step: 'Create escrow for PR #993 (0.1 NEAR)', detail: 'Buyer locks funds; arbiter hash and rubric are contract constants.' },
  { case: 'pass', kind: 'resolve', hash: 'Ez3bwp3ZLrFVxeak53WaBgasqXFbf8jeyEBZDPv3vq3b', step: 'Resolve PR #993: paid', detail: 'Worker paid. arbiter_attestation logged.' },
  { case: 'fail', kind: 'create', hash: 'D7Wgn7AUCTDsyDcmJ19gXEtXh7XrGwum7cZvqHbWXe3H', step: 'Create escrow for PR #1096 (0.05 NEAR)', detail: 'Second escrow, different PR.' },
  { case: 'fail', kind: 'resolve', hash: 'G1oidSEPmAKVBQVP1FSHzpLEi4Bi7KcJ6LT5tNv7jDLr', step: 'Resolve PR #1096: held (self-merged)', detail: 'No transfer. Escrow stays open.' },
];

/** Machine-readable evidence, served at /arbiter.json and mirrored on the page. */
export function evidenceDocument() {
  return {
    name: 'Suwappu Arbiter: Proof of Done',
    page: 'https://suwappu.bot/arbiter',
    spec: SPEC_ID,
    spec_doc: 'docs/arbiter-attestation-v1.md (suwappubot repository)',
    status: {
      network: 'NEAR testnet',
      mainnet: false,
      real_funds: false,
      design: 'v2.1: enclave fetches the PR from the GitHub API itself; no shared secret, neither party supplies evidence',
      rubric: 'github_pr_v1',
      verifies: 'deterministic, machine-checkable rubrics (GitHub pull-request merged as specified)',
      proves: 'delivered as specified, not that the work was good',
      audited_by_third_party: false,
      internal_reviews: 'two internal adversarial reviews; findings fixed and re-verified live on testnet',
      limits: [
        'testnet only; mainnet not deployed',
        'no independent third-party audit',
        "GitHub's API response is trusted by the enclave over TLS, not independently proven",
        'the contract does not verify TDX quotes on-chain; trust anchor is the OutLayer contract, third parties verify off-chain with OutLayer tooling',
        'the buyer chooses the repo',
        'unauthenticated GitHub rate limits can block a pass; buyer refund after deadline + 1h',
      ],
      roadmap_not_shipped: [
        'NEAR mainnet',
        'independent third-party audit',
        'in-contract TDX quote verification',
        'NEAR Intents funding',
        'Agent Market integration',
        'LLM-judged rubrics',
      ],
      doc: DOC_URL,
    },
    contract: {
      account: CONTRACT,
      network: 'testnet',
      explorer: NEARBLOCKS_ACCOUNT,
    },
    arbiter_wasm: {
      sha256: ARBITER_WASM_HASH,
      runtime: 'NEAR OutLayer (Intel TDX); hash and URL pinned as contract constants',
      source_path: 'near/arbiter-github',
      artifact: `${REPO_URL}/tree/main/near/arbiter-github/artifacts/arbiter-github.wasm`,
    },
    live_transactions: LIVE_TXS.map((t) => ({
      case: t.case,
      kind: t.kind,
      step: t.step,
      tx_hash: t.hash,
      url: NEARBLOCKS_TX(t.hash),
    })),
    recorded_verdicts: SCENARIOS.map((s) => ({
      scenario: s.key,
      verdict: s.output.verdict,
      reason: s.output.reason,
      evidence_hash: s.output.evidence_hash,
    })),
    verify: [
      'sha256sum near/arbiter-github/artifacts/arbiter-github.wasm   # must equal wasm_hash from the arbiter view below',
      `near view ${CONTRACT} get_escrow '{"id":0}' --networkId testnet`,
      `near view ${CONTRACT} arbiter '{}' --networkId testnet`,
      `near tx ${LIVE_TXS[1].hash} --networkId testnet   # logs arbiter_attestation`,
    ],
    anchor_log_format:
      'arbiter_attestation id=<escrow_id> worker=<account> verdict=<pass|fail> evidence_hash=<hex>',
  };
}

/** The exact log line the contract wrote into the PR #993 settlement transaction. */
export const ATTESTATION_LOG =
  'arbiter_attestation id=0 worker=worker.suwappu-arbiter.testnet verdict=pass ' +
  'evidence_hash=72f9abbd262913d08f251fa51ab53bedbb1f024c9cf1a53d3cba2b24a4f8760e ' +
  'arbiter=f1818167768f6b2b84b2031071760395d3e4a88cf319de3539d0d2068ad6412b';
