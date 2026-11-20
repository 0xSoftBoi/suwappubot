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

/** Contract v3: a second testnet contract that pins one arbiter per rubric. Not the contract above. */
export const CONTRACT_V3 = 'suwappu-arb3.testnet';
export const NEARBLOCKS_ACCOUNT_V3 = `https://testnet.nearblocks.io/address/${CONTRACT_V3}`;
export const V3_CODE_SHA256 = '667f4c62a77bdb59442d74daf75d2bb6c093c8bb1fcf893e4bba6562cff9ba8a';
export const HTTP_ARBITER_WASM_HASH = '2acc016a94a45d01ef31734a0e1dcca8592048f06013eb74a99a82461b8260a7';
export const V3_DEPLOY_TX = 'a5Hiy5NthGUaU16QaS18xsv4YNy58vQbioY8aCNBXsR';
/** Pinned to the commit that holds the v3 evidence (the copy on main predates it). Update when the doc is next revised. */
export const V3_DOC_URL = `${REPO_URL}/blob/edb13e28284a3360142357bad7b10a2643aa51aa/docs/arbiter-production.md`;

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

export interface V3Tx {
  hash: string;
  rubric: 'github_pr_v1' | 'http_json_v1';
  /** What happened, in plain words. */
  step: string;
}

/** Every hash below was read back from chain state (EXPERIMENTAL_tx_status) before being listed. */
export const V3_TXS: V3Tx[] = [
  { rubric: 'github_pr_v1', hash: 'E3TmuRYaLP8iYvhuTKdjFZs8uFDry9vpH1DnGbdXid7g', step: 'Original rubric on the new contract: PR #993 paid' },
  { rubric: 'http_json_v1', hash: '91Nhb6bEnoytMzrQGm59tzLj76f1q28JYXUxyhHVRt7r', step: 'New rubric, condition false: an account below 3.1 NEAR, held' },
  { rubric: 'http_json_v1', hash: 'EjPF1DRNbnBc3xGJE2wJhLB2jSEYJVSVPeikgmRNSLbE', step: 'Same escrow after the account was topped up: paid' },
  { rubric: 'http_json_v1', hash: 'ASfp9kYvNgsZRznMbcrDth9BB1MSHrmSKGXmWxYuPAG9', step: 'Largest allowed input (1,694 bytes) ran in the enclave' },
  { rubric: 'http_json_v1', hash: 'Fjs7aDnGFfKwPQLJqMx5trUXnzUk1vpRrRJPNVKTifbT', step: 'A redirect is reported as a failure, not followed' },
];

/** What the v3 contract does not do or has not shown. Single source for the page and /arbiter.json. */
export const V3_LIMITS: string[] = [
  'Testnet only; no real funds; no independent audit (one internal money-path review)',
  'The fix for a late-callback double-payment bug (present in the contract above) was tested in a local harness, not on testnet',
  'A condition that is already true when the escrow is created can be paid out immediately',
  'The account that signs the resolve call has about 0.3 NEAR less balance while it runs, so a condition on that account\'s balance misfires and its owner can manipulate it',
  'Whoever controls the endpoint being checked controls the verdict',
  'OutLayer reported one redirect instead of following it; its DNS and private-network filtering has not been checked',
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
    contract_v3: {
      status: 'deployed on NEAR testnet on 2026-11-05; a separate contract from the one above; not audited',
      account: CONTRACT_V3,
      network: 'testnet',
      explorer: NEARBLOCKS_ACCOUNT_V3,
      code_sha256: V3_CODE_SHA256,
      deploy_tx: V3_DEPLOY_TX,
      rubrics: [
        { name: 'github_pr_v1', arbiter_sha256: ARBITER_WASM_HASH, verifies: 'a GitHub pull request merged as specified' },
        {
          name: 'http_json_v1',
          arbiter_sha256: HTTP_ARBITER_WASM_HASH,
          source_path: 'near/arbiter-http',
          verifies:
            'the enclave fetches an HTTPS endpoint and checks up to four conditions on the JSON it returns (exists, equals, at least, at most, contains), or a body hash',
        },
      ],
      adversarial_calls: '37 invalid calls were rejected on testnet and no state changed (see the design doc)',
      limits: V3_LIMITS,
      live_transactions: V3_TXS.map((t) => ({ rubric: t.rubric, step: t.step, tx_hash: t.hash, url: NEARBLOCKS_TX(t.hash) })),
      doc: V3_DOC_URL,
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
