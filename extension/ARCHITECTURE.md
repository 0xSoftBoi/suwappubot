# Suwappu Wallet Extension — Architecture & Build Contract

MV3 wallet-grade browser extension. Injects `window.ethereum` (EIP-1193 +
EIP-6963) and `window.solana` (Wallet Standard) into every page, relays RPC
through a content-script bridge to an ephemeral service worker that holds a
PRF-derived AES-GCM vault.

## Message flow (read `src/shared/protocol.ts` — it is law)

```
dApp page (MAIN world)
  window.ethereum / window.solana          src/inpage/*
     │  window.postMessage  InpageToContent / ContentToInpage  (tagged WALLET_NAMESPACE)
content bridge (ISOLATED world)            src/content/bridge.ts
     │  chrome.runtime port (PORT_NAME)    PortMessage
service worker router                      src/background/*
     │  chrome.runtime.sendMessage         PopupRequest / PopupResponse
popup UI (TRUSTED context)                 src/popup/*
```

## Hard rules (every agent obeys)

1. **Import the contract, never redefine it.** All cross-layer types come from
   `@/shared/protocol`. Errors come from `@/shared/rpc-errors` (use `RpcError`
   + helpers, never raw `{code,message}`). Constants from `@/shared/constants`.
2. **MV3 service worker is ephemeral** (~30s idle death). Hold NO module-level
   mutable secret state. The unlocked key lives in `chrome.storage.session`
   (TRUSTED_CONTEXTS); the encrypted vault in `chrome.storage.local`. Re-read
   from storage on every handler invocation.
3. **No secret ever crosses to the page.** The inpage/content layers see only
   RPC requests/results — never private keys, mnemonics, or PRF output.
4. **PRF output is client-side only.** It never goes to the background as
   anything but the input to derive the vault key; never persisted, never sent
   to a server.
5. **Read-only EVM methods** (`PUBLIC_EVM_METHODS`) are answered via a viem
   public client without unlocking. **Approval methods**
   (`APPROVAL_EVM_METHODS`) enqueue an `ApprovalRequest` and open the popup.
6. TypeScript strict. `bun run check` must pass. Match terminal/ code style.
7. Each agent edits ONLY its assigned files. Do not touch `src/shared/*`,
   config files, or another module's files.

## Module map (assignment = one agent per group)

