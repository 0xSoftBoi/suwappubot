import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from sigsearch import keccak256
want = {'451a5e65':'address','79d44573':'address','4b630121':'uint64','efe1066e':'address','da279a7f':'','713ea8a6':'address,address,bool','294a8f17':None,'18afc274':None}
names = """maxInventory inventoryLimit maxInventories getMaxInventory inventoryCap
setSwapWindow setBlockWindow setWindow setAccWindow setAccumulatorWindow setAccumulatorBlocks setAccumulationWindow setVolumeWindow setCumulativeWindow setFlowWindow setSameBlockWindow setBlockLookback setLookback setLookbackBlocks setMaxBlockAge setAccBlocks setWindowBlocks
swapWindow blockWindow window accWindow accumulatorWindow accumulationWindow volumeWindow cumulativeWindow flowWindow lookback lookbackBlocks accBlocks windowBlocks
addUpdater removeUpdater addPriceUpdater removePriceUpdater registerUpdater unregisterUpdater whitelistUpdater delistUpdater authorizeUpdater revokeUpdater addOracleUpdater removeOracleUpdater allowUpdater disallowUpdater setUpdater addKeeper removeKeeper addSigner removeSigner addFeeder removeFeeder addWriter removeWriter addPublisher removePublisher addPusher removePusher addOperator removeOperator
authorize deauthorize revoke grantUpdater revokeUpdater
cumulative cumulativeVolume accumulated accumulator volumeInBlock blockVolume pairVolume cumulativeIn accumulatedVolume currentVolume getCumulative getAccumulated getCumulativeVolume getAccumulatedVolume getBlockVolume
getCumulativeIn pairAccumulator getPairAccumulator accumulatorOf accOf cumOf cum acc volume flow
lastBlockVolume getAcc getCum readAccumulator readAcc readCumulative pending pendingVolume sizeAccumulated
""".split()
res = set()
for n in names:
    for k, a in want.items():
        args = [a] if a is not None else ['address,address,uint256']
        for aa in args:
            h = keccak256(f'{n}({aa})'.encode()).hex()[:8]
            if h == k: print(h, n, aa)
    # also try every selector with every arg type for names
    for aa in ['','address','uint64','address,address','address,address,bool','address,uint256','uint256','uint32']:
        h = keccak256(f'{n}({aa})'.encode()).hex()[:8]
        if h in want: print('X', h, n, aa)
