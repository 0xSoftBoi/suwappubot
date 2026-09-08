# Operate a Third-Party Relay Oracle - Relay

Source: https://docs.relay.link/references/protocol/guides/third-party-oracle

On this page
Overview
What the Relay Oracle is
How the oracle fits into the protocol
What the oracle service actually does
Supported chains and data sources
Signing model
Peer oracles and quorum
Security and trust model
Infrastructure requirements
Configuration model
Chain RPC and additional service variables
Core RPC variables
Supplemental non-RPC variables
Practical guidance
Authentication and rate limiting
Peering with other oracle operators
Recommended deployment sequence
Running the oracle service
First-run verification checklist
Operational monitoring
Guides
Operate a Third-Party Relay Oracle
Copy page

How to deploy and run a Relay Oracle outside Relay’s internal infrastructure

​
Overview
The Relay Oracle attests to the onchain facts that drive Relay Protocol settlement. This guide covers how it fits into the protocol and how to deploy and operate an external oracle outside Relay’s internal infrastructure.
​
What the Relay Oracle is
Relay Oracle is the oracle service that attests to onchain facts used by the Relay Protocol settlement flow.
It is:
An operationally stateless oracle service.
A Dockerized oracle service that exposes an HTTP API.
A signer that produces authenticated messages and execution signatures.
A verifier that reads chain state from RPC endpoints and chain-specific APIs.
Its job is to inspect chain state, determine whether a specific protocol-relevant event happened, and sign the corresponding result for downstream settlement flows.
​
How the oracle fits into the protocol
At a high level, the Relay Protocol needs reliable confirmation that key lifecycle steps actually happened onchain before downstream settlement actions are accepted.
The oracle is responsible for attesting these core actions:
Deposits into depository contracts.
Withdrawals from depository contracts.
Solver fills.
Solver refunds.
Withdrawal-address flows used during withdrawal handling.
When a client asks the oracle to attest an event:
The oracle fetches the relevant chain configuration.
It reads chain state from the configured RPC endpoint or chain-specific service.
It builds a protocol message that describes what happened.
It signs the message with its configured signer.
For endpoints that produce execution payloads, it may also collect signatures from peer oracles.
The caller can then use those signatures in the wider settlement flow.
The oracle service can be run as a single instance or as multiple cooperating instances.
​
What the oracle service actually does
The oracle service exposes HTTP endpoints for:
Health checks.
Chain discovery.
Attestation requests.
Swagger-based API documentation.
The main utility routes are:
GET /lives/v1
GET /chains/v1
GET /documentation
The attestation routes are:
POST /attestations/depository-deposits/v1
POST /attestations/depository-withdrawals/v1
POST /attestations/solver-fills/v1
POST /attestations/solver-refunds/v1
POST /attestations/withdrawal-initiation/v1
POST /attestations/withdrawal-initiated/v1
The built-in Swagger UI at /documentation is the best reference for exact request and response schemas.
​
Supported chains and data sources
The oracle supports multiple VM families, with chain-specific attestation logic behind a unified API.
The current VM attestor implementation supports:
ethereum-vm
solana-vm
bitcoin-vm
hyperliquid-vm
lighter-vm
tron-vm
Which chains are enabled is controlled by the selected environment config:
configs/chains.<ENVIRONMENT>.json
configs/chains.hub.<ENVIRONMENT>.json
These config files do not hardcode every endpoint. Instead, many values are placeholders that are resolved from environment variables at runtime.
That means your real deployment depends on the quality of the RPC and service endpoints you provide.
​
Signing model
Each running instance uses one configured signer.
The oracle service supports two signing modes:
raw-private-key
aws-kms
The signer is used for:
Message signatures returned by attestation endpoints.
Execution signatures used in settlement flows.
If your instance is meant to participate in active production signing, coordinate signer onboarding with Relay before expecting its signatures to be used downstream.
If you are just getting started, run the instance first in shadow mode: it signs requests and proves operational readiness, but its signatures are not yet relied on for quorum.
​
Peer oracles and quorum
A single oracle can answer requests on its own, and the oracle service also supports peering across multiple oracle instances to collect signatures.
When an incoming request sets requestPeerSignatures=true and PEERS is configured, the oracle starts its local attestation and every configured peer request concurrently.
When ORACLE_SIGNERS is also configured, the oracle service returns early when a response group reaches the configured threshold of unique allowlisted signatures. The local oracle is not privileged on that path, so a quorum can be satisfied entirely by remote peers.
The oracle service combines responses only when their attestation payloads, signing domains, and non-signature array order match. It skips responses that fail the endpoint schema.
During aggregation, the oracle service excludes duplicate signatures, signatures from non-allowlisted signers when ORACLE_SIGNERS is configured, and signers missing from any signature array in a multi-message response.
To enable quorum aggregation, define an allowlist of trusted signer addresses and an early-return signature target:
ORACLE_SIGNERS is a semicolon-separated allowlist of authorized signer addresses.
ORACLE_SIGNERS_THRESHOLD is the target number of unique allowlisted signatures for early return (defaults to 1). It does not prevent the oracle service from returning fewer signatures.
Each instance applies its own ORACLE_SIGNERS list and never sends it to peers, so operators are not required to configure identical lists. A signature counts only at instances that list its signer, and the signer authorized onchain decides which signatures settlement accepts.
ORACLE_SIGNERS_THRESHOLD counts the local oracle’s signature along with peer signatures. A threshold of 1 can be met by the local oracle alone, so a 2-of-3 configuration uses 2.
ORACLE_SIGNERS_THRESHOLD controls early return but does not enforce quorum. During peer aggregation, Relay Oracle can return the strongest valid partial group with a success response when no group reaches the threshold, and logs the matched and required counts. Callers must verify the unique allowlisted signature count before relying on the response, and operators should alert on quorum-shortfall warnings.
For example, a 2-of-3 configuration looks like this:
ORACLE_SIGNERS=0x1111111111111111111111111111111111111111;0x2222222222222222222222222222222222222222;0x3333333333333333333333333333333333333333
ORACLE_SIGNERS_THRESHOLD=2

