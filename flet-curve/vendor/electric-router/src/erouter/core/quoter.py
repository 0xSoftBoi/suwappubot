"""Client side of RouteQuoter.vy: build calldata, decode results.

No I/O -- it takes a `Transport` and does nothing else, so the same code runs
against a local boa EVM, an `eth_call` state override, or a deployed contract in
the browser.

Chunking lives here because the limits are the contract's (`MAX_PROBES` etc.)
and the node's gas cap, not the transport's.
"""

from __future__ import annotations

from dataclasses import dataclass

from .codec import decode, encode_call
from .transport import Answer, Call, Status, Transport, run_batch
from .types import Leg, Probe

PROBE_T = "(address,uint8,uint8,uint8,uint8,uint256)"
LEG_T = "(address,uint8,uint8,uint8,uint8,uint8,uint8,uint16)"
RES_T = "(uint8,uint256)"

SIG_PROBE_BATCH = f"probe_batch({PROBE_T}[])"
SIG_QUOTE_ROUTE = f"quote_route({LEG_T}[],uint256,uint8)"
SIG_QUOTE_ROUTES = f"quote_routes({LEG_T}[],uint16[],uint256[],uint8[])"
SIG_RAW_BATCH = "raw_batch(address[],bytes[])"

# Mirrors the contract's constants; the cross-check test reads them back.
MAX_PROBES = 600
MAX_LEGS = 128
MAX_ALL_LEGS = 768
MAX_ROUTES = 32
MAX_SLOTS = 128


@dataclass(frozen=True, slots=True)
class Quote:
    status: Status
    value: int

    @property
    def ok(self) -> bool:
        return self.status is Status.VALUE


_MISSING = Quote(Status.MISSING, 0)

_STATUS_BY_CODE = {
    0: Status.VALUE,
    1: Status.WRONG_ABI,
    2: Status.REVERTED,
}


def _quotes(raw: list) -> list[Quote]:
    return [Quote(_STATUS_BY_CODE.get(int(s), Status.MISSING), int(v)) for s, v in raw]


