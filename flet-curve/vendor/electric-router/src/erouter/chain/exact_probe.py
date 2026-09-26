"""A quoter that computes stableswap probes instead of asking for them.

Every derivative in this router is measured, which is the right default: a pool's
behaviour is a property of its deployed code.  But for stableswap the invariant
is known, the parameters are readable, and `core/stableswap.py` reproduces
`get_dy` to the wei.  Computing it is then both exact at any size and free, which
matters twice over: the quadratic stops being asked to describe a curve at 80% of
a reserve, and the probes for those pools stop being sent at all.

Everything else -- CryptoSwap, LLAMMA, wrappers, any pool whose parameters did
not reproduce its own quote -- goes to the wire exactly as before.  This is a
front for `QuoterClient`, not a replacement.

`quote_routes` is intercepted too, but only for a route whose *every* leg is a
pool the gate admitted.  That is narrower than it looks: the gate's whole job is
to establish that this arithmetic and the pool's own `get_dy` return the same
integer.  §7's "the final answer must come from the chain" is satisfied where it
binds -- the transaction carries a minimum-out and the chain adjudicates it at
submission.

A route with one leg this cannot serve goes to the chain whole.  Half an answer
from a model and half from execution would be worse than either, because nothing
downstream could tell which half it was reading.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from ..core.quoter import Quote
from ..core.stableswap import StableSwapError, StableSwapLP
from ..core.transport import Status
from ..core.tricrypto import TricryptoError
from ..core.twocrypto import TwocryptoError
from ..core.types import ArcKind
from ..core.vault import VaultError
from ..core.walk import LegUnquotable, walk_route

#: Kinds priced by a rate rather than by pool state, so a route may cross one
#: twice without the second reading anything the first moved.  See `_reused`.
RATE_KINDS = frozenset({
    ArcKind.WRAP_NATIVE,
    ArcKind.UNWRAP_NATIVE,
    ArcKind.WSTETH_WRAP,
    ArcKind.WSTETH_UNWRAP,
    ArcKind.STAKE_NATIVE,
    ArcKind.LEND_MINT,
    ArcKind.LEND_REDEEM,
    ArcKind.ERC4626_DEPOSIT,
    ArcKind.ERC4626_REDEEM,
})


class _Withdraw:
    """An LP burn, in the shape every other model answers in.

    The quoter passes the coin to receive as `j` and the LP amount as `dx`,
    which is what `calc_withdraw_one_coin` takes.
    """

    __slots__ = ("lp",)

    def __init__(self, lp):
        self.lp = lp

    def get_dy(self, i: int, j: int, dx: int) -> int:
        return self.lp.calc_withdraw_one_coin(dx, j)

    def get_dy_fast(self, i: int, j: int, dx: int) -> int:
        return self.lp.calc_withdraw_one_coin_fast(dx, j)


class _Deposit:
    """A single-sided deposit: `i` is the coin paid in, `dx` the amount.

    Priced by what `add_liquidity` mints, **not** by `calc_token_amount`.  The
    getter is fee-free on the legacy pools by its own admission, so quoting a
    deposit with it promises a mint the deposit does not pay.  The quoter contract
    has no choice but to call the getter; here there is a choice.

    So this deliberately disagrees with the chain-delegated path, which still gets
    the getter's answer for a pool with no LP model.  The two are not equally
    right.
    """

    __slots__ = ("lp",)

    def __init__(self, lp):
        self.lp = lp

    def _amounts(self, i: int) -> list:
        if not (0 <= i < self.lp.n):
            raise ValueError("coin index out of range")
        return [0] * self.lp.n

    def get_dy(self, i: int, j: int, dx: int) -> int:
        amounts = self._amounts(i)
        amounts[i] = dx
        return self.lp.calc_token_amount_charged(amounts)

    def get_dy_fast(self, i: int, j: int, dx: int) -> int:
        amounts = self._amounts(i)
        amounts[i] = dx
        return self.lp.calc_token_amount_charged_fast(amounts)


@dataclass(slots=True)
class ExactStats:
    computed: int = 0
    delegated: int = 0
    failed: int = 0
    #: Candidate routes verified by walking the models rather than the chain.
    walked: int = 0
    sent_routes: int = 0
    #: `(kind, pool) -> legs`, for legs no model could price.  One of these
    #: sends a whole route to the chain, so this is what to audit a chain for.
    holes: dict = field(default_factory=dict)

    @property
    def total(self) -> int:
        return self.computed + self.delegated + self.failed


class _OneToOne:
    """1:1. `RouteQuoter.vy` returns `dx` for these three, with no call."""

    __slots__ = ()

    def get_dy(self, i: int, j: int, dx: int) -> int:
        return dx


#: Shared: it holds nothing, and one route can carry several wraps.
ONE_TO_ONE = _OneToOne()


def _price(model, i: int, j: int, dx: int) -> int:
    """`get_dy`, through the model's float path when it has one.

    The integer arithmetic is what admits a pool -- `stable_params` compares it
    against the chain wei for wei -- but it is not what a quote needs.  Pricing
    runs thousands of times per route and is ranking candidates whose differences
    are basis points, while the float form was measured on 263 mainnet stableswaps
    to be out by at most 5.4e-4 bp.  A model without a fast path answers in
    integers.
    """
    fast = getattr(model, "get_dy_fast", None)
    return fast(i, j, dx) if fast is not None else model.get_dy(i, j, dx)


class ExactQuoterClient:
    """Wraps a `QuoterClient`, answering what it can from arithmetic."""

    def __init__(self, client, exact, twocrypto=None, tricrypto=None,
                 vaults=None, lp=None, *, enabled: bool = True,
                 models_block: int = 0, rebuild=None, crypto_lp=None):
        self.client = client
        self.exact = exact
        #: Three-coin crypto pools, whose maths is its own module again.
        self.tricrypto = tricrypto
        #: Twocrypto-ng pools whose invariant reproduces their own `get_dy`
        #: -- today the FX Swaps, whose maths is stableswap's.
        self.twocrypto = twocrypto
        #: ERC4626 vaults, per (address, direction): a vault has no curve, so
        #: one ratio serves every size -- and one direction may reproduce while
        #: the other does not.
        self.vaults = vaults
        #: Deposits and withdrawals, for pools whose swap model was admitted
        #: and whose LP arithmetic then reproduced its own answers too.
        self.lp = lp
        #: Cryptoswap withdrawals, same admission rule as `lp`.  Separate because
        #: the arithmetic is a different invariant, and because a cryptoswap pool
        #: has no deposit model -- its own `calc_token_amount` already charges
        #: what `add_liquidity` charges.
        self.crypto_lp = crypto_lp
        self.enabled = enabled
        #: `(pool, kind, i, j) -> model`, cleared whenever the models are
        #: rebuilt.  See `_model`.
        self._model_cache: dict = {}
        #: Pools that can be carried forward, worked out once.  See
        #: `reentrant_pools`.
        self._reentrant: frozenset | None = None
        self.stats = ExactStats()
        #: The block these models were read at.  Not named `block`: this class
        #: forwards unknown attributes to the quoter, and shadowing one it may
        #: itself define would answer a question nobody asked here.
        self.models_block = models_block
        self._rebuild = rebuild

    def refresh_at(self, block: int) -> int:
        """Rebuild the models if the chain moved out from under them.

        Every model freezes the storage it was built from, so it is only valid at
        that block -- correct today because the transport pins one block for the
        life of a process, and wrong the moment a live provider is handed in
        instead.  `pipeline.route` calls this whenever it sees the block move.

        A rebuild that raises leaves the previous models in place and re-raises:
        quoting the wrong block is worse than not quoting.
        """
        if not block or block == self.models_block or self._rebuild is None:
            return 0
        built = self._rebuild(block)
        # Tolerant of length: a caller that rebuilds only the pools keeps the
        # vaults it already had, which is what the tests hand in.
        self.exact, self.twocrypto, self.tricrypto = built[0], built[1], built[2]
        if len(built) > 3:
            self.vaults = built[3]
        if len(built) > 4:
            self.lp = built[4]
        if len(built) > 5:
            self.crypto_lp = built[5]
        self.models_block = block
        # The models the cache pointed at are gone.
        self._model_cache.clear()
        self._reentrant = None
        self.stats = ExactStats()
        return (len(self.exact) + len(self.twocrypto or ())
                + len(self.tricrypto or ()) + len(self.vaults or ()))

    # -- pass-through -------------------------------------------------------

    def __getattr__(self, name):
        return getattr(self.client, name)

    # -- the one method that changes ---------------------------------------

    def probe(self, probes):
        """Compute the stableswap probes; send the rest.

        Order is preserved by filling the computed slots in place and asking the
        inner client only for the holes, so a caller cannot tell which answers
        came from where -- which is the point, since everything downstream is
        entitled to assume one consistent source.
        """
        if not self.enabled or not self.exact:
            self.stats.delegated += len(probes)
            return self.client.probe(probes)

        out: list[Quote | None] = [None] * len(probes)
        holes: list[int] = []
        for k, probe in enumerate(probes):
            model = self._model_for(probe)
            if model is None:
                holes.append(k)
                continue
            try:
                value = _price(model, probe.i, probe.j, probe.dx)
            except (StableSwapError, TwocryptoError, TricryptoError,
                    VaultError, ZeroDivisionError, ValueError):
                # A size the invariant cannot serve is a real answer -- the
                # pool would revert too -- but a *failure to converge* is not
                # something to guess at, so both go to the wire.
                self.stats.failed += 1
                holes.append(k)
                continue
            self.stats.computed += 1
            out[k] = Quote(Status.VALUE if value > 0 else Status.REVERTED, value)

        if holes:
            self.stats.delegated += len(holes)
            served = self.client.probe([probes[k] for k in holes])
            for k, quote in zip(holes, served, strict=True):
                out[k] = quote
        return [q for q in out if q is not None]

    def model_for(self, pool: str, kind, i: int, j: int):
        """The model that prices this arc, or None."""
        return self._model(pool, kind, i, j)

    def computes(self, pool: str) -> bool:
        """Whether a probe on this pool costs arithmetic rather than a request.

        `pipeline` asks so it can re-fit *every* such arc at the trade's own
        size instead of only the ones on its shortlist -- the shortlist is a
        budget for round trips, and these have none.
        """
        if not self.enabled:
            return False
        if self.exact.get(pool) is not None:
            return True
        if self.tricrypto is not None and self.tricrypto.get(pool) is not None:
            return True
        if self.twocrypto is not None and self.twocrypto.get(pool) is not None:
            return True
        return self.vaults is not None and any(
            self.vaults.get(pool, k) is not None
            for k in (ArcKind.ERC4626_DEPOSIT, ArcKind.ERC4626_REDEEM))

    def _model_for(self, probe):
        if probe.dx <= 0:
            return None
        return self._model(probe.pool, probe.kind, probe.i, probe.j)

    def _model(self, pool: str, kind, i: int, j: int):
        """The model that can answer for this pool and direction, if any.

        Memoised.  The answer is a function of `(pool, kind, i, j)` and the
        models, which only change at `refresh_at`, but finding it walks a chain of
        kind tests and allocates a fresh wrapper each time -- measured, the lookup
        was most of the price of pricing.
        """
        key = (pool, kind, i, j)
        try:
            return self._model_cache[key]
        except KeyError:
            pass
        got = self._resolve_model(pool, kind, i, j)
        self._model_cache[key] = got
        return got

    def _resolve_model(self, pool: str, kind, i: int, j: int):
        """Which model serves this pool and direction, worked out from scratch."""
        if kind in (ArcKind.WRAP_NATIVE, ArcKind.UNWRAP_NATIVE,
                    ArcKind.STAKE_NATIVE):
            # Without this the leg is a hole, and one hole sends the whole
            # route to the chain: measured on gnosis, where WXDAI is the
            # wrapped native, that was 2 of 14 candidates and a 172 ms
            # confirmation on every quote.
            return ONE_TO_ONE
        if kind in (ArcKind.ERC4626_DEPOSIT, ArcKind.ERC4626_REDEEM):
            return self.vaults.get(pool, kind) if self.vaults is not None else None
        if self.lp is not None and kind is ArcKind.WITHDRAW_STABLE:
            model = self.lp.get(pool)
            return _Withdraw(model) if model is not None else None
        if kind is ArcKind.WITHDRAW_CRYPTO and self.crypto_lp is not None:
            model = self.crypto_lp.get(pool)
            return _Withdraw(model) if model is not None else None
        if self.lp is not None and kind in (ArcKind.DEPOSIT_FIXED, ArcKind.DEPOSIT_DYN,
                    ArcKind.DEPOSIT_FIXED_NOFLAG):
            # The deposit direction is admitted on its own evidence: a pool
            # whose withdrawal does not reproduce may still deposit exactly,
            # and on the legacy pools the model is the *only* honest path,
            # since their own `calc_token_amount` omits the fee that
            # `add_liquidity` charges.
            model = self.lp.get_deposit(pool)
            return _Deposit(model) if model is not None else None
        if kind is ArcKind.SWAP_CRYPTO:
            if i == j:
                return None
            if self.tricrypto is not None:
                model = self.tricrypto.get(pool)
                if model is not None:
                    if not (0 <= i < 3 and 0 <= j < 3):
                        return None
                    return model
            if self.twocrypto is None:
                return None
            model = self.twocrypto.get(pool)
            if model is None:
                return None
            if not (0 <= i < 2 and 0 <= j < 2):
                return None
            return model
        if kind is not ArcKind.SWAP_STABLE:
            return None
        model = self.exact.get(pool)
        if model is None:
            return None
        n = model.n
        if not (0 <= i < n and 0 <= j < n) or i == j:
            return None
        return model

    def fee_at(self, pool: str, kind, i: int, j: int, dx: int) -> float | None:
        """What this pool charges on a trade of this size, or `None`.

        Only a modelled pool can answer; the rest fall back to the marginal fee
        two probes measure.  See `core.poolfee`.
        """
        from ..core.poolfee import charged_fee

        model = self._model(pool, kind, i, j)
        return None if model is None else charged_fee(model, i, j, dx)

    def fee_floor(self, pool: str, kind, i: int, j: int) -> float | None:
        """The least this pool can charge -- what a minimum rate is set from."""
        from ..core.poolfee import floor_fee

        model = self._model(pool, kind, i, j)
        return None if model is None else floor_fee(model)

    # -- verification, where every leg is a pool we can evaluate --------------

    def quote_routes(self, routes, amounts_in, dst_slots):
        """Walk the routes we can evaluate; send the rest to the chain.

        For a pool admitted by the wei-exact gate, executing a route is a round
        trip to be told what the arithmetic here already knows, so those routes
        are walked with `core/walk.py` -- the same accumulator the contract runs,
        so the two agree by construction rather than by luck.

        A route with a single leg this cannot serve -- a wrapper, an LP deposit, a
        pool still being probed -- goes to the chain whole.  Mixing the two inside
        one route would be worse than either.
        """
        if not self.enabled:
            return self.client.quote_routes(routes, amounts_in, dst_slots)

        out: list[int | None] = [None] * len(routes)
        holes: list[int] = []
        for k, (legs, amount, dst) in enumerate(
                zip(routes, amounts_in, dst_slots, strict=True)):
            reused = self._reused(legs)
            try:
                out[k] = walk_route(legs, amount, dst, self._stateful_leg(legs))
            except LegUnquotable:
                if reused:
                    # A route that enters a pool twice must be walked here or
                    # dropped.  The chain cannot price it: `quote_routes` is
                    # static calls, so its second leg reads the pool before the
                    # first one touched it and answers too well -- turning "we
                    # cannot price this" into a number that beats every honest
                    # candidate.
                    out[k] = 0
                else:
                    holes.append(k)
            except (StableSwapError, TwocryptoError, TricryptoError,
                    VaultError, ZeroDivisionError, ValueError):
                # The invariant refusing a size is a real answer -- the pool
                # would revert too -- but this is the number the winner is
                # chosen on, so it goes to the chain rather than being guessed.
                holes.append(k)
        self.stats.walked += len(routes) - len(holes)

        if holes:
            self.stats.sent_routes += len(holes)
            for k in holes:
                for leg in routes[k]:
                    if self._model(leg.target, leg.kind, leg.i, leg.j) is None:
                        key = (leg.kind.name, leg.target.lower())
                        self.stats.holes[key] = self.stats.holes.get(key, 0) + 1
            served = self.client.quote_routes(
                [routes[k] for k in holes], [amounts_in[k] for k in holes],
                [dst_slots[k] for k in holes])
            for k, value in zip(holes, served, strict=True):
                out[k] = value
        return [0 if v is None else v for v in out]

    def _quote_leg(self, leg, dx: int) -> int:
        model = self._model(leg.target, leg.kind, leg.i, leg.j)
        if model is None:
            raise LegUnquotable(leg.target)
        return _price(model, leg.i, leg.j, dx)

    # -- routes that touch one pool twice ----------------------------------

    @property
    def reentrant_pools(self) -> frozenset:
        """Pools whose state a second leg can be priced against.

        Stableswap only, and only where `admin_fee` was readable: `D` comes from
        the balances there, so the pool after a trade is `exchange`'s business and
        nothing is stored that we would have to guess.  A cryptoswap keeps `D` and
        `price_scale` in storage and moves both in `tweak_price`, so advancing one
        by adjusting balances would be wrong in a way no gate here would catch.
        """
        got = self._reentrant
        if got is None:
            got = frozenset(
                pool for pool, model in (self.exact.by_pool.items()
                                         if self.exact else ())
                if getattr(model, "admin_fee", -1) >= 0
                and hasattr(model, "exchange"))
            self._reentrant = got
        return got

    def element_split(self, pool: str, i: int, j1: int, j2: int,
                      dx: int) -> tuple[int, int] | None:
        """The best `(bps, bps)` split of `dx` between two output coins.

        Priced as one element -- the second port sees the pool the first one
        left -- which is the thing two arcs cannot express.  `None` whenever
        this pool is not one the models can advance, so the caller falls back
        to the sweep it would have done anyway.
        """
        from ..core.multiport import MultiPort, MultiPortError, Port, best_split

        model = self.exact.get(pool) if self.exact else None
        if model is None or pool.lower() not in self.reentrant_pools:
            return None
        lp = self.lp.get(pool) if self.lp is not None else None
        n = model.n
        if not (0 <= i < n and 0 <= j1 < n and 0 <= j2 < n):
            return None
        try:
            element = MultiPort(pool=pool, n_coins=n,
                                inputs=(Port(i, 10_000),),
                                outputs=(Port(j1, 5_000), Port(j2, 5_000)))
            # Value the two ports in the pool's own common denominator.
            # Raw wei would not do: 3pool pays USDC in 6 decimals and DAI in
            # 18, so comparing them directly would hand the whole trade to
            # whichever coin happens to carry more digits.
            rates, coins = model.rates, (j1, j2)
            tuned, _ = best_split(
                element, model, lp, dx,
                lambda k, amount: amount * rates[coins[k]] / 1e18)
        except (MultiPortError, StableSwapError, ArithmeticError, ValueError):
            return None
        return tuned.outputs[0].bps, tuned.outputs[1].bps

    @staticmethod
    def _reused(legs) -> set:
        """Pools this route enters more than once.

        **Conversions do not count.**  A wrap, a lending mint or a vault
        deposit is priced by a *rate*, not by the pool state our own earlier leg
        moved: `previewDeposit` answers the same in a second call as in the
        first, inside one static call, so crossing one twice is honest and the
        chain prices it correctly.  Measured on scrvUSD: two deposits of 50% and
        the remainder return 1,807,773.444328, to the wei what a single sweeping
        leg returns.

        Counting them was expensive.  A route with two `crvUSD -> scrvUSD` legs
        was treated as a re-entered pool, `_stateful_leg` refused it because a
        vault is not in `reentrant_pools`, and `quote_routes` then wrote a
        deliberate zero rather than asking the chain -- killing the candidate.
        On crvUSD -> sDOLA at $2M this took out five candidates in one block and
        cost 9.67 bp against the route the same router had found a few hundred
        blocks earlier.

        The set coincides with `risk.RISKLESS` today, and for the same
        underlying reason -- these kinds are not a market quote -- but the two
        answer different questions and are stated separately.
        """
        seen: dict[str, int] = {}
        for leg in legs:
            if leg.kind in RATE_KINDS:
                continue
            key = leg.target.lower()
            seen[key] = seen.get(key, 0) + 1
        return {pool for pool, n in seen.items() if n > 1}

    def _stateful_leg(self, legs):
        """A `quote_leg` that carries each reused pool forward as it goes.

        `walk_route` calls this in leg order, which is the order an executor would
        run them in, so advancing as we go is the same arithmetic the chain would
        perform.  Only pools that actually appear twice are advanced.

        The advanced leg is priced by `exchange` rather than `_price`, so the
        number returned and the state left behind come from one computation.  That
        costs the integer path on those legs, which is the right trade: they are
        the legs whose answer depends on getting the state right.
        """
        remaining: dict[str, int] = {}
        for leg in legs:
            key = leg.target.lower()
            remaining[key] = remaining.get(key, 0) + 1
        reused = self._reused(legs)
        if not reused:
            return self._quote_leg
        allowed = self.reentrant_pools
        state: dict[str, object] = {}

        def carried(key: str):
            """`(pool, lp)` as this pool now stands, or `(None, base)`.

            One place decides what "now" means, because two disagreed.  The supply
            and the balances move on different legs -- a deposit mints and moves
            both, a swap moves only the balances -- so reading each from wherever
            it was lying around gave a withdrawal the *pre-deposit* supply to burn
            against, and a deposit the *pre-swap* balances to price into.
            """
            base = self.lp.get(key) if self.lp is not None else None
            moved = state.get(key)
            if isinstance(moved, StableSwapLP):
                return moved.pool, moved
            if moved is not None:
                # A swap leaves `total_supply` alone, so the LP wrapper keeps
                # its own and takes the balances the swap left behind.
                return moved, (replace(base, pool=moved) if base is not None
                               else None)
            return None, base

        def quote(leg, dx: int) -> int:
            key = leg.target.lower()
            if key not in reused:
                return self._quote_leg(leg, dx)
            if key not in allowed:
                raise LegUnquotable(leg.target)
            pool_now, lp = carried(key)
            model = (self._reseat(leg, pool_now, lp) if pool_now is not None
                     else self._model(leg.target, leg.kind, leg.i, leg.j))
            if model is None:
                raise LegUnquotable(leg.target)
            remaining[key] -= 1
            if remaining[key] <= 0:
                # Nothing follows on this pool, so there is no state to keep
                # and the float path is enough.
                return _price(model, leg.i, leg.j, dx)
            if leg.kind is ArcKind.SWAP_STABLE:
                base = pool_now if pool_now is not None else model
                dy, after = base.exchange(leg.i, leg.j, dx)
                state[key] = (replace(lp, pool=after) if lp is not None
                              else after)
                return dy
            if lp is None or leg.kind not in (
                    ArcKind.DEPOSIT_FIXED, ArcKind.DEPOSIT_DYN,
                    ArcKind.DEPOSIT_FIXED_NOFLAG):
                raise LegUnquotable(leg.target)
            # `add_liquidity`, not `calc_token_amount`: the getter is fee-free
            # on the legacy pools and over-states the mint, and it is the
            # executed number that the next leg through this pool must see.
            amounts = [0] * lp.n
            if not (0 <= leg.i < lp.n):
                raise LegUnquotable(leg.target)
            amounts[leg.i] = dx
            minted, after_lp = lp.add_liquidity(amounts)
            state[key] = after_lp
            return minted

        return quote

    def _reseat(self, leg, pool, lp=None):
        """The model for `leg`, on the pool and supply as they now stand."""
        if leg.kind is ArcKind.SWAP_STABLE:
            return pool
        if lp is not None and leg.kind in (
                ArcKind.DEPOSIT_FIXED, ArcKind.DEPOSIT_DYN,
                ArcKind.DEPOSIT_FIXED_NOFLAG, ArcKind.WITHDRAW_STABLE):
            return (_Withdraw(lp) if leg.kind is ArcKind.WITHDRAW_STABLE
                    else _Deposit(lp))
        return None
