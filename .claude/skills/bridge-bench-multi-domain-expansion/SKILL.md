---
name: bridge-bench-multi-domain-expansion
description: |
  Extend the BRIDGE-bench benchmark framework to new protocol domains (DEX, lending, 
  governance). Use when: (1) adding vulnerability analysis for a new protocol type, 
  (2) building separate dataset with same schema as bridges, (3) establishing 
  cross-domain TYPE_EQUIVALENCES. Pattern covers taxonomy creation, Sonnet SYSTEM_PROMPT 
  extension, and contract fetching integration. Tested on bridge→DEX/Lending transition.
author: Claude Code
version: 1.0.0
date: 2026-04-07
---

# BRIDGE-bench Multi-Domain Expansion Pattern

## Problem

The BRIDGE-bench benchmark was designed for bridge protocols only. Extending to new 
domains (DEX/AMM, lending, governance) requires creating parallel datasets and vulnerability 
taxonomies while maintaining unified evaluation infrastructure.

Without a pattern, each domain expansion involves ad-hoc decisions about schema, vulnerability 
types, and evaluation mappings, leading to inconsistency and wasted effort.

## Context / Trigger Conditions

- Building vulnerability dataset for a new protocol domain (DEX, lending, governance, yield, etc.)
- Need to use existing benchmark_runner.py infrastructure with new vulnerability types
- Required to support cross-domain fuzzy matching via TYPE_EQUIVALENCES
- Want to extend Claude's analytical capability to new vulnerability categories
- Planning multi-phase expansion (Phase 5B → 5C → 6+)

## Solution

### Step 1: Create Domain-Specific Dataset File

Create `benchmarks/{domain}_contracts_real.py` following the bridge template:

```python
"""
{Domain} Protocol Vulnerability Dataset (Phase 5X Expansion)

Uses the same schema as bridge_contracts_real.py for unified benchmarking.
"""

# 1. Define domain-specific vulnerability taxonomy (not bridge types)
{DOMAIN}_VULNERABILITY_TAXONOMY = {
    "vulnerability_type_1": {
        "type": "vulnerability_type_1",
        "severity": "critical",
        "description": "...",
    },
    # ... more types
}

# 2. Define how domain types map to bridge types for cross-domain fuzzy matching
TYPE_EQUIVALENCES_{DOMAIN} = {
    "domain_type_1": ["bridge_type_1", "bridge_type_2"],
    # Enables finding matches across domains
}

# 3. Load contracts with same schema as bridges
def load_{domain}_contracts() -> list:
    # Return list of {name, source, ground_truth, metadata}
    # ground_truth.vulnerabilities must use the domain taxonomy
```

**Key invariant**: Output schema matches bridge_contracts_real.py exactly:
```python
{
    "name": str,
    "source": str | None,
    "ground_truth": {
        "vulnerabilities": [
            {"type": str, "severity": str, "description": str}
        ],
        "overall_risk": str,
    },
    "metadata": {...}
}
```

### Step 2: Extend TYPE_EQUIVALENCES in benchmark_runner.py

Add the domain's vulnerability types to the global TYPE_EQUIVALENCES dict:

```python
TYPE_EQUIVALENCES = {
    # Existing types...
    # Phase 5B: DEX/AMM/Lending types
    "oracle_price_manipulation": ["flash_loan_price_manipulation", "spot_price_dependency"],
    "tick_boundary_exploit": ["precision_loss_rounding", "integer_boundary_exploit"],
    # ... more DEX types
}
```

**Why**: Enables `fuzzy_match()` to find correspondences across domains:
- DEX `oracle_price_manipulation` matches Bridge `spot_price_dependency`
- Lending `donation_attack_bad_debt` matches Bridge `zero_value_deposit`
- Cross-domain evaluation uses same matching logic

### Step 3: Extend Claude's SYSTEM_PROMPT

Update `agents/claude_analyzer.py` SYSTEM_PROMPT to add domain-specific vulnerability categories:

**Pattern**:
```python
SYSTEM_PROMPT = """You are an expert smart contract security auditor...

BRIDGE VULNERABILITIES:
1. [existing 18 types]

{DOMAIN_NAME.upper()} VULNERABILITIES:
19. Type A: description
20. Type B: description
...

For each vulnerability found, provide:
- Type (examples: ..., domain_specific_type_1, domain_specific_type_2, ...)
...
"""
```

**Examples**:
- DEX: "Oracle price manipulation", "Tick boundary exploits", "Flash loan collateral inflation"
- Lending: "Donation attacks", "Liquidation manipulation", "Interest rate oracle abuse"
- Governance: "Flash loan voting", "Proposal injection", "Timelock bypass"

### Step 4: Add Contract Addresses to fetch_contracts.py

Append domain contracts to CONTRACTS_TO_FETCH list with same structure:

