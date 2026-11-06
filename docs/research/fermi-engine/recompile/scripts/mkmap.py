import json, sys
j = json.load(open(sys.argv[1]))
mi = j['methodIdentifiers']
want = {'18afc274': 'addPair', '294a8f17': 'updatePair', '451a5e65': 'addUpdater', '79d44573': 'removeUpdater',
        '4b630121': 'setSwapWindow', '713ea8a6': 'cumulative', 'da279a7f': 'swapWindow', 'efe1066e': 'maxInventory',
        '6d106317': 'setMaxInventory', 'c33a67ba': 'getPairParams'}
out = {}
for t, n in want.items():
    for sig, sel in mi.items():
        if sig.split('(')[0] == n: out[t] = sel
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(out)
