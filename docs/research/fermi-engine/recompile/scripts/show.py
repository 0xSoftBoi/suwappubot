"""show.py <dis file> <startpc hex> <endpc hex> : compact one-line-per-JUMPDEST-block print"""
import sys
lines = [l.split() for l in open(sys.argv[1]).read().splitlines()]
s, e = int(sys.argv[2], 16), int(sys.argv[3], 16)
cur = []
for l in lines:
    pc = int(l[0], 16)
    if pc < s or pc >= e: continue
    tok = l[1] if len(l) == 2 else l[1] + ':' + l[2][2:]
    if l[1] == 'JUMPDEST' and cur:
        print(' '.join(cur)); cur = []
    if not cur: cur.append('@%x' % pc)
    cur.append(tok.replace('PUSH', 'P'))
    if l[1] in ('JUMP', 'REVERT', 'RETURN', 'STOP', 'INVALID'):
        print(' '.join(cur)); cur = []
if cur: print(' '.join(cur))