The oracle service fails at startup when ORACLE_SIGNERS_THRESHOLD is not an integer or is less than 1.
When ORACLE_SIGNERS is configured, the oracle service also fails at startup when:
ORACLE_SIGNERS_THRESHOLD exceeds the number of unique entries in ORACLE_SIGNERS.
Any entry in ORACLE_SIGNERS is not a valid nonzero address.
The local signer address is not included in ORACLE_SIGNERS.
When ORACLE_SIGNERS is omitted, the threshold is ignored for quorum purposes, so a threshold set without an allowlist doesn’t enforce anything. The oracle service logs a startup warning when a threshold is set without the allowlist.
Without the allowlist, the oracle service waits for the local operation and every configured peer, bounded by PEER_REQUEST_TIMEOUT_MS, instead of completing early at a threshold. Only peer responses that match the local unsigned payload are aggregated, and the request fails if the local attestation fails.
With an allowlist, a failed local attestation is logged but does not by itself fail the request. The oracle service can return a full or partial response using only allowlisted peer signatures. If the local attestation fails, the request fails only when no valid allowlisted group is available.
Peer calls are best-effort attempts. If a peer times out, errors, fails response validation, or returns a payload that does not match any signable group, it is skipped and a warning is emitted.
​
Security and trust model
If you operate a third-party oracle, you are expected to treat it as production infrastructure.
Minimum security expectations:
Use a dedicated signing key that is not shared with any other oracle.
Prefer a hardened key-management approach. aws-kms is supported; if you use raw keys, store them in a real secret manager.
Enforce access control at an API gateway or reverse proxy when public access is not intended.
Use HTTPS for any publicly reachable deployment.
Use dedicated peer API keys so peer traffic bypasses the unauthenticated rate limit.
Restrict management access to the host platform and secret storage.
The oracle is stateless, but its signer is security-critical. If the signing key is compromised, the instance should be treated as compromised immediately.
​
Infrastructure requirements
You should run the oracle service on a platform that can run a Docker container and expose it over HTTP.
For most third-party operators, Railway should be treated as the preferred starting point. It is the recommended default when you want the simplest path to running a single external oracle instance.
Typical Docker-hosting options:
Railway
ECS
Kubernetes
Fly.io
A VM running Docker
You need:
A long-running Docker runtime.
Stable outbound access to all configured RPC and chain service endpoints.
Stable inbound access from callers and peer oracles.
Secure secret storage for signing material and API keys.
Because the oracle service is stateless, scaling horizontally is possible. In practice, the biggest operational constraints are uptime, RPC quality, and signer security.
If you already operate production container infrastructure, another platform can be a valid choice. If not, default to Railway.
​
Configuration model
The runtime configuration is mostly environment-variable driven.
For a recommended raw-key mainnet deployment, define:
ENVIRONMENT=mainnets.prod
ECDSA_PRIVATE_KEY=0x...
API_KEYS=your-api-key:your-name

