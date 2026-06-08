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
| **Foundry invariant** | Native coverage-guided fuzzing | `invariant_solvency` held across ~25,600 random sequences (`test/StakingInvariant.t.sol`) |
| **Medusa** 1.5.1 | Coverage-guided fuzzing | `property_solvency` PASSED — 51,090+ calls @ 17k/sec, 0 failures (clean-room, see note) |

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

## Fuzzing

Two independent fuzzers exercise the **solvency invariant** — the contract must
always hold `>= totalStaked + totalPendingBonuses` of SUWP, so every staker can be
made whole even after the owner tries to drain via `recoverToken`:

- **Foundry native** (`forge test --match-path test/StakingInvariant.t.sol`): the
  built-in invariant fuzzer calls the harness's `fuzz_*` functions in ~25,600 random
  sequences. Held, 0 violations.
- **Medusa** (`scripts/run_medusa.sh`): 51,090+ calls @ ~17k/sec, `property_solvency`
  PASSED, 0 failures.

### Medusa clean-room note
Medusa's crytic-compile compiles the *entire* foundry project, and chokes on
forge-std's `LibVariable` ("unable to parse ABI"). `scripts/run_medusa.sh` works
around this by fuzzing in a temp clean-room project containing only `MedusaHarness`
+ `SuwppuStaking` + OpenZeppelin (no forge-std). Slither is disabled in the config
(`useSlither: false`) to avoid a Python 3.9/LibreSSL JSON issue. Run it with:
`bash scripts/run_medusa.sh`.

## Findings summary (manual + automated)

All real bugs were caught by the manual passes; the automated tools surfaced no
*new* vulnerabilities, only confirming the fixes and flagging CEI/centralization
patterns. Full bug history in `DEPLOYMENTS.md` commit log.

**Before mainnet:** external audit, multisig ownership transfer, and run Medusa/
Echidna in a clean CI environment.
