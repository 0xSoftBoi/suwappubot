/** Generated from arbiter-wasm fixtures (see near/arbiter-wasm/fixtures). Do not edit by hand. */
export interface ArbiterFixture {
  context: string
  repo: string
  pr_number: number
  author: string
  deadline_unix: number
  payload_b64: string
  signature_hex: string
}
export interface ArbiterFixtureOutput {
  verdict: 'pass' | 'fail'
  reason: string
  evidence_hash: string
}
export const ARBITER_FIXTURES: Record<'pass' | 'fail-author' | 'fail-unmerged', { input: ArbiterFixture; output: ArbiterFixtureOutput }> = {
  "pass": {
    "input": {
      "context": "github_pr",
      "repo": "arbiter-demo/shop",
      "pr_number": 7,
      "author": "octocat",
      "deadline_unix": 1795996800,
      "payload_b64": "eyJhY3Rpb24iOiJjbG9zZWQiLCJwdWxsX3JlcXVlc3QiOnsibnVtYmVyIjo3LCJtZXJnZWQiOnRydWUsIm1lcmdlZF9hdCI6IjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsInVzZXIiOnsibG9naW4iOiJvY3RvY2F0In0sIm1lcmdlZF9ieSI6eyJsb2dpbiI6Imh1Ym90In0sImhlYWQiOnsicmVmIjoiZmVhdHVyZS9taWxlc3RvbmUifX0sInJlcG9zaXRvcnkiOnsiZnVsbF9uYW1lIjoiYXJiaXRlci1kZW1vL3Nob3AiLCJodG1sX3VybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9hcmJpdGVyLWRlbW8vc2hvcCJ9LCJzZW5kZXIiOnsibG9naW4iOiJodWJvdCJ9fQ==",
      "signature_hex": "f413f89c83760860c48d1ebfa1af2be54661b0e07707378c4241e3cfa97fc37f"
    },
    "output": {
      "verdict": "pass",
      "reason": "merged_as_required",
      "evidence_hash": "415f1d325da78e0df60e2cf2b3a0bb6edca06df74ddac994ee1741732ccd7ae5"
    }
  },
  "fail-author": {
    "input": {
      "context": "github_pr",
      "repo": "arbiter-demo/shop",
      "pr_number": 7,
      "author": "octocat",
      "deadline_unix": 1795996800,
      "payload_b64": "eyJhY3Rpb24iOiJjbG9zZWQiLCJwdWxsX3JlcXVlc3QiOnsibnVtYmVyIjo3LCJtZXJnZWQiOnRydWUsIm1lcmdlZF9hdCI6IjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsInVzZXIiOnsibG9naW4iOiJtYWxsb3J5In0sIm1lcmdlZF9ieSI6eyJsb2dpbiI6Imh1Ym90In0sImhlYWQiOnsicmVmIjoiZmVhdHVyZS9taWxlc3RvbmUifX0sInJlcG9zaXRvcnkiOnsiZnVsbF9uYW1lIjoiYXJiaXRlci1kZW1vL3Nob3AiLCJodG1sX3VybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9hcmJpdGVyLWRlbW8vc2hvcCJ9LCJzZW5kZXIiOnsibG9naW4iOiJodWJvdCJ9fQ==",
      "signature_hex": "1b89bf4eeaf046bc22e3ce107ee2a2cccd0115795bf331fce366b059a7867396"
    },
    "output": {
      "verdict": "fail",
      "reason": "author_mismatch",
      "evidence_hash": "0bd6a474799647ab89822f209ea9a0896309b97f75ab334d97a4229c29704ae0"
    }
  },
  "fail-unmerged": {
    "input": {
      "context": "github_pr",
      "repo": "arbiter-demo/shop",
      "pr_number": 7,
      "author": "octocat",
      "deadline_unix": 1795996800,
      "payload_b64": "eyJhY3Rpb24iOiJjbG9zZWQiLCJwdWxsX3JlcXVlc3QiOnsibnVtYmVyIjo3LCJtZXJnZWQiOmZhbHNlLCJtZXJnZWRfYXQiOm51bGwsInVzZXIiOnsibG9naW4iOiJvY3RvY2F0In0sIm1lcmdlZF9ieSI6eyJsb2dpbiI6Imh1Ym90In0sImhlYWQiOnsicmVmIjoiZmVhdHVyZS9taWxlc3RvbmUifX0sInJlcG9zaXRvcnkiOnsiZnVsbF9uYW1lIjoiYXJiaXRlci1kZW1vL3Nob3AiLCJodG1sX3VybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9hcmJpdGVyLWRlbW8vc2hvcCJ9LCJzZW5kZXIiOnsibG9naW4iOiJodWJvdCJ9fQ==",
      "signature_hex": "2c43dfb88a9b49a1f859c78f9b811b555df433f55c0d4aca18ceb90de47a801a"
    },
    "output": {
      "verdict": "fail",
      "reason": "not_merged",
      "evidence_hash": "cd11b47af5b39dee2f195bbb36dc66e33f4d2a77de0335f75c4dff42ff930e83"
    }
  }
}
