import { AbiCoder, ethers, keccak256, sha256 } from "ethers";

function parent(nodeIndex: number) {
    return Math.floor(nodeIndex / 2);
}

function leftChild(nodeIndex: number) {
    return nodeIndex * 2;
}

function rightChild(nodeIndex: number) {
    return nodeIndex * 2 + 1;
}

function sibling(nodeIndex: number) {
    // We need to cast to BitInt for xor because bit-wise operation for Number is 32 bit in js.
    return Number(BigInt(nodeIndex) ^ BigInt(1));
}


export class IncMerkleTree {
    // the depth of binary tree. max 33.
    treeDepth: number;
    // leaf index: 0, 1, 2, ..., 2**(treeDepth-1)-1
    // node index:
    //     1
    //    / \
    //   2   3
    //  /\   /\
    // 4 5   6 7
    // .........

    // the current hash of each node
    nodeIndex2Hash: Map<number, string>;

    // index and reverse map for rootHash and leafIndex
    leafIndex2RootHash: Map<number, string>;
    rootHash2LeafIndex: Map<string, number>;

    hashNodes: (a: string, b: string) => string
    zeroHashes: string[];

    /**
     * Create a new Incremental Merkle Tree
     * @param treeDepth the depth of the binary tree, max 33
     * @param hashFunction hash function for the merkle tree, sha256 or keccak256
     */
    constructor(treeDepth: number, hashFunction: string = "keccak256") {
        if (treeDepth < 1 || treeDepth > 33) {
            throw Error(`invalid treeDepth ${treeDepth}, must be in [1, 33]`);
        }
        if (hashFunction === "sha256") {
            this.hashNodes = (a: string, b: string) => {
                return sha256(new AbiCoder().encode(["bytes32", "bytes32"], [a, b])).toLowerCase();
            }
        } else if (hashFunction === "keccak256") {
            this.hashNodes = (a: string, b: string) => {
                return keccak256(new AbiCoder().encode(["bytes32", "bytes32"], [a, b])).toLowerCase();
            }
        } else {
            throw Error(`unsupported hashFunction ${hashFunction}`);
        }

        this.treeDepth = treeDepth;
        this.zeroHashes = new Array(treeDepth);
        this.leafIndex2RootHash = new Map();
        this.rootHash2LeafIndex = new Map();
        this.nodeIndex2Hash = new Map();

        // initialize zero hashes at each height
        this.zeroHashes[0] = ethers.ZeroHash.toLowerCase();
        for (let height = 1; height < treeDepth; height++) {
            const childHash = this.zeroHashes[height - 1];
            this.zeroHashes[height] = this.hashNodes(childHash, childHash);
        }
    }

    leafIndex2NodeIndex(leafIndex: number) {
        return 2 ** (this.treeDepth - 1) + leafIndex;
    }

    nodeIndex2Height(nodeIndex: number) {
        return this.treeDepth - 1 - Math.floor(Math.log2(nodeIndex));
    }

    public getCurrentRootHash(): string {
        return this.getNodeHash(1);
    }

    public getRootHash(leafIndex: number): string {
        if (leafIndex < 0 || leafIndex >= this.leafCount()) {
            throw Error(`invalid leafIndex`);
        }
        return this.leafIndex2RootHash.get(leafIndex)!;
    }

    public getRootIndex(rootHash: string): number | null {
        if (this.rootHash2LeafIndex.has(rootHash)) {
            return this.rootHash2LeafIndex.get(rootHash)!;
        }
        return null;
    }

    public getLeafHash(leafIndex: number): string {
        if (leafIndex < 0 || leafIndex >= this.leafCount()) {
            throw Error(`invalid leafIndex`);
        }
        const leafHash = this.getNodeHash(this.leafIndex2NodeIndex(leafIndex));
        return leafHash;
    }

    // get current node hash
    public getNodeHash(nodeIndex: number): string {
        if (nodeIndex <= 0 || nodeIndex >= 2 ** this.treeDepth) {
            throw Error(`nodeIndex ${nodeIndex} out of range [1, ${2 ** this.treeDepth - 1}]`);
        }

        const hash = this.nodeIndex2Hash.get(nodeIndex);
        if (hash) {
            return hash;
        }
        // get zero hash at the corresponding heigh
        const height = this.nodeIndex2Height(nodeIndex);
        return this.zeroHashes[height];
    }

