# @elytro/sdk

## 1.2.2

### Patch Changes

- 8fb5088: Eliminated the logic that manually increased verificationGasLimit when using semi-valid hook input data in ElytroWallet. The estimation now relies solely on the result from eth_estimateUserOperationGas, which supports stateOverride for more accurate simulation.

## 1.2.1

### Patch Changes

- d8aec84: Replaces GuardHookInputData with HookInputDataItem for hook input data, updates method signatures and documentation to require sorted hook input data arrays, and removes unused gasOverhead.ts. Gas estimation now adjusts verificationGasLimit based on hook input data and key type. Improves clarity and consistency in hook signature packing and usage.

## 1.2.0

### Minor Changes

- f425389: Added ABI_SecurityHook ABI file. Refactored ElytroWallet to use hookList instead of guardHookList, updating related logic and variable names. Improved address and input data normalization in signature.ts and fixed padding length for guardHookInputDataBytes. Updated submodule Elytro-wallet-contract.

### Patch Changes

- Updated dependencies [f425389]
  - @elytro/abi@1.1.0

## 1.1.0

### Minor Changes

- 492f4fc: Added calcWalletAddressGeneric and createUnsignedDeployWalletUserOpGeneric methods to ElytroWallet and IElytroWallet for chain-agnostic wallet address calculation and deployment. Updated WalletFactory to support chainId as optional for salt calculation and wallet address generation. Deprecated older methods in favor of new generic versions.

## 1.0.1

### Patch Changes

- 12198df: Update elytro npm package
- Updated dependencies [12198df]
  - @elytro/result@1.0.1
  - @elytro/abi@1.0.1

## 1.0.0

### Major Changes

- 4536d89: Rebrand soulwallet to Elytro.

### Patch Changes

- Updated dependencies [4536d89]
  - @elytro/result@1.0.0
  - @elytro/abi@1.0.0