SIGNING_MODULE=raw-private-key is optional because raw-key signing is the default code path, but setting it explicitly is clearer for operators.
You can also set:
HTTP_PORT=3000
UNAUTHENTICATED_RATE_LIMIT_MAX=2
UNAUTHENTICATED_RATE_LIMIT_WINDOW_MS=1000
PEERS=https://peer-one.example.com|peer-api-key;https://peer-two.example.com|peer-api-key
PEER_REQUEST_TIMEOUT_MS=10000
ORACLE_SIGNERS=0x1111111111111111111111111111111111111111;0x2222222222222222222222222222222222222222;0x3333333333333333333333333333333333333333
ORACLE_SIGNERS_THRESHOLD=2

Notes:
HTTP_PORT is optional if your platform injects PORT. The server resolves ports in this order: HTTP_PORT, then PORT, then 3000.
API_KEYS defines keys that bypass the unauthenticated rate limit and authorize the force option on solver fill and refund attestations.
UNAUTHENTICATED_RATE_LIMIT_MAX and UNAUTHENTICATED_RATE_LIMIT_WINDOW_MS default to 2 requests per 1000 ms.
PEER_REQUEST_TIMEOUT_MS defaults to 10000.
ORACLE_SIGNERS is the semicolon-separated allowlist used to count unique oracle signatures during quorum aggregation.
ORACLE_SIGNERS_THRESHOLD sets the target number of unique allowlisted signatures for early return. It defaults to 1, must be an integer of at least 1, and is validated against the size of ORACLE_SIGNERS when that allowlist is configured. It does not prevent a successful response with fewer signatures.
If you use AWS KMS instead of a raw key:
SIGNING_MODULE=aws-kms
AWS_KMS_SIGNER_KEY_ID=...
AWS_KMS_SIGNER_KEY_REGION=...

​
Chain RPC and additional service variables
The chain config files reference environment variables dynamically. Your deployment is only as reliable as the endpoints and credentials you provide there.
There are two categories to think about:
Standard RPC URLs for the chains the oracle reads.
Supplemental service variables for chains that need more than a plain RPC endpoint.
​
Core RPC variables
For a mainnet deployment, the most important RPC variables to populate first are:
ETHEREUM_RPC_URL=
BASE_RPC_URL=
ARBITRUM_RPC_URL=
BNB_RPC_URL=
POLYGON_RPC_URL=
SOLANA_RPC_URL=
BITCOIN_RPC_URL=
HYPERLIQUID_RPC_URL=

Why these matter:
The oracle validates chain state in real time, so weak or rate-limited RPCs directly reduce reliability.
If a configured chain does not have a working RPC endpoint, any attestation that depends on that chain will fail.
You may also need additional chain RPC variables beyond the list above, depending on which chains remain enabled in your selected ENVIRONMENT. The chain config files are the source of truth for the full required set.
​
Supplemental non-RPC variables
Some chains and integrations need service-specific URLs or credentials in addition to a raw RPC endpoint. Common examples are:
HYPERLIQUID_HUB_API_URL=
HYPERLIQUID_HUB_API_KEY=
HYPERLIQUID_PROXY_API_URL=
HYPERLIQUID_PROXY_API_KEY=
BITCOIN_ESPLORA_COMPATIBLE_API_URL=
BITCOIN_BLOCKSTREAM_CLIENT_ID=
BITCOIN_BLOCKSTREAM_CLIENT_SECRET=
BITCOIN_MAESTRO_API_KEY=
LIGHTER_RPC_API_KEY=

