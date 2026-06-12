import { ZeroHash, ethers, randomBytes, sha256 } from "ethers";
import { KeyStoreIncMerkleTree } from "../src";
import { expect, test } from '@jest/globals';

test('test basic', async () => {
    let tree = new KeyStoreIncMerkleTree();

    tree.insertLeaf(0, {
        slot: "0x09dad8b126439e69c798745d802291bd1e23a35e6d5da810d0efba60d9cdff42",
        signingKeyHash: "0xd309aed29ffd38d73d7a5fe15c1b3257e51f42dd78c57370ed3272fb00724ff1",
        blockNumber: 10195484
    });

    expect(tree.getLatestBlockNumber()).toBe(10195484);
    let expectedRootHash = "0x6bf7e1a6c0a59b9c661cbcf19e49117c3812a213fbfbbce8937348175e731709";
    expect(tree.getLatestRootHash()).toBe(expectedRootHash);
    expect(tree.getBlockNumberByRootHash(expectedRootHash)).toBe(10195484);
    const updateIndex = tree.getSlotLatestLeafIndexUnderRoot(
        "0x09dad8b126439e69c798745d802291bd1e23a35e6d5da810d0efba60d9cdff42", expectedRootHash);
    expect(updateIndex).toBe(0);

    const proof = tree.tree.getProof(0, 0);
    expect(tree.tree.isValidProof(0, 0, proof)).toBe(true);
});