    /**
     * Insert new leaf into the tree
     * @param leafIndex current leaf index
     * @param leafHash the hash of leaf node
     */
    public insertLeaf(leafIndex: number, leafHash: string) {
        // 1. check
        if (this.leafCount() === this.maxLeafCount()) {
            throw Error(`this tree is full`);
        }
        if (leafIndex != this.leafCount()) {
            throw Error(`leafIndex(${leafIndex}) != this.leafCount(${this.leafCount()})`);
        }

        // 2. update hash of each node up to tree root
        let currentIndex = this.leafIndex2NodeIndex(leafIndex);
        let currHash = leafHash;
        this.nodeIndex2Hash.set(currentIndex, currHash);
        for (let height = 1; height < this.treeDepth; height++) {
            // set hash of node at current heigh
            if ((currentIndex & 1) === 1) {
                currHash = this.hashNodes(this.getNodeHash(sibling(currentIndex)), currHash)
            } else {
                currHash = this.hashNodes(currHash, this.getNodeHash(sibling(currentIndex)))
            }
            currentIndex = parent(currentIndex);
            this.nodeIndex2Hash.set(currentIndex, currHash);
        }
        this.leafIndex2RootHash.set(leafIndex, currHash);
        this.rootHash2LeafIndex.set(currHash, leafIndex);
    }

    public leafCount() {
        return this.leafIndex2RootHash.size;
    }

    public maxLeafCount() {
        return 2 ** (this.treeDepth - 1);
    }

    /**
     * Prove the leaf at `proveLeafIndex` under the tree root at `targeLeafIndex`. Require `proveLeafIndex` <= `targeLeafIndex` <= `this.leafCount() - 1`
     * @param proveLeafIndex the leaf index needed to prove
     * @param targeLeafIndex target root index
     * @returns proof with `treeDepth` hashes. the first hash is the leaf hash, then followed by its sbling at each height.
     */
    public getProof(proveLeafIndex: number, targeLeafIndex: number): string[] {
        if (proveLeafIndex > targeLeafIndex) {
            throw Error("targetLeafIndex > currentLeafIndex");
        }
        if (targeLeafIndex > this.leafCount() - 1) {
            throw Error("currentLeafIndex >= this.leafCount");
        }

        let proveNodeIndex = this.leafIndex2NodeIndex(proveLeafIndex);
        let targetNodeIndex = this.leafIndex2NodeIndex(targeLeafIndex);
        const proof = new Array<string>();
        proof.push(this.nodeIndex2Hash.get(proveNodeIndex)!);
        let targetNodeHash = this.nodeIndex2Hash.get(targetNodeIndex)!;
        for (let height = 1; height < this.treeDepth; height++) {
            if ((proveNodeIndex & 1) === 1) {
                // right child
                proof.push(this.getNodeHash(sibling(proveNodeIndex)));
            } else {
                // left child
                if (proveNodeIndex < targetNodeIndex - 1) {
                    //         parent
                    //        /      \                  \
                    // proveNode | siblingNode  |...| targetNode
                    proof.push(this.getNodeHash(sibling(proveNodeIndex)));
                } else if (proveNodeIndex === targetNodeIndex - 1) {
                    //         parent
                    //        /      \
                    // proveNode | siblingNode(targetNode) | ...
                    proof.push(targetNodeHash);
                } else {
                    // proveNodeIndex === targetNodeIndex
                    //                    parent
                    //                   /      \
                    // proveNode(targetNode) | siblingNode(zeroHashes) | ...
                    // insert zero hash at the corresponding heigh
                    const height = this.nodeIndex2Height(proveNodeIndex);
                    proof.push(this.zeroHashes[height]);
                }
            }

            // get target node hash at current height
            if ((targetNodeIndex & 1) === 1) {
                // right child
                targetNodeHash = this.hashNodes(this.getNodeHash(sibling(targetNodeIndex)), targetNodeHash);
            } else {
                // left child
                targetNodeHash = this.hashNodes(targetNodeHash, this.zeroHashes[height - 1]);
            }

            proveNodeIndex = parent(proveNodeIndex);
            targetNodeIndex = parent(targetNodeIndex);
        }
        return proof;
    }

    /**
     * Verify if the proof is valid
     * @param proveLeafIndex the leaf needed to prove
     * @param targeLeafIndex target root index
     * @param proof the first hash is the leaf hash, then followed by its sbling at each height.
     * @returns true if proof is valid
     */
    public isValidProof(proveLeafIndex: number, targeLeafIndex: number, proof: string[]): boolean {
        if (proof.length !== this.treeDepth) {
            throw Error(`invalid proof length`);
        }
        let proveNodeIndex = this.leafIndex2NodeIndex(proveLeafIndex);
        let currentHash = proof[0];
        if (currentHash !== this.getNodeHash(proveNodeIndex)) {
            return false;
        }
        for (let height = 1; height < this.treeDepth; height++) {
            // compute hash at height
            const siblingHash = proof[height];
            if ((proveNodeIndex & 1) === 1) {
                // right child
                currentHash = this.hashNodes(siblingHash, currentHash);
            } else {
                // left child
                currentHash = this.hashNodes(currentHash, siblingHash);
            }
            proveNodeIndex = parent(proveNodeIndex);
        }

        // console.info(`${currentHash} ${this.leafIndex2RootHash.get(targeLeafIndex)}`)
        return currentHash === this.leafIndex2RootHash.get(targeLeafIndex);
    }
}