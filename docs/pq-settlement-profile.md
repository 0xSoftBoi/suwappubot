# Suwappu post-quantum settlement profile

Status: **experimental / unavailable for routing or execution**.

This document aligns SuwappuBot with the Suwappu Lattice Bridge and Suwappu Chain without
advertising a money-moving capability before the bridge and execution client are ready.

## Shared standards profile

| Layer | Standard/profile | Suwappu choice |
| --- | --- | --- |
| Cross-chain app interface | ERC-7786 + ERC-7930 | Standard gateway/recipient surface and interoperable addresses |
| On-chain PQ verification | draft EIP-8355 | pure FIPS 204 **ML-DSA-65**, compact key/signature, raw domain-separated message |
| Lattice confidentiality | FIPS 203 | ML-KEM-768 stays off-chain in the relay/sealed-key path |
| Related Ethereum work | EIP-8051 / EIP-7932 | track and coordinate; do not hard-code unsettled precompile/algorithm assignments |

The bridge profile lives in
[`0xSoftBoi/Entanglement-Transfer-Protocol`](https://github.com/0xSoftBoi/Entanglement-Transfer-Protocol)
and the OP/Reth devnet/conformance harness lives in
[`0xSoftBoi/op-stack-reth`](https://github.com/0xSoftBoi/op-stack-reth).

EIP-8355 is currently being developed in
[ethereum/EIPs#12048](https://github.com/ethereum/EIPs/pull/12048). The present address mapping is
draft material and must not become a SuwappuBot constant.

## Bot boundary

Post-quantum verification is a **settlement property**, not bot business logic. SuwappuBot should
never reimplement ML-DSA or decide whether a lattice signature is valid. It should consume a
bridge quote/status whose underlying gateway has already defined those guarantees.

The future Python integration seam already exists:

- `bot/services/bridge/base.py` — implement Lattice as a `BridgeProvider`;
- `bot/services/bridge/registry.py` — let the existing registry race it with other eligible
  bridge providers; and
- `bot/config/settings.py` — add a default-off `LATTICE_BRIDGE_ENABLED` gate only when there is
  a real callable adapter.

Once that code gate exists, declare the capability in `capabilities.yaml` and regenerate
`.env.schema` from settings. The manifest must describe reality; it must not be used to announce
this profile ahead of an implementation.

Do **not** add `lattice` to `SwapEngine.EXECUTABLE_PROVIDERS` until a real executor exists.
The current execution guard deliberately rejects quote-only providers before funds can move.

The TypeScript API is not the first integration point. Its current executable EVM quote path has
Li.Fi-specific raw quote/transaction fields; adding Lattice there safely requires a
provider-neutral quote/execution refactor rather than a one-line provider flag.

## Route contract

When activated, a Lattice bridge result exposed to the bot should be provider-neutral:

- route identity and source/destination chains;
- input/output token and amounts;
- fee + estimated delivery time;
- transaction data required for user/managed-wallet execution;
- stable operation/status identifier;
- finality state and terminal failure reason; and
- a machine-readable settlement-security capability, without exposing raw PQ keys/signatures to
  ordinary bot clients.

User-facing copy should describe outcomes ("post-quantum protected settlement", finality,
estimated delivery) rather than requiring users to understand ML-DSA parameters.

## Activation gates

Lattice routing remains unavailable until all of these are true:

1. **Bridge contract:** an ERC-7786-compatible gateway/adapter has a stable callable interface and
   ERC-7930 address handling.
2. **Authorization:** the unsafe caller-supplied signer-hash path is retired or admin-only; public
   relaying is verifier-backed and fail-closed.
3. **Chain:** the execution client actually implements the resolved ML-DSA-65 EIP-8355 semantics.
   A compose/config repository or Solidity adapter alone is not native-precompile support.
4. **Conformance:** valid, tampered, malformed, and absent-precompile cases pass against the
   running devnet using a real FIPS 204 backend. PoC simulation results do not qualify.
5. **Provider:** `BridgeProvider` quote/status behavior and address/route validation have tests
   in `tests/test_bridge_providers.py`.
6. **Execution:** a real Lattice executor exists, is simulated before broadcast, and passes the
   repository's MONEY-PATH adversarial review before being added to executable providers.
7. **End to end:** a testnet transfer is observed from source send through destination finality;
   CI or mocked unit tests alone do not qualify the integration as live.

Until those gates pass, Lattice should not appear in `list_chains`, quote races, MCP tools, A2A
responses, public swap execution, or the optional-capability manifest.

## Upstream posture

Suwappu should piggyback on the existing ML-DSA Core-EIP work rather than publish a competing Core
proposal. The concrete contribution is an ML-DSA-65 cross-chain authorization use case,
fail-closed devnet vectors/probes, and native-client benchmarking once an execution-client fork is
available.

A separate Suwappu-authored ERC is justified later only if an application-layer gap remains—for
example, a standardized ERC-7786 attribute describing verifiable post-quantum settlement
requirements. That ERC should reference the resolved Core primitive rather than redefine ML-DSA.

References:

- https://eips.ethereum.org/EIPS/eip-7786
- https://eips.ethereum.org/EIPS/eip-7930
- https://eips.ethereum.org/EIPS/eip-7932
- https://eips.ethereum.org/EIPS/eip-8051
- https://github.com/ethereum/EIPs/pull/12048
- https://csrc.nist.gov/pubs/fips/204/final
- https://csrc.nist.gov/pubs/fips/203/final
