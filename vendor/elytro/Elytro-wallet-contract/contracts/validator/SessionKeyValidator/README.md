# SessionKeyValidator

The `SessionKeyValidator` is a modular validation component for smart contract accounts. It introduces **Session Keys**: temporary, limited-permission cryptographic keys that allow dApps to sign transactions on a user's behalf.

By delegating specific permissions to a session key, users can interact with dApps without needing to manually sign every transaction, significantly improving the user experience (UX) for high-frequency use cases.

## Why Session Keys?

Standard blockchain interactions require a wallet pop-up and manual signature for every operation. This creates friction in high-frequency environments.

**Session Keys solve this by:**

* **Removing Interruption:** Enabling a "sign once, execute many" flow.
* **Scoped Security:** Creating ephemeral keys with strict boundaries (time limits, contract whitelists).
* **Non-Custodial:** The user retains the master key and can revoke sessions at any time.

This architecture is ideal for on-chain gaming, automated trading bots, and social apps requiring seamless interaction.

## How It Works: The Lifecycle

The validator operates on a specific lifecycle to ensure security and validity:

1. **Key Generation:** The user's client generates an ephemeral ECDSA key pair (the Session Key) and defines a ruleset (expiration, target contracts, allowed functions).
2. **Commitment (On-Chain):** The user signs a master transaction calling `setSessionKey`. Instead of storing all rules on-chain, only a **Merkle Root** representing the rules is stored.
3. **Execution:** The dApp uses the Session Key to sign transactions. The transaction data includes the signature and a **Merkle Proof** verifying that the specific operation is part of the approved ruleset.
4. **Validation:** During `validateUserOp`, the contract verifies:
    * The Session Key signature.
    * The Merkle Proof against the stored root.
    * Validity of the session (not expired, not revoked).

## Technical Implementation: Merkle Tree Permissions

To maintain gas efficiency while offering granular control, `SessionKeyValidator` utilizes Merkle Trees.

### Gas Efficiency (O(1) Storage)

Storing complex rulesets on-chain is prohibitively expensive. By hashing rules into a Merkle Tree and storing only the **Root (bytes32)**, users can define thousands of permission rules while consuming only a single slot of contract storage.

### Whitelist Logic

The validator follows a strict **whitelist model**. By default, a session key has zero permissions. Leaves in the Merkle tree represent specific allow-listed actions:

| Permission Type    | Description                                                  |
| :----------------- | :----------------------------------------------------------- |
| **Contract Allow** | Grants access to *any* function on a specific target contract. |
| **Method Allow**   | Grants access *only* to a specific function selector on a target contract. |
| **EIP-1271 Allow** | Allows the key to sign messages for specific host contracts. |

### Merkle Leaf Structure

The leaves are constructed using the following encoding schemes:

```solidity
// Type 0x01: Approve full access to a target contract
bytes32 leaf = keccak256(abi.encodePacked(uint8(0x01), address(targetContract)));

// Type 0x02: Approve a specific function selector on a target
bytes32 leaf = keccak256(abi.encodePacked(uint8(0x02), address(targetContract), bytes4(selector)));

// Type 0x04: Approve a target for EIP-1271 signature validation
bytes32 leaf = keccak256(abi.encodePacked(uint8(0x04), address(validatorContract)));
```

## Design Rationale & Limitations

### Spending Limits

Currently, `SessionKeyValidator` does **not** natively support token spending limits (e.g., "Max 100 USDC").

**Reasoning:**

1. **Storage Costs:** Tracking cumulative spend requires state updates for every transaction, negating the gas benefits of the stateless Merkle approach.
2. **ERC-7562 Compliance:** Account Abstraction standards recommend against validators accessing mutable storage slots outside the wallet's associated storage to prevent DOS vectors.
3. **Complexity:** Implementing robust multi-token limits often requires oracle dependencies for fiat-conversion, introducing centralization risks.

### Development Status
>
> ⚠️ **Note:** This implementation is currently a Proof of Concept (PoC). It is not yet feature-complete or audited for production use.

## Use Case Example: Secure GameFi

**Scenario:** A user wants to play a fully on-chain game without confirming every move, but wants to ensure the game contract cannot drain their main ERC20 savings.

**Solution:**

1. The user generates a Session Key.
2. The user creates a whitelist containing **only** the Game Contract address and the specific `move()` or `attack()` function selectors.
3. **CRITICAL:** The user **excludes** the `transfer` or `approve` selectors of their ERC20 tokens from the whitelist.

**Result:** The game client can sign move transactions freely. However, if the game client (or a compromised key) attempts to call an ERC20 transfer, the `SessionKeyValidator` will reject the transaction immediately because the Merkle proof for that action cannot be generated.
