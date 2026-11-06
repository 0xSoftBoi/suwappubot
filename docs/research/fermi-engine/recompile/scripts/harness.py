"""Behavioural diff: candidate FermiEngine vs live engine on an anvil fork with a mock registry.
usage: harness.py <recompile dir> <ncases> [seed]
Requires anvil running on 127.0.0.1:8599 forked from mainnet (started by caller)."""
import json, subprocess, sys, random, os
sys.path.insert(0, os.path.dirname(__file__))
from sigsearch import keccak256
R = sys.argv[1]; N = int(sys.argv[2]); random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 1)
CAST = os.path.expanduser('~/.foundry/bin/cast'); FORGE = os.path.expanduser('~/.foundry/bin/forge')
RPC = 'http://127.0.0.1:8599'
ENG = '0x90f73feA1Ee2dC514D4dbac0bFf7fF04B933767f'; REG = '0xDa7AfeeD01fe625CF15d187a19f94B45f00b8C5F'
VAULT = '0x585d44727129B9C69791B10238Ca605932938B4F'
WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode != 0: raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout.strip()
def rpc(m, *p): return sh(CAST, 'rpc', '--rpc-url', RPC, m, *[str(x) for x in p])
def h32(i): return '0x%064x' % i
def pairid(a, b): return keccak256(bytes.fromhex(a[2:].lower().zfill(64) + b[2:].lower().zfill(64)))
def slot_map(key32, base): return int.from_bytes(keccak256(key32 + base.to_bytes(32, 'big')), 'big')
def getst(a, s): return int(rpc('eth_getStorageAt', a, h32(s), 'latest').strip('"'), 16)
def setst(a, s, v): rpc('anvil_setStorageAt', a, h32(s), h32(v))

# 1 deploy candidate
art = json.load(open(R + '/proj/out/Engine.sol/FermiEngine.json'))
dep = sh(FORGE, 'create', '--root', R + '/proj', '--rpc-url', RPC, '--unlocked', '--from', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '--broadcast',
         'src/Engine.sol:FermiEngine', '--constructor-args', VAULT, '0x00000000000000000000000000000000000000AA', VAULT)
CAND = [l.split()[-1] for l in dep.splitlines() if 'Deployed to' in l][0]
print('candidate at', CAND)
# 2 mock registry
mock = json.load(open(R + '/proj/out/Mock.sol/MockRegistry.json'))
rpc('anvil_setCode', REG, mock['deployedBytecode']['object'])
# 3 copy storage
for s in (2, 3): setst(CAND, s, getst(ENG, s))
pairs_to_copy = [(WETH, USDT), (WETH, USDC), (USDC, USDT)]
for a, b in pairs_to_copy:
    pid = pairid(a, b); K = slot_map(pid, 4)
    for off in range(0, 7): setst(CAND, K + off, getst(ENG, K + off))
    for arr in (5, 6):
        n = getst(ENG, K + arr)
        base = int.from_bytes(keccak256((K + arr).to_bytes(32, 'big')), 'big')
        for i in range(n * 3): setst(CAND, base + i, getst(ENG, base + i))
for t in (WETH, USDT, USDC):
    s = slot_map(bytes.fromhex(t[2:].lower().zfill(64)), 8); setst(CAND, s, getst(ENG, s))
SEL = 'quote(address,address,int256,address)'
def q(addr, tin, tout, amt):
    r = sh(CAST, 'call', '--rpc-url', RPC, addr, SEL, tin, tout, str(amt), '0x0000000000000000000000000000000000000001', check=False)
    return r.replace('\n', ' ') if r else 'REVERT'
def q2(addr, tin, tout, amt):
    r = subprocess.run([CAST, 'call', '--rpc-url', RPC, addr, SEL, tin, tout, str(amt), '0x0000000000000000000000000000000000000001'], capture_output=True, text=True)
    return ('OK ' + r.stdout.replace('\n', ' ').strip()) if r.returncode == 0 else ('ERR ' + r.stderr.strip()[-120:])
ok = bad = 0; samples = []
for i in range(N):
    price = random.randint(1500, 5000) * 10**8 + random.randint(0, 10**8)
    setst(REG, 0, price)
    pair = random.choice([(WETH, USDT), (WETH, USDC), (USDC, USDT)])
    tin, tout = random.choice([pair, pair[::-1]])
    ex_out = random.random() < 0.2
    dec = {WETH: 18, USDT: 6, USDC: 6}[tin]
    amt = int(10 ** dec * random.choice([0.01, 0.1, 1, 5, 20, 80]) * random.uniform(0.5, 2) * (1 if dec == 18 else 2000))
    amt = -amt if ex_out else amt
    a = q2(ENG, tin, tout, amt); b = q2(CAND, tin, tout, amt)
    if a == b: ok += 1
    else:
        bad += 1
        if len(samples) < 12: samples.append((price, tin[-4:], tout[-4:], amt, a, b))
print('cases', N, 'match', ok, 'mismatch', bad)
for s in samples: print(s)
