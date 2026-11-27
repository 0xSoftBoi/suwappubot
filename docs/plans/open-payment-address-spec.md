# Open payment address standard (suwappu-pay/1)

A handle-addressed, signed JSON document that lets any institution advertise where and how it can be paid. Implemented in `api-ts/src/services/bank/BankPaymentNetworkService.ts`.

## Address and resolution
`handle@domain` resolves to `GET https://<domain>/.well-known/suwappu-pay/<handle>` (HTTPS only, no redirects followed, response max 200 KB, fetched through the SSRF guard). Suwappu serves the bare document at `/{webapp|v1/agent}/bank/network/.well-known/suwappu-pay/:handle`; mount it at the domain root to publish publicly.

## Document
```json
{
  "version": "suwappu-pay/1",
  "handle": "alice",
  "institution": { "name": "Example Bank", "domain": "example.com" },
  "rails": [{ "type": "onchain", "chain": "base", "chainId": 8453, "asset": "USDC",
              "tokenAddress": "0x833589fC...", "address": "0x...", "decimals": 6 }],
  "compliance": { "kycLevel": "none|basic|full", "travelRuleSupported": true,
                  "sanctionsScreened": true, "jurisdictions": ["US","MX"] },
  "issuedAt": "2026-11-27T00:00:00Z", "expiresAt": "2026-12-27T00:00:00Z",
  "signature": { "scheme": "eip191", "signer": "0x...", "value": "0x<65 bytes>" }
}
```
Amounts are never in the document; all amounts elsewhere are integer minor units.

## Signing
Signature is EIP-191 `personal_sign` over the canonical JSON: the document without `signature`, object keys sorted recursively, no whitespace. A verifier MUST: check `version`, check `expiresAt`, recover the signer from `value`, require it to equal `signature.signer`, and match `handle`/`institution.domain` to the requested address. `signerBoundToRail` reports whether the signer is one of the advertised rail addresses (a stronger binding; absence is a policy decision for the verifier). JWS (ES256K) is reserved for a later version.

## Rail selection
The resolver intersects the document's rails with the payer's chains and asset (token address must match the payer's registry), then ranks common chains with the M12 fee model (lowest estimated fee, then fastest confirmation) and returns the chosen rail plus all candidates.

## Not in v1
Fiat rails (ACH/SEPA/SPEI) in documents, revocation lists, and DNSSEC/domain-ownership proof beyond HTTPS. Signature proves key possession, not that the domain owner authorised the key.
