import { AbiCoder, keccak256 } from "ethers";
import { IncMerkleTree } from "./IncMerkleTree";

export interface LeafData {
    slot: string;
    signingKeyHash: string;
    blockNumber: number;
}

export class KeyStoreIncMerkleTree {
    tree: IncMerkleTree;
    rootHash2BlockNumber: Map<string, number>;
    slotHistoryNodeIndex: Map<string, number[]>;
    leafData: LeafData[];

    constructor() {
        this.tree = new IncMerkleTree(33);
        this.rootHash2BlockNumber = new Map();
        this.slotHistoryNodeIndex = new Map();
        this.leafData = [];
    }

    insertLeaf(leafIndex: number, leaf: LeafData) {
        const { slot, signingKeyHash, blockNumber } = leaf;
        const leafData = [slot, signingKeyHash, blockNumber];
        const nodeHash = keccak256(new AbiCoder().encode(
            ["bytes32", "bytes32", "uint256"], leafData));

        this.tree.insertLeaf(leafIndex, nodeHash);
        this.leafData.push(leaf);
        this.rootHash2BlockNumber.set(this.tree.getCurrentRootHash(), blockNumber);

        const slotHistory = this.slotHistoryNodeIndex.get(slot) || [];
        slotHistory.push(leafIndex);
        this.slotHistoryNodeIndex.set(slot, slotHistory);
    }

    getLatestRootHash(): string {
        return this.tree.getCurrentRootHash();
    }

    getLatestBlockNumber(): number {
        return this.rootHash2BlockNumber.get(this.tree.getCurrentRootHash()) || 0;
    }

    getBlockNumberByRootHash(rootHash: string): number | undefined {
        return this.rootHash2BlockNumber.get(rootHash);
    }

    getRootIndex(rootHash: string): number | null {
        return this.tree.getRootIndex(rootHash);
    }

    getSlotLatestLeafIndexUnderRoot(slot: string, rootHash: string): number | undefined {
        const nodeIndex = this.tree.getRootIndex(rootHash);
        if (nodeIndex === null) {
            throw Error(`rootHash ${rootHash} not found`);
        }

        const slotHistory = this.slotHistoryNodeIndex.get(slot);
        if (slotHistory === undefined) {
            return undefined;
        }

        let latestLeafIndex = undefined;
        for (const leafIndex of slotHistory) {
            if (leafIndex <= nodeIndex) {
                latestLeafIndex = leafIndex;
            } else {
                break;
            }
        }
        return latestLeafIndex;
    }

    getLeafData(leafIndex: number): LeafData {
        if (leafIndex < 0 || leafIndex >= this.leafData.length) {
            throw Error(`invalid leafIndex`);
        }
        return this.leafData[leafIndex];
    }

    getLeafCount(): number {
        return this.leafData.length;
    }

    getProof(proveLeafIndex: number, underLeafIndex: number): string[] {
        return this.tree.getProof(proveLeafIndex, underLeafIndex);
    }
}