```python
CONTRACTS_TO_FETCH = [
    # ... existing bridge contracts ...
    
    # Phase 5X: {DOMAIN} EXPLOITS
    {
        "name": "contract_name",
        "address": "0x...",
        "chain": "ethereum" | "bsc" | "avalanche",
        "exploit_date": "YYYY-MM-DD",
        "loss_usd": int,
        "vuln_class": "type_from_domain_taxonomy",
        "fork_block": int,
        "description": "...",
        "verified": bool,
    },
]
```

Etherscan v2 API already handles all chains via `chainid` parameter (1=Ethereum, 56=BSC, 43114=Avalanche).

### Step 5: Create Benchmark Runner Function (Optional)

If domain warrants separate benchmarking, add to benchmark_runner.py:

```python
def run_{domain}_benchmark(dataset=None, dataset_name="{Domain}"):
    """Run agentic analysis on {domain} contracts."""
    from benchmarks.{domain}_contracts_real import load_{domain}_contracts
    
    if dataset is None:
        dataset = load_{domain}_contracts()
    
    # Convert to benchmark format and evaluate
    # Use same evaluate_findings() logic
```

Then wire into `__main__` with argparse flag: `--{domain}`

## Verification

1. **Dataset loads without error**:
   ```bash
   python3 benchmarks/{domain}_contracts_real.py
   # Should print: "Total contracts: X, Loaded: Y"
   ```

2. **TYPE_EQUIVALENCES are registered**:
   ```python
   from agents.benchmark_runner import TYPE_EQUIVALENCES, fuzzy_match
   assert "domain_type_1" in TYPE_EQUIVALENCES
   assert fuzzy_match("domain_type_1", "bridge_type_1")  # Cross-domain match
   ```

3. **Sonnet receives extended SYSTEM_PROMPT**:
   ```bash
   # Verify SYSTEM_PROMPT includes domain category (line count increased)
   wc -l agents/claude_analyzer.py  # Should be ~120+ lines
   ```

4. **Contracts can be fetched**:
   ```bash
   export ETHERSCAN_API_KEY=...
   python3 benchmarks/fetch_contracts.py --all
   # Check: benchmarks/contracts/{domain}_*.sol files created
   ```

## Example

**Phase 5B (DEX/Lending)** implementation:

1. Created `benchmarks/defi_contracts_real.py` with:
   - 5 DEX/Lending exploits (Euler, Curve, Kyberswap, Platypus, DODO)
   - 12 new vulnerability types (oracle_price_manipulation, tick_boundary_exploit, etc.)
   - TYPE_EQUIVALENCES mapping DEX types to bridge types

2. Extended `agents/claude_analyzer.py` SYSTEM_PROMPT:
   - Added "DEX/AMM VULNERABILITIES" section (8 types)
   - Added "LENDING PROTOCOL VULNERABILITIES" section (5 types)
   - Updated examples in prompt to include domain-specific types

3. Updated `agents/benchmark_runner.py`:
   - Added 12 DEX TYPE_EQUIVALENCES entries
   - Enabled fuzzy matching across domains (e.g., DEX `oracle_price_manipulation` ↔ Bridge `spot_price_dependency`)

4. Extended `benchmarks/fetch_contracts.py`:
   - Added 5 DEX contract addresses (Euler 0x27..., Curve, Kyberswap, Platypus, DODO)
   - Existing chainid logic supports all chains (Ethereum, BSC, Avalanche)

**Cost to implement**: 3 files, ~400 lines of code, 2-3 commits, reusable for Phase 5C+ expansions

## Notes

- **Schema consistency**: All domains must return ground_truth with same structure (list of {type, severity, description})
- **SYSTEM_PROMPT bloat**: Keep domain sections focused (5-10 types each). If >20 types, split into separate prompt variants
- **Cross-domain matching**: TYPE_EQUIVALENCES should reflect real semantic overlap (not arbitrary grouping)
- **Contract availability**: Some exploits may not have verified Etherscan source. Document as `verified: False` and note fallback source (GitHub, Sourcify, etc.)
- **Avalanche/BSC support**: Etherscan v2 API with chainid works for these chains. No separate fetcher needed.

## Reuse Checklist

When adding a new domain (Phase 5C, 6+):

- [ ] Create `benchmarks/{domain}_contracts_real.py` with taxonomy and load function
- [ ] Add TYPE_EQUIVALENCES for new types (and mappings to existing bridge types)
- [ ] Extend SYSTEM_PROMPT with domain-specific vulnerability categories (10-20 lines)
- [ ] Add contract addresses to CONTRACTS_TO_FETCH (5-10 contracts per domain)
- [ ] Test dataset loads and TYPE_EQUIVALENCES match works
- [ ] Run Sonnet on 1-2 contracts as smoke test before full benchmark run

## References

- BRIDGE-bench Phase 5A: Ground truth expansion pattern (bridge_contracts_real.py)
- BRIDGE-bench Phase 5B: DEX/Lending dataset (defi_contracts_real.py)
- Etherscan v2 API: [Multichain support via chainid](https://docs.etherscan.io/v2-apis/getting-started)
- TYPE_EQUIVALENCES: Fuzzy vulnerability matching logic (agents/benchmark_runner.py, lines 70-75)
