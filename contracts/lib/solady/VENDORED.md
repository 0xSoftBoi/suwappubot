# Vendored: solady

Single file vendored (not the full repo) — no other Solady file is used or needed.

- Source: https://github.com/Vectorized/solady
- File: `src/utils/LibClone.sol`
- Pinned commit: `cbcfe0009477aa329574f17e8db0a05703bb8bdd`
- License: MIT (see file header)

Used for `LibClone`'s "clone with immutable args" functions
(`createDeterministicClone`, `predictDeterministicAddress`, `argsOnClone`) —
the EIP-1167 minimal-proxy variant that appends constructor-style arguments
to each clone's own bytecode, read back via `extcodecopy` from the logic
contract. Chosen over hand-rolling this in
`contracts/hypercore/SuwappuCoreRouterBoundUserFactory.sol` because the
bytecode assembly is dense, offset-sensitive, and this file is one of the most
widely deployed/audited implementations of the pattern (Solady is used
throughout Uniswap v4 periphery, Base, and elsewhere). Do not hand-edit this
file — update the pinned commit and re-vendor instead.
