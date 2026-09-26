# Multi-port elements

Status: **built, measured, removed.**  Kept as a record so the idea is not
rebuilt from scratch on the same reasoning.  The code is in git history at
`b0a905a~` (`core/multiport.py`, `tests/test_multiport.py`,
`ExactQuoterClient.element_split`, and the generator in `core/candidates.py`).

## The idea

A pool with `N > 2` coins can serve several ports in one interaction:

    XDAI -> (3pool) -> 3Crv + USDC.e
    DAI  -> (3pool) -> USDC + USDT

`build_arcs` emits one arc per directed `(pool, i, j)` pair, the solver treats
each as an independent resistor, and two arcs of one pool are two separate
`psi^2/2G` terms with no cross-term -- both calibrated against a state neither
will see, because the first leg moves the pool before the second runs.  An
element prices the pair *together*, advancing the pool between the legs, which
is the arithmetic that matches execution.  The rule was
`#inputs + #outputs <= #coins`, with the LP token consuming no coin slot.

That reasoning is still correct.  It is simply worth less than the cost.

## What the measurements said

**A pinned-block A/B, 9 pairs across gnosis and Ethereum, elements the only
switch: output byte-identical in all 9.**  Not "slightly worse" -- identical,
including gnosis WXDAI -> EURe, the case elements were built for.

**10 element candidates were generated and 0 produced a quote.**  Three each on
the gnosis EURe routes, one on WXDAI -> USDC.e, and **none at all on any
Ethereum pair** -- there, no co-active pool shares an input coin, so the
generator never fires.

The natural reading was that they are unquotable rather than unprofitable: an
element is one pool entered twice, and `quote_routes` walks with `staticcall`,
so the second leg reads the pool before the first touched it.  That reading was
half right and the half that was wrong is the interesting half.

**Run through the executor -- which can execute what `quote_routes` refuses to
price -- they execute fine, and lose badly:**

| route | winner | element | gap |
|---|---|---|---|
| gnosis WXDAI -> EURe 100k | 84,601.93 EURe | 66,317.56 | -21.6% |
| gnosis WXDAI -> USDC.e 200k | 199,739.49 USDC.e | 196,852.82 | -1.44% |

So the machinery worked and the answer it produced was worse.  Pinning flow
through two ports of one pool is not what the optimum wants on any pair
measured; the unpinned solve already found something better.

(One detour worth recording: every element candidate failed to execute at
first, and the cause was the executor not knowing that gnosis's USDC
transmuter takes `deposit(uint256)` rather than WETH's payable `deposit()` --
fixed in `487a25f`.  The elements were being blamed for a bug in the harness,
which is why the executor test was worth running before deciding.)

## Why it was removed rather than left dormant

It cost 2-3 of the 20 candidate slots and ~25 ms of `candidates` on gnosis, and
returned nothing on any pair measured.  Dead code that looks alive is worse
than no code: the generator ran on every quote and produced candidates that
were then discarded, which reads as "we tried the element and it lost" when
what actually happened is that it was never in contention.

## What would justify revisiting it

The measurements above are about *this* universe.  An element can only help
where one pool is genuinely the best route for two different output coins at
once, and where the reentry sweep does not already bracket the split.  If a
chain appears with deep multi-coin pools and thin alternatives around them,
re-run the A/B before rebuilding anything -- it is nine lines of harness
(`scripts/verify_execution.py` is the same shape) and it settles the question
in one run.


## What it is now (2026-08-20)

Elements are the **admissibility rule**, not a candidate generator competing
against re-entry.  `check_one_arc_per_pool` and `conflicting_pools` both ask
`core/multiport.element_from`: a pool may appear more than once in a route only
when its legs form one element.  The old exemption -- "every leg but the last is
`ADVANCEABLE`" -- is gone, along with the `reentrant` plumbing and the
`reenter N pool(s)` candidate, which is unnecessary once a legal element is not
a conflict to repair around.

Admissibility is structural rather than a rule to remember:

* a coin holds at most one port, so `#coin-ports in + #coin-ports out <= N`
  follows.  **A 2-coin pool admits one in and one out and cannot be re-entered**;
* the LP token is not one of the `N`, so swap-and-deposit on a 2-coin pool --
  the gnosis split -- stays legal at three ports over two coins;
* many-in many-out is refused rather than paired by guess;
* an LP *input* paying several coins is refused: `evaluate` cannot advance a
  burn, so it would price every withdrawal against one supply;
* two arcs sharing both ports are §9.5's parallel pair, not an element.

**The generator still does not win.**  Re-measured with re-entry removed rather
than switched on in both arms -- the flaw in the original A/B -- `best_split`
prices the four pairs offered on gnosis WXDAI -> EURe at ratios of about
10,000:1, so the element degenerates to a single arc and the pinned candidate
adds nothing.  That is the same answer as before, now from a fair comparison.
The representation earns its place; the search heuristic still does not.