| Group | Files | Exports / responsibility |
|-------|-------|--------------------------|
| **A: EVM inpage provider** | `src/inpage/provider.ts`, `src/inpage/eip6963.ts` | `EthereumProvider` class (EIP-1193: `request`, `on`, `removeListener`, `isConnected`, legacy `enable`/`send`/`sendAsync`, `isMetaMask:false`, `isSuwappu:true`). Generates `RpcRequest.id` (crypto.randomUUID), posts `InpageToContent`, resolves on matching `ContentToInpage.payload`, emits provider events from `ContentToInpage.event`. `eip6963.ts` announces via `eip6963:announceProvider` using `PROVIDER_INFO`. |
| **B: Solana inpage provider** | `src/inpage/solana.ts` | Phantom-compatible `window.solana` + Wallet Standard `registerWallet`. `connect`/`disconnect`/`signTransaction`/`signAllTransactions`/`signMessage`/`signAndSendTransaction`. Same postMessage transport but `chain:"solana"`. Use `@solana/web3.js` + `bs58`. |
| **C: inpage entry** | `src/inpage/index.ts` | Instantiate EthereumProvider, set `window.ethereum`, call EIP-6963 announce, register Solana provider. Listen for `eip6963:requestProvider`. This is the web-accessible MAIN-world script. |
| **D: content bridge** | `src/content/bridge.ts` | Inject `src/inpage/index.ts` into MAIN world via `<script src=chrome.runtime.getURL(...)>`. Relay: page `InpageToContent` → port `PortMessage{kind:"rpc"}`; port `rpc-result` → page `ContentToInpage{payload}`; port `event` → page `ContentToInpage{event}`. Validate `namespace` + `target`. Reconnect port on disconnect. |
| **E: background router + entry** | `src/background/index.ts`, `src/background/router.ts` | SW entry: `chrome.storage.session.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})`, `onConnect` (PORT_NAME) → route `PortMessage`, `onMessage` → handle `PopupRequest`. `router.ts`: dispatch by chain + method into rpc/* handlers; classify via `PUBLIC_EVM_METHODS`/`APPROVAL_EVM_METHODS`; wrap errors with `serializeError`. |
| **F: EVM read RPC** | `src/background/rpc/eth.ts` | viem `createPublicClient(http())` per chain id (chain registry inline: Base 8453, Ethereum 1, Arbitrum 42161, Optimism 10, Polygon 137, BSC 56). `handlePublicEvm(method, params, chainId)`. `eth_chainId`/`net_version` answered from selected chain. |
| **G: EVM accounts + signing** | `src/background/rpc/accounts.ts`, `src/background/rpc/signing.ts` | `accounts.ts`: `eth_accounts` (empty unless origin approved), `eth_requestAccounts` (enqueue connect approval). `signing.ts`: `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` — each enqueues an approval, and on approval uses `keyring/signer` to sign and (for tx) broadcasts via viem wallet client. |
| **H: keyring (crypto)** | `src/background/keyring/vault.ts`, `webauthn-prf.ts`, `signer.ts` | `vault.ts`: AES-GCM seal/open of `{mnemonic}` using a key derived from PRF output (HKDF-SHA256 via `@noble/hashes`); types `EncryptedVault`,`VaultMeta`. `webauthn-prf.ts`: helpers to shape PRF bytes → CryptoKey (the actual `navigator.credentials.get` happens in the popup; this derives the key). `signer.ts`: from mnemonic build viem account (`mnemonicToAccount`) + a Solana keypair; expose `signMessageEvm`, `signTypedDataEvm`, `signTxEvm`, `signSolana`. |
| **I: storage** | `src/background/storage/local.ts`, `src/background/storage/session.ts` | Typed wrappers over `chrome.storage.local`/`.session` keyed by `STORAGE_LOCAL`/`STORAGE_SESSION`. `getVault/setVault`, `getMeta/setMeta`, `getApprovedOrigins/approveOrigin`, `get/setUnlockedKey` (key as base64), `getSelected*`. |
| **J: approval queue** | `src/background/approval/queue.ts` | In-SW-restart-safe queue persisted to `chrome.storage.session`. `enqueue(req):Promise<resolved>` returns a promise resolved when the popup calls `resolveApproval`; `list()`, `resolve(id,approved,result)`, badge count via `chrome.action.setBadgeText`, open popup via `chrome.action.openPopup` (fallback `chrome.windows.create`). |
| **K: popup app shell** | `src/popup/main.tsx`, `src/popup/App.tsx`, `src/popup/index.css`, `src/popup/lib/bg.ts` | React 18 root. `bg.ts`: typed `sendToBackground(req:PopupRequest):Promise<PopupResponse>`. App routes between pages by `WalletState` (no vault → Onboarding; locked → Unlock; pending approvals → Approval; else → Accounts). Tailwind dark theme. |
| **L: popup pages** | `src/popup/pages/Onboarding.tsx`, `Unlock.tsx`, `Accounts.tsx`, `Approval.tsx`, `Settings.tsx`, `src/popup/lib/webauthn.ts` | `webauthn.ts`: `createPasskey()` + `getPrfOutput()` (calls `navigator.credentials.create/get` with the PRF extension + `PRF_SALT`, returns `number[]`). Pages call `sendToBackground`. Onboarding: create/import → passkey → createVault. Unlock: passkey get → unlock. Approval: render pending request, approve/reject. |

## Tech

- viem ^2.45 (EVM), @solana/web3.js ^1.98 + bs58 (Solana)
- @noble/hashes (HKDF/SHA256), @noble/ciphers or WebCrypto AES-GCM
- React 18, Tailwind 3, @crxjs/vite-plugin v2
- Path alias `@/*` → `src/*`

## Status & known gaps (post-build, Opus-reviewed)

**Verified working:** typecheck (`bun run check`) and production build (`bun run build`)
both clean. Money-path crypto verified against known vectors (`getAddresses` matches
the Anvil mnemonic's published EVM address, `personal_sign(hex)` recovers to signer,
Solana ed25519 sign/verify round-trips, AES-GCM vault seals/opens and rejects wrong
keys). Five critical money-path bugs from the initial generation were fixed:
fake Solana derivation, broken Solana signing, placeholder mnemonic generation,
`personal_sign` signing hex-as-UTF-8, and EVM tx double-serialization.

**Not yet functional (need work + real-browser e2e — do NOT call these done):**
1. **Solana routing** — `src/background/router.ts` stubs all Solana methods
   (`connect`/`signMessage`/`signTransaction`/`signAndSendTransaction`). The inpage
   provider and `keyring/signer.ts` Solana functions are real and tested, but the
   router→approval→signer wiring for Solana is unimplemented.
2. **dApp-initiated `wallet_switchEthereumChain`** updates stored chain + rejects
   unsupported ids, but does not broadcast `chainChanged` to connected pages (the
   popup-driven switch in `index.ts` does). Needs the router to signal index.ts.
3. **MV3 approval survival** — `approval/queue.ts` `waitFor()` resolvers live in SW
   memory; if the service worker dies (~30s idle) between enqueue and user response,
   the dApp request rejects and must be retried. Robust fix = re-dispatch on resume.
4. **WebAuthn PRF in extension origin** — runs against `chrome-extension://<id>`, so
   a passkey here is distinct from a suwappu.bot webapp passkey. Unifying needs ROR
   or an offscreen ceremony (the open risk flagged in research).
5. **Brand polish** — `PROVIDER_INFO.icon` is a placeholder data-URI; popup pages are
   functional but unstyled to brand. No real-browser load-unpacked test has been run.

## Out of scope for this build (server-side, tracked separately)

Python passkey verification (`api/main.py` stubs), `passkey_credentials` +
`UserBackupEscrow` tables, `/api/backup-blob` route. See the
`suwappu-wallet-extension-research` memory.
