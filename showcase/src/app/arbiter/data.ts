/**
 * Arbiter page data — single source for the UI, JSON-LD and /arbiter.json.
 * Fixtures are copied byte-for-byte from webapp/src/data/arbiterFixtures.ts
 * (recorded arbiter-wasm outputs). Do not hand-edit hashes.
 */

export const CONTRACT = 'suwappu-arbiter.testnet';
export const ARBITER_WASM_HASH = '2e4f74d47e770b252dec155e909329e220f5f731ef8b3563d8246f3bc197534e';
export const CONTRACT_CODE_HASH_PREFIX = 'c9559550…f685';
export const NEARBLOCKS_TX = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
export const NEARBLOCKS_ACCOUNT = `https://testnet.nearblocks.io/address/${CONTRACT}`;
export const SPEC_ID = 'suwappu.arbiter/v1';

export type ScenarioKey = 'pass' | 'fail-author' | 'fail-unmerged';

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
    deadline_unix: number;
    payload_b64: string;
    signature_hex: string;
  };
  output: { verdict: 'pass' | 'fail'; reason: string; evidence_hash: string };
  /** What the evidence actually says, in one line (decoded from payload_b64). */
  evidenceNote: string;
  payout: string;
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'pass',
    title: 'Merged PR',
    blurb: 'octocat’s PR #7 is merged. The rubric holds.',
    tone: 'pass',
    evidenceNote: 'merged: true · author octocat · merged_by hubot',
    payout: 'Released to worker',
    input: {
      context: 'github_pr',
      repo: 'arbiter-demo/shop',
      pr_number: 7,
      author: 'octocat',
      deadline_unix: 1795996800,
      payload_b64:
        'eyJhY3Rpb24iOiJjbG9zZWQiLCJwdWxsX3JlcXVlc3QiOnsibnVtYmVyIjo3LCJtZXJnZWQiOnRydWUsIm1lcmdlZF9hdCI6IjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsInVzZXIiOnsibG9naW4iOiJvY3RvY2F0In0sIm1lcmdlZF9ieSI6eyJsb2dpbiI6Imh1Ym90In0sImhlYWQiOnsicmVmIjoiZmVhdHVyZS9taWxlc3RvbmUifX0sInJlcG9zaXRvcnkiOnsiZnVsbF9uYW1lIjoiYXJiaXRlci1kZW1vL3Nob3AiLCJodG1sX3VybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9hcmJpdGVyLWRlbW8vc2hvcCJ9LCJzZW5kZXIiOnsibG9naW4iOiJodWJvdCJ9fQ==',
      signature_hex: 'f413f89c83760860c48d1ebfa1af2be54661b0e07707378c4241e3cfa97fc37f',
    },
    output: {
      verdict: 'pass',
      reason: 'merged_as_required',
      evidence_hash: '415f1d325da78e0df60e2cf2b3a0bb6edca06df74ddac994ee1741732ccd7ae5',
    },
  },
  {
    key: 'fail-author',
    title: 'Wrong author',
    blurb: 'PR #7 was merged, but authored by mallory, not the hired agent.',
    tone: 'fail',
    evidenceNote: 'merged: true · author mallory (rubric requires octocat)',
    payout: 'No transfer · escrow stays open',
    input: {
      context: 'github_pr',
      repo: 'arbiter-demo/shop',
      pr_number: 7,
      author: 'octocat',
      deadline_unix: 1795996800,
      payload_b64:
        'eyJhY3Rpb24iOiJjbG9zZWQiLCJwdWxsX3JlcXVlc3QiOnsibnVtYmVyIjo3LCJtZXJnZWQiOnRydWUsIm1lcmdlZF9hdCI6IjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsInVzZXIiOnsibG9naW4iOiJtYWxsb3J5In0sIm1lcmdlZF9ieSI6eyJsb2dpbiI6Imh1Ym90In0sImhlYWQiOnsicmVmIjoiZmVhdHVyZS9taWxlc3RvbmUifX0sInJlcG9zaXRvcnkiOnsiZnVsbF9uYW1lIjoiYXJiaXRlci1kZW1vL3Nob3AiLCJodG1sX3VybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9hcmJpdGVyLWRlbW8vc2hvcCJ9LCJzZW5kZXIiOnsibG9naW4iOiJodWJvdCJ9fQ==',
      signature_hex: '1b89bf4eeaf046bc22e3ce107ee2a2cccd0115795bf331fce366b059a7867396',
    },
    output: {
      verdict: 'fail',
      reason: 'author_mismatch',
      evidence_hash: '0bd6a474799647ab89822f209ea9a0896309b97f75ab334d97a4229c29704ae0',
    },
  },
  {
    key: 'fail-unmerged',
    title: 'Never merged',
    blurb: 'The PR was closed without merging. Nothing was delivered.',
    tone: 'fail',
    evidenceNote: 'merged: false · merged_at: null',
    payout: 'No transfer · escrow stays open',
    input: {
      context: 'github_pr',
      repo: 'arbiter-demo/shop',
      pr_number: 7,
      author: 'octocat',
      deadline_unix: 1795996800,
      payload_b64:
        'eyJhY3Rpb24iOiJjbG9zZWQiLCJwdWxsX3JlcXVlc3QiOnsibnVtYmVyIjo3LCJtZXJnZWQiOmZhbHNlLCJtZXJnZWRfYXQiOm51bGwsInVzZXIiOnsibG9naW4iOiJvY3RvY2F0In0sIm1lcmdlZF9ieSI6eyJsb2dpbiI6Imh1Ym90In0sImhlYWQiOnsicmVmIjoiZmVhdHVyZS9taWxlc3RvbmUifX0sInJlcG9zaXRvcnkiOnsiZnVsbF9uYW1lIjoiYXJiaXRlci1kZW1vL3Nob3AiLCJodG1sX3VybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9hcmJpdGVyLWRlbW8vc2hvcCJ9LCJzZW5kZXIiOnsibG9naW4iOiJodWJvdCJ9fQ==',
      signature_hex: '2c43dfb88a9b49a1f859c78f9b811b555df433f55c0d4aca18ceb90de47a801a',
    },
    output: {
      verdict: 'fail',
      reason: 'not_merged',
      evidence_hash: 'cd11b47af5b39dee2f195bbb36dc66e33f4d2a77de0335f75c4dff42ff930e83',
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
  { case: 'pass', kind: 'create', hash: '8shZnhjyTZxJSobr6WzyofjbcqBMtiJ5WjtVAcMmgG3H', step: 'create_escrow · id 2 · 0.1 NEAR', detail: 'Buyer locks funds; rubric and arbiter hash pinned on-chain.' },
  { case: 'pass', kind: 'resolve', hash: '12uCPjMREp9Uo4228ZMjPg1LqSSE5JTBRY9w6Prn4SEC', step: 'resolve → OutLayer → pass', detail: 'Worker paid. arbiter_attestation logged.' },
  { case: 'fail', kind: 'create', hash: 'Cap3AaABKEAEG1XaLsJMV4GnpL41KitVinKYVNXLC3Yf', step: 'create_escrow · id 3 · 0.05 NEAR', detail: 'Second escrow, different evidence.' },
  { case: 'fail', kind: 'resolve', hash: '2zBdABZcCorZX8TKcQJGrwYzwiYUpK3Xsw6bBrzMaBfn', step: 'resolve → OutLayer → fail', detail: 'No transfer. Escrow stays open. arbiter_attestation logged.' },
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
      rubric: 'public demo rubric (context github_pr_demo, public demo HMAC secret)',
      verifies: 'deterministic, machine-checkable rubrics (v1: GitHub pull-request merge)',
      proves: 'done as specified, not that the work was good',
      roadmap_not_shipped: [
        'NEAR mainnet',
        'production rubric secrets',
        'TDX quote verification inside the contract',
        'NEAR Intents funding',
        'Agent Market integration',
        'LLM-judged rubrics',
      ],
    },
    contract: {
      account: CONTRACT,
      network: 'testnet',
      explorer: NEARBLOCKS_ACCOUNT,
      code_sha256_prefix: CONTRACT_CODE_HASH_PREFIX,
    },
    arbiter_wasm: {
      sha256: ARBITER_WASM_HASH,
      runtime: 'NEAR OutLayer (Intel TDX), fetched by outlayer.testnet',
      source_path: 'near/arbiter-wasm',
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
      'sha256sum arbiter_wasm.wasm   # must equal arbiter_wasm.sha256',
      `near view ${CONTRACT} get_escrow '{"id": 2}' --networkId testnet`,
      `near tx ${LIVE_TXS[1].hash} --networkId testnet   # logs arbiter_attestation`,
    ],
    anchor_log_format:
      'arbiter_attestation id=<escrow_id> worker=<account> verdict=<pass|fail> evidence_hash=<hex>',
  };
}
