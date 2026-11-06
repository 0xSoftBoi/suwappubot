import sys, os, re, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from sigsearch import keccak256
topics = {}
for l in open(sys.argv[1]).read().splitlines():
    pass
# collect PUSH32 values that precede LOG ops in target.dis
lines = [l.split() for l in open(sys.argv[1]).read().splitlines()]
cand = set()
for i, l in enumerate(lines):
    if l[1].startswith('LOG'):
        for k in range(max(0, i-14), i):
            if lines[k][1] == 'PUSH32' and len(lines[k][2]) >= 62 and lines[k][2] != '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff':
                cand.add(lines[k][2][2:].zfill(64))
print(len(cand), 'candidate event topics')
nouns = ['Swapper','TraderVault','Vault','SwapWindow','Window','MaxInventory','Inventory','InventoryLimit','Updater','PriceUpdater','Pair','PairActive','PairStatus','PairParams','PairConfig','PairAdded','PairUpdated','PairRemoved','PairRegistered','PairUnregistered','Registry','MaxParameterAge','Manager','SwapperSet']
suff = ['Updated','Set','Changed','Added','Removed','Registered','Unregistered','Enabled','Disabled','']
args = ['address','address,address','address,address,bool','address,uint256','uint256','uint64','uint64,uint64','address,address,address','address,uint256,uint256','address,address,uint256','bool','address,bool','address,address,uint8']
for n in nouns:
    for s in suff:
        for a in args:
            sig = n + s + '(' + a + ')'
            h = keccak256(sig.encode()).hex()
            if h in cand: print(h, sig)
for c in sorted(cand): print('cand', c)
