"""Minimal EVM disassembler + dispatcher extraction. usage: disasm.py <hexfile> [out.txt]"""
import sys, re
OPS = {0:'STOP',1:'ADD',2:'MUL',3:'SUB',4:'DIV',5:'SDIV',6:'MOD',7:'SMOD',8:'ADDMOD',9:'MULMOD',0xa:'EXP',0xb:'SIGNEXTEND',
0x10:'LT',0x11:'GT',0x12:'SLT',0x13:'SGT',0x14:'EQ',0x15:'ISZERO',0x16:'AND',0x17:'OR',0x18:'XOR',0x19:'NOT',0x1a:'BYTE',0x1b:'SHL',0x1c:'SHR',0x1d:'SAR',
0x20:'KECCAK256',0x30:'ADDRESS',0x31:'BALANCE',0x32:'ORIGIN',0x33:'CALLER',0x34:'CALLVALUE',0x35:'CALLDATALOAD',0x36:'CALLDATASIZE',0x37:'CALLDATACOPY',
0x38:'CODESIZE',0x39:'CODECOPY',0x3a:'GASPRICE',0x3b:'EXTCODESIZE',0x3c:'EXTCODECOPY',0x3d:'RETURNDATASIZE',0x3e:'RETURNDATACOPY',0x3f:'EXTCODEHASH',
0x40:'BLOCKHASH',0x41:'COINBASE',0x42:'TIMESTAMP',0x43:'NUMBER',0x44:'PREVRANDAO',0x45:'GASLIMIT',0x46:'CHAINID',0x47:'SELFBALANCE',0x48:'BASEFEE',
0x50:'POP',0x51:'MLOAD',0x52:'MSTORE',0x53:'MSTORE8',0x54:'SLOAD',0x55:'SSTORE',0x56:'JUMP',0x57:'JUMPI',0x58:'PC',0x59:'MSIZE',0x5a:'GAS',0x5b:'JUMPDEST',
0x5e:'MCOPY',0x5f:'PUSH0',0xf0:'CREATE',0xf1:'CALL',0xf2:'CALLCODE',0xf3:'RETURN',0xf4:'DELEGATECALL',0xf5:'CREATE2',0xfa:'STATICCALL',0xfd:'REVERT',0xfe:'INVALID',0xff:'SELFDESTRUCT'}
for i in range(16): OPS[0x80+i]='DUP%d'%(i+1); OPS[0x90+i]='SWAP%d'%(i+1)
for i in range(5): OPS[0xa0+i]='LOG%d'%i
def strip_meta(code: bytes) -> bytes:
    n = int.from_bytes(code[-2:], 'big')
    if n + 2 <= len(code) and code[-n-2:-n-1][:1] in (b'\xa1', b'\xa2', b'\xa3', b'\xa4'):
        return code[:-n-2]
    return code
def disasm(code: bytes):
    out = []; i = 0
    while i < len(code):
        b = code[i]
        if 0x60 <= b <= 0x7f:
            n = b - 0x5f
            out.append((i, 'PUSH%d' % n, int.from_bytes(code[i+1:i+1+n], 'big'), n)); i += 1 + n
        else:
            out.append((i, OPS.get(b, 'UNK%02x' % b), None, 0)); i += 1
    return out
def load(path):
    h = open(path).read().strip()
    if h.startswith('0x'): h = h[2:]
    return bytes.fromhex(h)
if __name__ == '__main__':
    code = load(sys.argv[1]); full = len(code); code = strip_meta(code)
    ins = disasm(code)
    print('full', full, 'stripped', len(code), 'ins', len(ins), file=sys.stderr)
    with open(sys.argv[2], 'w') as f:
        for pc, op, imm, n in ins:
            f.write('%05x %s%s\n' % (pc, op, (' 0x%x' % imm) if imm is not None else ''))