Why these matter:
Some ecosystems expose critical settlement-related data more reliably through companion APIs than through a single generic RPC method.
Some providers require API credentials even when the underlying access pattern still looks like a chain read.
These variables improve reliability and coverage for chain-specific reads without changing the public API of the oracle itself.
You do not need to expose internal provider choices publicly. You only need to ensure the variables required by your chosen providers are present, valid, and managed like any other production secret.
​
Practical guidance
Public RPC endpoints may work for lower-volume or non-critical traffic, but are typically less predictable.
Hyperliquid and Bitcoin commonly need supplemental services, not just a single RPC URL.
When adding or removing supported chains, recheck the required environment variables before deploying.
​
Authentication and rate limiting
Requests without a valid x-api-key remain publicly accessible but are rate limited. Valid API keys bypass this limit.
The oracle service applies one fixed-window limit per client IP across all routes except:
/
/documentation and its subpaths
/lives/*
The default limit is 2 requests per 1000 ms for each oracle process. Requests over the limit receive a 429 response with rate-limit and retry-after headers.
API_KEYS does not enforce access control for /chains/v1 or the attestation endpoints. If these routes must not be public, enforce authentication at an API gateway, reverse proxy, or firewall.
The force option on solver fill and refund attestations is an exception and requires a valid API key.
API_KEYS uses this format:
API_KEYS=key-one:partner-a;key-two:partner-b

The right-hand label is stored as metadata for that key.
​
Peering with other oracle operators
Use PEERS to define other oracle instances this oracle should call when peer signatures are requested.
Format:
PEERS=https://peer-a.example.com|peer-a-key;https://peer-b.example.com|peer-b-key

Each entry is:
A base URL.
A per-peer API key, separated by |.
pass-through is also supported as a peer credential, which forwards the incoming x-api-key instead of a dedicated peer key. That is generally better suited to tightly controlled internal environments. For separate organizations, use dedicated peer keys.
If Relay-managed oracles need to call your instance, the usual pattern is:
You expose a stable public HTTPS URL.
You create a dedicated incoming API key so peer traffic bypasses the unauthenticated rate limit.
Relay adds your URL and that key to the PEERS list used by its oracle instances.
​
Recommended deployment sequence
The safest way to bring up a new third-party oracle is:
Create a new signer dedicated to this oracle.
Provision RPC and chain-service endpoints.
Deploy the container on Railway first unless you already have an established alternative platform.
Verify health and chain loading.
Configure API keys for trusted callers, and add edge access controls if unauthenticated public access is not intended.
Expose the oracle service over HTTPS.
Configure peering and receive live requests in shadow mode.
Run long enough to observe stability, latency, and RPC usage.
Only then consider onboarding the signer for active participation.
This order lets you validate the infrastructure and chain dependencies before your signer becomes operationally important.
​
Running the oracle service
Build and run the oracle service as a Docker container:
docker build -t relay-protocol-oracle .
docker run --rm -p 3000:3000 --env-file .env relay-protocol-oracle

The container entrypoint also loads secrets from /vault/secrets when present, which is useful for secret-injection systems.
If your platform builds from source automatically, the important requirement is still the same: the oracle service should be deployed and run as the repository’s Docker image, with the required environment variables injected at runtime.
​
First-run verification checklist
After deployment, verify:
GET /lives/v1 returns {"status":"ok"}.
GET /chains/v1 returns the chains expected for your selected ENVIRONMENT. A valid x-api-key bypasses the unauthenticated rate limit.
GET /documentation loads the Swagger UI.
Your logs show the oracle service started successfully.
Your logs show the signer address you expect, and that address matches one of the entries in ORACLE_SIGNERS if the allowlist is configured.
Then test at least one real attestation flow. Use a valid x-api-key to bypass the unauthenticated rate limit.
​
Operational monitoring
At minimum, monitor:
Container restarts.
Request latency.
Error rate by endpoint.
Unauthenticated 429 responses.
Peer timeout and peer mismatch warnings.
RPC provider failures and rate limits.
Memory and CPU consumption.
Signer address correctness after deploys.
A healthy process can still be operationally unusable if its RPC dependencies are degraded, so RPC observability matters as much as container health.

Was this page helpful?

Yes
No
Withdrawals
Addresses
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform