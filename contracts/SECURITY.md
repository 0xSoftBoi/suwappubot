# Suwappu Contracts — Security Tooling

The contracts went through three manual audit passes (9 critical/high bugs found and
fixed) plus the automated toolchain below. **None of this replaces a professional
human audit before mainnet.**

## Tools run

| Tool | Type | Result |
|------|------|--------|
| **Foundry** | Unit / invariant tests | 34/34 pass (`test/AuditInvariantsTest.t.sol`) |
| **Slither** 0.11.4 | Static analysis (100 detectors) | No new vulns; reentrancy flags are `nonReentrant`-mitigated CEI nits (bond() reordered to CEI) |
| **Aderyn** 0.6.8 | Static analysis (88 detectors) | Same CEI finding (fixed) + expected centralization (owner = multisig) |
| **Mythril** 0.24.8 | Symbolic execution | SUWP, SuwppuStaking, SuwppuBonds — **no issues detected** |
| **Medusa** 1.5.1 | Coverage-guided fuzzing | Harness written (`fuzz/MedusaHarness.sol`); blocked by a Slither-subprocess env bug on Python 3.9/LibreSSL — see note |

## How to run

```bash
cd contracts
export PATH="$HOME/.local/bin:.venv/bin:$PATH"   # aderyn + slither/mythril (venv)
export PYTHONWARNINGS=ignore                       # suppress LibreSSL warning

# Foundry
forge test --match-path test/AuditInvariantsTest.t.sol -vv

# Slither (filter library noise)
slither . --filter-paths "lib/,test/"

# Aderyn
aderyn .

# Mythril (per contract; Bonds needs viaIR config)
myth analyze SUWP.sol          --solc-json /tmp/myth.json  --solv 0.8.27
myth analyze SuwppuStaking.sol --solc-json /tmp/myth.json  --solv 0.8.27
myth analyze SuwppuBonds.sol   --solc-json /tmp/myth2.json --solv 0.8.27  # viaIR+optimizer

# Medusa (fuzzing) — currently blocked on this env; harness in fuzz/MedusaHarness.sol
# checks the solvency invariant: suwp.balanceOf(staking) >= totalStaked + totalPendingBonuses
medusa fuzz --config medusa.json
```

mythril solc-json files:
- `/tmp/myth.json`:  `{"remappings": ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"]}`
- `/tmp/myth2.json`: same + `"optimizer": {"enabled": true, "runs": 200}, "viaIR": true`

## Medusa env note

Medusa 1.5.1 resolves target contracts via an internal Slither sub-process. On this
macOS Python 3.9 + LibreSSL setup, that Slither call returns empty/corrupt JSON
("unexpected end of JSON input"), so Medusa can't locate the harness. The harness
compiles cleanly and Medusa's test chain initialises in auto-discover mode — the
blocker is purely the Slither integration on this Python/SSL build. To run Medusa,
use a Python 3.11+ environment with OpenSSL (e.g. Linux CI), where the Slither
sub-process works. The invariant to fuzz is solvency (see harness).

## Findings summary (manual + automated)

All real bugs were caught by the manual passes; the automated tools surfaced no
*new* vulnerabilities, only confirming the fixes and flagging CEI/centralization
patterns. Full bug history in `DEPLOYMENTS.md` commit log.

**Before mainnet:** external audit, multisig ownership transfer, and run Medusa/
Echidna in a clean CI environment.
