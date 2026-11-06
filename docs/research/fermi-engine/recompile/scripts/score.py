"""Recompile-and-score. usage: score.py <target.hex> <candidate artifact json> <selector-map.json>
selector-map: {targetSelector: candidateSelector} for functions whose name is unknown (placeholders).
Per-function: closure of blocks reachable from the dispatcher stub via static PUSH2 jump edges (excluding the
shared helpers listed as 'shared' = reached from >=5 distinct entry points, scored separately as 'shared').
Weights: 100 per missing/extra opcode, 5 per wrong non-jump-target immediate (60 misorder not computed: difflib has no move op).
"""
import sys, json, difflib, collections, os
sys.path.insert(0, os.path.dirname(__file__))
from disasm import disasm, strip_meta, load
from sigsearch import keccak256

def cand_code(path):
    j = json.load(open(path))
    o = j['deployedBytecode']['object']
    return bytes.fromhex(o[2:] if o.startswith('0x') else o)

def blocks(code):
    ins = disasm(code)
    # blocks keyed by pc of JUMPDEST (and 0)
    bl = collections.OrderedDict(); cur = None
    for k, (pc, op, imm, n) in enumerate(ins):
        if cur is None or op == 'JUMPDEST':
            cur = pc; bl[cur] = []
        bl[cur].append((pc, op, imm))
        if op in ('JUMP', 'STOP', 'REVERT', 'RETURN', 'INVALID'):
            cur = None
    return bl, ins

def edges(bl, jd):
    e = {}
    for pc, ins in bl.items():
        t = set()
        for (p, op, imm) in ins:
            if op == 'PUSH2' and imm in jd: t.add(imm)
        e[pc] = t
    return e

def dispatch(ins):
    m = {}
    for i in range(len(ins) - 3):
        if ins[i][1] == 'PUSH4' and ins[i+1][1] == 'EQ' and ins[i+2][1].startswith('PUSH') and ins[i+3][1] == 'JUMPI':
            m.setdefault('%08x' % ins[i][2], ins[i+2][2])
    return m

def closure(entry, e, stop):
    seen = set(); st = [entry]
    while st:
        x = st.pop()
        if x in seen or x in stop and x != entry: continue
        seen.add(x)
        st.extend(e.get(x, ()))
    return seen

def toks(bl, pcs, mask_const=None):
    out = []
    for pc in sorted(pcs):
        for (p, op, imm) in bl[pc]:
            out.append((op, imm))
    return out

def cmp_score(a, b):
    ta = [x[0] for x in a]; tb = [x[0] for x in b]
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    score = 0; wrong_imm = 0; miss = 0; extra = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for x, y in zip(a[i1:i2], b[j1:j2]):
                if x[1] is not None and x[0] != 'PUSH2' and x[1] != y[1]:
                    wrong_imm += 1
        elif tag == 'delete': miss += i2 - i1
        elif tag == 'insert': extra += j2 - j1
        else: miss += i2 - i1; extra += j2 - j1
    return 100 * (miss + extra) + 5 * wrong_imm, miss, extra, wrong_imm, len(a), len(b)

def main():
    tgt = strip_meta(load(sys.argv[1])); cand = strip_meta(cand_code(sys.argv[2]))
    smap = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
    print('target len', len(tgt), 'cand len', len(cand), 'keccak(target)', keccak256(tgt).hex()[:16], 'keccak(cand)', keccak256(cand).hex()[:16])
    bt, it = blocks(tgt); bc, ic = blocks(cand)
    jt = {pc for pc in bt if bt[pc][0][1] == 'JUMPDEST'}; jc = {pc for pc in bc if bc[pc][0][1] == 'JUMPDEST'}
    et = edges(bt, jt); ec = edges(bc, jc)
    dt = dispatch(it); dc = dispatch(ic)
    print('target selectors', len(dt), 'cand selectors', len(dc))
    # shared helpers: blocks reached from >=5 entries
    def reach(d, e):
        r = {s: closure(x, e, set()) for s, x in d.items()}
        cnt = collections.Counter(b for v in r.values() for b in v)
        return r, cnt
    rt, ct = reach(dt, et); rc, cc = reach(dc, ec)
    sh_t = {b for b, n in ct.items() if n >= 5}; sh_c = {b for b, n in cc.items() if n >= 5}
    total = 0; rows = []
    for s, x in sorted(dt.items()):
        cs = smap.get(s, s)
        if cs not in dc:
            rows.append((s, 'MISSING in candidate', None)); total += 100 * len(toks(bt, rt[s] - sh_t)); continue
        A = toks(bt, rt[s] - sh_t); B = toks(bc, rc[cs] - sh_c)
        sc = cmp_score(A, B)
        rows.append((s, cs, sc)); total += sc[0]
    A = toks(bt, sh_t); B = toks(bc, sh_c)
    sc = cmp_score(A, B); rows.append(('SHARED', '-', sc)); total += sc[0]
    print('%-9s %-9s %8s %6s %6s %6s %6s %6s' % ('target', 'cand', 'score', 'miss', 'extra', 'immx', 'nT', 'nC'))
    for s, cs, sc in rows:
        if sc is None: print(s, cs)
        else: print('%-9s %-9s %8d %6d %6d %6d %6d %6d' % (s, cs, *sc))
    print('TOTAL score', total)
    print('byte-equal (stripped):', tgt == cand)
    ta = [o for _, o, _, _ in it]; tc = [o for _, o, _, _ in ic]
    print('whole-runtime opcode-sequence similarity: %.4f' % difflib.SequenceMatcher(None, ta, tc, autojunk=False).quick_ratio())

main()
