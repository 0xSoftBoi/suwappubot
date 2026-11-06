import sys, itertools, re
sys.path.insert(0, __import__('os').path.dirname(__file__))
from sigsearch import keccak256
verbs = ['set','add','update','register','remove','unregister','get','create','configure','init','enable','disable','toggle','change','new','put','upsert','replace','delete','edit','modify','']
nouns = ['Pair','PairConfig','PairParams','PairCfg','Config','Cfg','Params','Curve','Curves','Market','Pool','Updater','PriceUpdater','Oracle','OracleUpdater','Feed',
 'Limit','TokenLimit','InventoryLimit','VaultLimit','MaxVaultBalance','MaxBalance','VaultCap','TokenCap','Cap','MaxInventory','Inventory','Window','SwapWindow','BlockWindow','SameBlockWindow','Blocks','MaxBlocks','Accumulator',
 'Volume','CumulativeVolume','BlockVolume','Flow','Registry','Signer','Whitelist','Keeper','Operator','Quoter','Router','Caller','Pairs','PairLimit','Status','PairStatus','Active','Cooldown','Decay','Staleness','MaxAge','Age']
simple = {'451a5e65':['address'],'79d44573':['address'],'4b630121':['uint64'],'6d106317':['address,uint256'],'efe1066e':['address'],'da279a7f':['']}
names = set()
for v in verbs:
    for n in nouns:
        s = v + n
        if v: names.add(s)
        else: names.add(n[0].lower() + n[1:])
names |= {v+n for v in ['set','get'] for n in ['MaxParameterAge','MaxAge']}
names |= set('maxVaultBalance vaultCap tokenCap tokenLimit inventoryLimit maxInventory limits caps cap swapWindow window blockWindow windowBlocks accWindow sameBlockWindow cumWindow accumulationWindow pairs pair config pairConfig getPair pairInfo updaters isUpdater volumeOf accumulated acc cumulative blockVolume pairVolume getVolume volumeInBlock getAccumulator cumulativeVolume getCumulativeVolume'.split())
names = sorted(names)
want = {'18afc274','294a8f17','713ea8a6','c33a67ba'} | set(simple)
st = ['uint256','uint128','uint16','uint64','uint32','uint8','int128','int256','bool']
def check(sig, tag):
    h = keccak256(sig.encode()).hex()[:8]
    if h in want:
        print(h, sig); sys.stdout.flush()
for n in names:
    for a in ['address,address','address,address,bool','address,address,uint256','address,address,uint8','address,address,int256']:
        check(f'{n}({a})', 0)
    for k, lst in simple.items():
        for a in lst: check(f'{n}({a})', 0)
seg = '(int128,int128,int128,int128,int128,int128)[]'
import itertools
combos = list(itertools.product(st, repeat=4))
tn=[n for n in names if re.search('Pair|Config|Cfg|Params|Curve|Market|Pool|pair|config',n) and re.match('set|add|update|register|create|configure|upsert|init|pair|config',n)]
print(len(tn),'tuple names')
for n in tn:
    for c in combos:
        check(f'{n}(address,address,({",".join(c)},{seg},{seg}))', 0)
