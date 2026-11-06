import subprocess, itertools, sys, os
CAST = os.path.expanduser('~/.foundry/bin/cast')
targets = {'18afc274','294a8f17','451a5e65','4b630121','6d106317','713ea8a6','79d44573','c33a67ba','c9e270d0','d6b0bdd5','d6c3c9df','da279a7f','efe1066e','1072cbea'}
names = """swap quote setPair addPair updatePair setPairConfig updatePairConfig setConfig registerPair addUpdater setUpdater
setMaxParameterAge setMaxAge setActive setPairActive setIsActive setTokenLimit setInventoryLimit setMaxVaultBalance setCap setLimit
setSwapWindow setSameBlockWindow setWindow setBlockWindow getPair pairConfig getConfig getPairConfig pairs pair isPair isRegistered
registeredPairs pairId getPairId getState setPairStatus togglePair activatePair deactivatePair pausePair unpausePair setPaused
getAccumulator accumulated volume blockVolume cumulative cumulativeVolume getVolume setRegistry setPrioRegistry removeUpdater
updaters isUpdater addUpdaters registerUpdater setPriceUpdater unregisterUpdater setMaxParameterAge setParameterAge
setWindowBlocks setMaxBlocks setBlocks setSwapBlocks maxVaultBalance maxBalance vaultCap tokenCap setMaxBalance setVaultCap setTokenCap
limit limits setLimits tokenLimit inventoryLimit getInventoryLimit pairActive active getActive  getPairInfo pairInfo
updateCurve setCurve setCurves updateCurves setSizeCurve setSkewCurve updateSizeCurve updateSkewCurve updateParams setParams setPairParams updatePairParams
addPairConfig getBalance balances vaultBalance getVaultBalance previewSwap previewQuote getAmountOut getQuote computeSwap simulate  tokenScale
isSupported supported unlockedPair isUnlocked setUnlocked lock unlock lockPair unlockPair setLocked setPairUnlocked
""".split()
argsets = ["", "address", "address,address", "address,address,bool", "address,address,uint256", "address,uint256", "uint64", "uint256", "uint32", "address,address,address","address,address,uint256,address","address,address,int256,address","bool","bytes32","address,bool","uint64,uint64"]
found = {}
batch = []
for n in names:
    for a in argsets:
        batch.append(f"{n}({a})")
# cast sig one at a time is slow; use cast keccak batched via many calls -> instead use python keccak implementation
def rol(x, n): return ((x << n) | (x >> (64 - n))) & 0xFFFFFFFFFFFFFFFF
RC = [0x0000000000000001,0x0000000000008082,0x800000000000808A,0x8000000080008000,0x000000000000808B,0x0000000080000001,0x8000000080008081,0x8000000000008009,0x000000000000008A,0x0000000000000088,0x0000000080008009,0x000000008000000A,0x000000008000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,0x8000000000008002,0x8000000000000080,0x000000000000800A,0x800000008000000A,0x8000000080008081,0x8000000000008080,0x0000000080000001,0x8000000080008008]
ROT = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]
def f(A):
    for rc in RC:
        C = [A[x][0]^A[x][1]^A[x][2]^A[x][3]^A[x][4] for x in range(5)]
        D = [C[(x-1)%5] ^ rol(C[(x+1)%5],1) for x in range(5)]
        A = [[A[x][y]^D[x] for y in range(5)] for x in range(5)]
        B = [[0]*5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                B[y][(2*x+3*y)%5] = rol(A[x][y], ROT[x][y])
        A = [[B[x][y] ^ ((~B[(x+1)%5][y]) & B[(x+2)%5][y]) for y in range(5)] for x in range(5)]
        A[0][0] ^= rc
    return A
def keccak256(data: bytes) -> bytes:
    rate = 136
    p = bytearray(data) + b'\x01'
    while len(p) % rate: p.append(0)
    p[-1] |= 0x80
    A = [[0]*5 for _ in range(5)]
    for off in range(0, len(p), rate):
        blk = p[off:off+rate]
        for i in range(rate//8):
            A[i%5][i//5] ^= int.from_bytes(blk[8*i:8*i+8], 'little')
        A = f(A)
    out = b''
    for i in range(4):
        out += A[i%5][i//5].to_bytes(8, 'little')
    return out
if __name__ == '__main__':
    assert keccak256(b'').hex().startswith('c5d2460186f7233c')
    for s in batch:
        h = keccak256(s.encode()).hex()[:8]
        if h in targets: print(h, s)
