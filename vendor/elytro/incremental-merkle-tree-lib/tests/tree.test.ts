import { ZeroHash, ethers, randomBytes, sha256 } from "ethers";
import { IncMerkleTree } from "../src";
import { expect, test } from '@jest/globals';

test('test basic', async () => {
    let tree = new IncMerkleTree(3);
    expect(tree.nodeIndex2Height(4)).toBe(0);

    const oldRoot = tree.getCurrentRootHash();
    tree.insertLeaf(0, ZeroHash);
    expect(tree.getCurrentRootHash()).toBe(oldRoot);
    expect(tree.leafCount()).toBe(1);
});

function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
}

test('test prove small tree', async () => {
    let tree = new IncMerkleTree(8);
    for (let i = 0; i < 2 ** 7; i++) {
        tree.insertLeaf(i, sha256(randomBytes(20)));
        const targetLeafIndex = getRandomInt(i);
        const proveLeafIndex = getRandomInt(targetLeafIndex);
        const proof = tree.getProof(proveLeafIndex, targetLeafIndex);
        // console.info(`prove and verify ${i} ${proveLeafIndex} ${targetLeafIndex}`);
        expect(tree.isValidProof(proveLeafIndex, targetLeafIndex, proof)).toBe(true)
    }
});


test('test prove large tree', async () => {
    let tree = new IncMerkleTree(33);
    for (let i = 0; i < 100000; i++) {
        tree.insertLeaf(i, sha256(randomBytes(20)));
        if (i % 100 == 0) {
            const targetLeafIndex = getRandomInt(i);
            const proveLeafIndex = getRandomInt(targetLeafIndex);
            const proof = tree.getProof(proveLeafIndex, targetLeafIndex);
            console.info(`prove and verify ${i} ${proveLeafIndex} ${targetLeafIndex}`);
            expect(tree.isValidProof(proveLeafIndex, targetLeafIndex, proof)).toBe(true)
        }
    }
});
