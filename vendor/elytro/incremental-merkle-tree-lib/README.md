## incremental-merkle-tree-lib

The js library for incremental merkle tree: https://github.com/ethereum/consensus-specs/blob/dev/solidity_deposit_contract/deposit_contract.sol

Install:

```
npm i @soulwallet/incremental-merkle-tree-lib
```

Usage:

```ts
// create new tree
const tree = new IncMerkleTree(32);

// insert leaf
for (let i = 0; i < 100; i ++) {
    tree.insertLeaf(i, sha256(randomBytes(20)), `${i}`);
}

const proveLeafIndex = 20;
const targetLeafIndex = 40;

// generate leaf proof
const proof = tree.getProof(proveLeafIndex, targetLeafIndex);

// verify leaf proof
console.log(tree.isValidProof(proveLeafIndex, targetLeafIndex, proof));
```