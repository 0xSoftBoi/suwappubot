# Vendored: Elytro-eth (https://github.com/Elytro-eth)

Full snapshot of all 18 active (non-archived) repositories in the Elytro-eth
GitHub organization, vendored 2026-06-12 for parity work. Git history was
stripped; each directory is the working tree of the commit listed below.

Elytro (formerly Soul Wallet) is an ERC-4337 smart-account wallet stack:
audited Solidity wallet contracts, a TypeScript wallet SDK, a browser-extension
wallet, an agent-facing multi-chain CLI (2FA email OTP, spending limits,
x402 payments), a bundler, and zk-email social recovery.

Three archived repos were intentionally skipped as superseded legacy:
`soulwalletlib`, `soul-wallet-packages`, `soul-wallet-plugin`.

## Provenance

| Directory | Upstream repo | Commit | License |
|---|---|---|---|
| `cli/` | Elytro-eth/cli | `27aa1400ab39c607a9b04319485dcb580ce02902` | none published |
| `skills/` | Elytro-eth/skills | `373356b4477c6c784848b7eabd1e2a22e53f411c` | MIT |
| `elytro-wrapper/` | Elytro-eth/elytro-wrapper | `5ae5a508100359d90eb12c62bab6be3899265c9f` | GPL-3.0 |
| `cli-x402-registry/` | Elytro-eth/cli-x402-registry | `4162c9db5cd33b5d5ac6725db6749b60ac468932` | MIT |
| `Elytro/` | Elytro-eth/Elytro (browser-extension wallet) | `3ac7582f1198810b84f313896baa710241c2b7d2` | GPL-3.0 |
| `Elytro-wallet-contract/` | Elytro-eth/Elytro-wallet-contract | `e5e9c107c789549b515e3e49ab88bf76b18a9277` | GPL-3.0 |
| `elytro-wallet-lib/` | Elytro-eth/elytro-wallet-lib | `1f7290727c652b9412b0b345b6f94a4c2cf2381a` | GPL-3.0 |
| `elytro-wallet-core/` | Elytro-eth/elytro-wallet-core | `68ae7ff6a21143325bcf3f73217b6e95b4ae9deb` | GPL-3.0 |
| `soul-wallet-web/` | Elytro-eth/soul-wallet-web | `832c6eb03a2300b607559f9665bedabe94645424` | none published |
| `soul-wallet-contract/` | Elytro-eth/soul-wallet-contract | `fc7cc084563ad1bda870df841b77caa9ee3a3661` | none published |
| `email-approver/` | Elytro-eth/email-approver | `2625ea04289b01565c5cd7ef2d6a136ee0b8cbbe` | MIT |
| `bundler/` | Elytro-eth/bundler | `6153b10f1e55f622ad146fc9be52d157d0e08dcd` | GPL-3.0 |
| `incremental-merkle-tree-lib/` | Elytro-eth/incremental-merkle-tree-lib | `39f3d5e35c2a17c024b73013e98236177e24c2a0` | none published |
| `account-abstraction/` | Elytro-eth/account-abstraction | `5b7b9715fa0c3743108982cf8826e6262fef6d68` | GPL-3.0 |
| `smart-contract-wallet-4337/` | Elytro-eth/smart-contract-wallet-4337 | `ce7421af4b1591dffb268c94daee7c055f8090e5` | GPL-3.0 |
| `social-recovery-helper-serivce/` | Elytro-eth/social-recovery-helper-serivce | `d43fad4004c535fec947b81d318d83b70b50742c` | GPL-3.0 |
| `ETHShanghai2022/` | Elytro-eth/ETHShanghai2022 | `93ce43faebbaeeffb2fe89108841767eb4095f5b` | MIT |
| `org-github-readme/` | Elytro-eth/.github (renamed to avoid GitHub config collision) | `006db036859702fb33ac935caa774673a436ad3b` | none published |

## ⚠️ Licensing

Most of the core stack (wallet contracts, wallet lib, extension, bundler) is
**GPL-3.0**. Linking or distributing Suwappu code that incorporates these
components triggers GPL-3.0 copyleft obligations (source disclosure under
GPL-3.0). Repos marked "none published" carry no license grant at all —
default copyright applies and they should not be redistributed or built upon
without permission from Elytro. Keep this in mind before shipping anything
derived from this directory. The MIT pieces (`skills`, `cli-x402-registry`,
`email-approver`, `ETHShanghai2022`) are unrestricted.

## Build notes

- Solidity repos (`elytro-wallet-core`, `Elytro-wallet-contract`,
  `soul-wallet-contract`, etc.) use Foundry with git-submodule deps under
  `lib/`. Submodules were not vendored — run `forge install` inside the
  directory to fetch them.
- TypeScript repos need their own `npm install`/`bun install`; none are wired
  into the Suwappu workspace builds, lint, or CI on purpose.

## Parity map (Elytro capability → Suwappu equivalent)

| Elytro capability | Where it lives here | Suwappu today | Gap to parity |
|---|---|---|---|
| ERC-4337 smart accounts (modular, upgradable) | `elytro-wallet-core`, `Elytro-wallet-contract` | EOA hot wallets (`bot/services/wallet*`) | No smart-account support; would need 4337 account deployment + UserOperation signing |
| Wallet SDK (account creation, userop building) | `elytro-wallet-lib` | viem/web3 direct signing | Integrate a 4337 SDK in swap engines |
| Agent-facing CLI (multi-chain, 2FA email OTP, spending limits) | `cli`, `elytro-wrapper`, `skills` | Telegram/WhatsApp bot + `api-ts` agent routes (A2A) | Suwappu has no CLI surface; spending limits / 2FA OTP not implemented |
| x402 machine payments registry | `cli-x402-registry` | none | x402 support absent |
| Bundler (UserOperation relay) | `bundler` | n/a (EOA txs) | Only needed if smart accounts adopted; public bundlers also an option |
| zk-email social recovery | `email-approver`, `incremental-merkle-tree-lib`, `social-recovery-helper-serivce` | KMS envelope encryption, no recovery | No social-recovery path for user wallets |
| Browser-extension wallet UI | `Elytro` | Telegram Mini App (`webapp/`) + Expo app (`mobile/`) | Different surface; not a direct gap |
