"""Reconstructed pricing model of FermiSwap engine 0x90f73feA1Ee2dC514D4dbac0bFf7fF04B933767f
selectors d6b0bdd5 (swap-quote w/ state write, caller==swapper) and c9e270d0 (same math, view, no caller check, no write).
All formulas VERIFIED against live eth_call (see VALIDATION.md). Integer arithmetic reproduces the EVM bit-exactly.
"""
E18 = 10 ** 18
BPS = 10_000 * E18          # 1e22 : "100%" in the 1e18-scaled-bps unit used by edges/skews
M128 = 1 << 128


class Revert(Exception):
    pass


def sdiv(a, b):             # EVM SDIV (truncate toward zero)
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def interp(arr, v):
    """arr: list of segments [x0, x1, c2, c3, c4, c5] (int128 each, 3 storage slots per element).
    Segment = first i with v <= x1[i] (linear scan / binary search both give this). Revert 'COR' outside [x0[0], x1[-1]]
    t = (v-x0)*1e18/(x1-x0);  y = c5 + c4*t + c3*t^2 + c2*t^3   (all /1e18 fixed-point, SDIV truncation)"""
    idx = next((i for i, e in enumerate(arr) if v <= e[1]), None)
    if idx is None:
        raise Revert("COR")
    x0, x1, c2, c3, c4, c5 = arr[idx]
    if v < x0:
        raise Revert("COR")
    t = sdiv(E18 * (v - x0), x1 - x0)
    t2 = sdiv(t * t, E18)
    t3 = sdiv(t * t2, E18)
    return c5 + sdiv(t * c4, E18) + sdiv(t2 * c3, E18) + sdiv(t3 * c2, E18)


def quote(cfg, p, tin_is_base, amt_in, bal_base, bal_quote, scale_base, scale_quote,
          acc_same_block=0, cap_in=0, bal_in=None):
    """cfg: dict(head, lim, a1, a2) = pair slots K+0, K+1, arrays at keccak(K+5), keccak(K+6)
       p: oracle price quote-per-base * 1e8 (registry.getState(...)[1][0]).
       returns (amountOut, debug)"""
    head, lim = cfg["head"], cfg["lim"]
    if head & 0xff != 1:
        raise Revert("IA")                       # pair inactive
    base_edge = (head >> 8) & (M128 - 1)         # uint128, 1e18-bps  (0.2e18 = 0.2 bp)
    tgt_bps = (head >> 136) & 0xffff             # uint16, target base-weight of vault value (5000 = 50%)
    lo, hi = lim & (M128 - 1), lim >> 128        # lo = size-curve normaliser (quote units), hi = max quote leg per swap
    if amt_in == 0:
        raise Revert("ZA")
    if p == 0:
        raise Revert("ZP")
    # ---- inventory skew s (relative to BASE token, same value for both directions) ----
    v_base = bal_base * p * scale_quote // (scale_base * 10 ** 8)          # vault base value in quote units
    total = v_base + bal_quote
    target = tgt_bps * total // 10_000
    s = sdiv((v_base - target) * E18, total)                               # in [-tgt, 1-tgt] * 1e18
    skew = interp(cfg["a2"], s)                                            # 1e18-bps, negative = lower mid
    # ---- size leg (always measured in QUOTE token native units) ----
    qty = amt_in * p * scale_quote // (scale_base * 10 ** 8) if tin_is_base else amt_in
    if qty > hi:                                                           # per-swap clamp, input scaled down pro-rata
        amt_in = amt_in * hi // qty
        qty = hi
    cum = acc_same_block + qty                                             # per-block, per-direction accumulator
    size = cum * E18 // lo
    edge = base_edge + interp(cfg["a1"], size)                             # 1e18-bps
    # ---- price ----
    p1 = p * (BPS + skew) // BPS                                           # skew moves the mid for BOTH directions
    if BPS + skew <= 0 or (tin_is_base and BPS - edge <= 0):
        raise Revert("TW")
    if tin_is_base:                                                        # taker sells base, receives quote
        p2 = p1 * (BPS - edge) // BPS
        out = amt_in * p2 * scale_quote // (scale_base * 10 ** 8)
    else:                                                                  # taker buys base with quote
        p2 = p1 * (BPS + edge) // BPS
        out = amt_in * scale_base * 10 ** 8 // (p2 * scale_quote)
    out_bal = bal_quote if tin_is_base else bal_base
    out = min(out, out_bal)                                                # cannot pay more than vault holds
    if cap_in and (bal_in if bal_in is not None else (bal_base if tin_is_base else bal_quote)) + amt_in > cap_in:
        raise Revert("IL")                                                 # per-token inventory limit (mapping slot 8)
    return out, dict(s=s, skew=skew, qty=qty, cum=cum, size=size, edge=edge, p1=p1, p2=p2, amt_in_used=amt_in)