class QuoterClient:
    """Talks to a RouteQuoter at `address` over any `Transport`."""

    def __init__(
        self,
        transport: Transport,
        address: str,
        *,
        overrides: dict | None = None,
        max_probes: int = MAX_PROBES,
        max_routes: int = MAX_ROUTES,
        max_all_legs: int = MAX_ALL_LEGS,
    ) -> None:
        self.transport = transport
        self.address = address
        self.overrides = overrides
        self.max_probes = max_probes
        self.max_routes = max_routes
        self.max_all_legs = max_all_legs

    @property
    def local(self) -> bool:
        """Is a quote cheap enough to spend thousands of them?

        The whole shape of the split search -- sampled curves, rationed rounds,
        a batch budget -- exists because a quote costs a round trip.  This is
        how `core/` asks without importing anything that knows about revm.
        """
        return bool(getattr(self.transport, "local", False))

    # ------------------------------------------------------------- probing

    def probe(self, probes: list[Probe]) -> list[Quote]:
        """Quote many independent points, chunked to the contract's limit.

        The chunks do not depend on one another, so they go out as one batch
        the transport may run concurrently -- worth 1.70x over a slow uplink,
        where a single stream leaves the link half idle.

        A chunk that comes back empty is halved and retried, then given up on
        per-call: an oversized batch or a node gas cap must not lose the other
        599 probes.  That fallback is sequential on purpose, since by then the
        batch is already suspect.
        """
        groups = [
            probes[lo : lo + self.max_probes]
            for lo in range(0, len(probes), self.max_probes)
        ]
        if not groups:
            return []
        payloads = [
            encode_call(SIG_PROBE_BATCH, [p.as_tuple() for p in group])
            for group in groups
        ]
        out: list[Quote] = []
        for group, raw in zip(
            groups, run_batch(self.transport, payloads, self.address, self.overrides),
            strict=True,
        ):
            out.extend(self._decode_probes(group, raw))
        return out

    def _decode_probes(self, probes: list[Probe], raw: bytes | None) -> list[Quote]:
        if raw is not None:
            try:
                decoded = decode([f"{RES_T}[]"], raw)[0]
            except Exception:
                decoded = None
            if decoded is not None:
                if len(decoded) != len(probes):
                    return [_MISSING] * len(probes)
                return _quotes(decoded)
        return self._probe_chunk(probes)

    def _probe_chunk(self, probes: list[Probe]) -> list[Quote]:
        if not probes:
            return []
        data = encode_call(SIG_PROBE_BATCH, [p.as_tuple() for p in probes])
        try:
            raw = self.transport.call(self.address, data, overrides=self.overrides)
            decoded = decode([f"{RES_T}[]"], raw)[0]
        except Exception:
            if len(probes) == 1:
                return [_MISSING]
            mid = len(probes) // 2
            return self._probe_chunk(probes[:mid]) + self._probe_chunk(probes[mid:])
        if len(decoded) != len(probes):
            return [_MISSING] * len(probes)
        return _quotes(decoded)

    # ------------------------------------------------------------- routing

    def quote_route(self, legs: list[Leg], amount_in: int, dst_slot: int) -> int:
        data = encode_call(
            SIG_QUOTE_ROUTE, [leg.as_tuple() for leg in legs], amount_in, dst_slot
        )
        raw = self.transport.call(self.address, data, overrides=self.overrides)
        return int(decode(["uint256"], raw)[0])

    def quote_routes(
        self,
        routes: list[list[Leg]],
        amounts_in: list[int],
        dst_slots: list[int],
    ) -> list[int]:
        """All candidates in one call.  0 means the candidate is unroutable.

        Chained `get_dy` cannot be batched by a plain multicall, so this is what
        turns 20 multi-hop candidates into one round trip instead of twenty.
        """
        if not (len(routes) == len(amounts_in) == len(dst_slots)):
            raise ValueError("routes, amounts_in and dst_slots must be the same length")
        out: list[int] = []
        for lo, hi in _batches(routes, self.max_routes, self.max_all_legs):
            out.extend(self._routes_chunk(routes[lo:hi], amounts_in[lo:hi], dst_slots[lo:hi]))
        return out

    def _routes_chunk(
        self, routes: list[list[Leg]], amounts_in: list[int], dst_slots: list[int]
    ) -> list[int]:
        if not routes:
            return []
        flat: list[tuple] = []
        bounds: list[int] = []
        for route in routes:
            flat.extend(leg.as_tuple() for leg in route)
            bounds.append(len(flat))
        data = encode_call(SIG_QUOTE_ROUTES, flat, bounds, list(amounts_in), list(dst_slots))
        try:
            raw = self.transport.call(self.address, data, overrides=self.overrides)
            decoded = decode(["uint256[]"], raw)[0]
        except Exception:
            if len(routes) == 1:
                return [0]
            mid = len(routes) // 2
            return self._routes_chunk(
                routes[:mid], amounts_in[:mid], dst_slots[:mid]
            ) + self._routes_chunk(routes[mid:], amounts_in[mid:], dst_slots[mid:])
        if len(decoded) != len(routes):
            return [0] * len(routes)
        return [int(v) for v in decoded]

    # ----------------------------------------------------------- raw reads

    def raw(self, calls: list[Call]) -> list[Answer]:
        """Batched arbitrary reads (balances, decimals, asset, maxDeposit...)."""
        groups = [
            calls[lo : lo + self.max_probes]
            for lo in range(0, len(calls), self.max_probes)
        ]
        if not groups:
            return []
        payloads = [
            encode_call(SIG_RAW_BATCH, [c.to for c in g], [c.data for c in g])
            for g in groups
        ]
        out: list[Answer] = []
        for group, raw in zip(
            groups, run_batch(self.transport, payloads, self.address, self.overrides),
            strict=True,
        ):
            out.extend(self._decode_raw(group, raw))
        return out

    def _decode_raw(self, calls: list[Call], raw: bytes | None) -> list[Answer]:
        if raw is not None:
            try:
                decoded = decode([f"{RES_T}[]"], raw)[0]
            except Exception:
                decoded = None
            if decoded is not None:
                if len(decoded) != len(calls):
                    return [Answer(Status.MISSING)] * len(calls)
                return _answers(decoded)
        return self._raw_chunk(calls)

    def _raw_chunk(self, calls: list[Call]) -> list[Answer]:
        if not calls:
            return []
        data = encode_call(
            SIG_RAW_BATCH, [c.to for c in calls], [c.data for c in calls]
        )
        try:
            raw = self.transport.call(self.address, data, overrides=self.overrides)
            decoded = decode([f"{RES_T}[]"], raw)[0]
        except Exception:
            if len(calls) == 1:
                return [Answer(Status.MISSING)]
            mid = len(calls) // 2
            return self._raw_chunk(calls[:mid]) + self._raw_chunk(calls[mid:])
        if len(decoded) != len(calls):
            return [Answer(Status.MISSING)] * len(calls)
        return _answers(decoded)


def _answers(decoded) -> list[Answer]:
    """Three-state results into `Answer`s.  Empty data is not a zero value."""
    out: list[Answer] = []
    for status_code, value in decoded:
        status = _STATUS_BY_CODE.get(int(status_code), Status.MISSING)
        payload = int(value).to_bytes(32, "big") if status is Status.VALUE else b""
        out.append(Answer(status, payload))
    return out


def _batches(routes: list[list[Leg]], max_routes: int, max_legs: int):
    """Yield (lo, hi) route ranges bounded by both count and total legs."""
    lo = 0
    while lo < len(routes):
        hi = lo
        legs = 0
        while hi < len(routes) and hi - lo < max_routes:
            n = len(routes[hi])
            if legs + n > max_legs and hi > lo:
                break
            legs += n
            hi += 1
        if hi == lo:  # a single route longer than max_legs; send it alone
            hi = lo + 1
        yield lo, hi
        lo = hi
