# Engine recompile notes (0x90f73fea...767f)

Status: NOT bytecode-equal. Toolchain pinned; behaviour matched 120/120 on a mainnet fork; structure partly matched.

## Toolchain (VERIFIED)
- CBOR tail: ipfs hash present, solc 0x00081c = 0.8.28. Same as wrapper: 0.8.28, optimizer 1,000,000 runs, prague, viaIR false, ipfs.
- Evidence: BaseManager-derived functions compile to opcode-identical code (setVaultAddress 85535cc5, prioRegistry e8275d6e, withdrawAllTokens f57f2e12, swapper/traderVault getters, VERSION: score 0-5, remainder = immutable PUSH32).
- OZ = v5.4.0 (wrapper's ReentrancyGuard/SafeERC20/IERC20 byte-identical to v5.4.0; Math.sol from 5.4.0 used for the engine: mulDiv(.., Rounding) is present in target).

## Layout (VERIFIED from bytecode)
0 ReentrancyGuard status | 1 vault | 2 traderVault | 3 swapper + uint64 swapWindow(<<160) | 4 mapping(bytes32=>Pair) | 5 PairInfo[] (getPairs) | 6 (pair index, inferred) | 7 mapping(bytes32=>mapping(bool=>Acc{uint64 block; uint192 cum})) | 8 mapping(address=>uint256) inventory cap.
Immutables: manager 0xFF67d721..c47f, prioRegistry 0xDa7A..8C5F, maxParameterAge uint32 = 0. VERSION = 20260720 (0x1352770).
Pair struct: s0 active|baseEdge u128|targetBps u16; s1 lo|hi; s2 scaleBase|scaleQuote; s3,s4 base/quote (inferred); s5 sizeCurve Seg[]; s6 skewCurve Seg[]. Seg = 6 x int128 (3 slots), binary search (not linear).

## Names recovered by keccak (VERIFIED)
swap(address,address,int256,address) d6b0bdd5, quote(...) c9e270d0, setPairActive(address,address,bool) d6c3c9df, getPairParams(address,address) c33a67ba, setMaxInventory(address,uint256) 6d106317.
Events: SwapperSet(address), PairRegistered(address,address), PairUnregistered(address,address), PairActiveSet(address,address,bool).
Registry selectors (call targets): addUpdater(address)=43d24a5e, removeUpdater(address)=04b07a5e, getState=16c83adc (uint256,uint32,uint32).
UNKNOWN names (brute force failed): 18afc274, 294a8f17 (address,address,PairParams-tuple), 451a5e65, 79d44573 (engine-side wrappers of registry add/removeUpdater), 4b630121 (uint64 setter; its event topic daddf81a...523aa), 713ea8a6 (address,address,bool)->uint256 (cumulative-in-window reader), da279a7f (uint64 getter), efe1066e (mapping(address)=>uint256 getter).

## Formula corrections vs fermi-FINDINGS.md (VERIFIED by fork diff, 120/120)
1. amountSpecified is int256: NEGATIVE = exact-out (amount denominated in tokenOut). Findings only modelled exact-in. Exact-out: qty from the out leg, clamp to hi, edge from same curves, amountIn = mulDiv(..., Rounding.Ceil); if the out amount exceeds the vault balance, price is taken at the UNclamped size and only the out amount is clamped.
2. hi == 0 means no per-swap clamp (bytecode: `hi != 0 && qty > hi`).
3. Accumulator is Acc{uint64 block, uint192 cum}; swap reverts 'CO' if cum > uint192.max. Extra revert codes in bytecode: 'EC' (empty curve, size 0), 'UP' only when neither orientation has lo != 0 (existence test is lo != 0, not the active flag), 'COR' on both v < x0 and v > last x1.
4. Registry age: uses uint32(block.timestamp) - maxParameterAge (immutable 0).
5. Findings said getState "uint256 pairIdAsUint": selector is 16c83adc.
6. Admin functions emit events (4 recovered above) and the setters check ZA.

## Score (scripts/score.py, closure-per-selector, 100/opcode, 5/imm; misorder not computed)
Exact (score <=5, i.e. only immutable PUSH32 differs): 2b3297f9, 42b1e432, 51ed0ee3, 85535cc5, e8275d6e, f57f2e12, ffa1ad74, da279a7f, efe1066e.
Near: 1072cbea 1605, 12f351a3 1005, 404177c0 705, 519af30e/1f57256f 405, dbda983b ~3000, 9c82f2a4 ~4600.
Far: d6b0bdd5/c9e270d0 ~3e5 (target 3062/2899 ops vs ours ~2700/2500), 294a8f17/18afc274 (pair write), 5a33733c, c33a67ba, 17d01716.
Whole-runtime: target 22988 B, ours 20131 B, opcode-sequence similarity 0.93, NOT equal. Target keccak e397591c78c9a0f0..., ours differs.
Why far: target inlines specific internal-function structure (Ctx memory struct, mulDiv helper variants 58xx, checked signed helpers, CO/EC checks, events, 3 differently-shaped curve interpolators). Needs per-function iteration against the dis.

## Reproduce
forge in ~/.foundry/bin (/usr/bin/forge is a different tool). `cd proj && forge build`; `python3.12 -I scripts/score.py ../engine.hex proj/out/Engine.sol/FermiEngine.json ref/selmap.json`; fork test: start `anvil --fork-url https://eth.drpc.org --port 8599`, then `python3.12 -I scripts/harness.py <recompile dir> 120 11`.
