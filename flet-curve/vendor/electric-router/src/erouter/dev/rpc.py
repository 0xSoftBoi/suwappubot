"""JSON-RPC transport over stdlib urllib.

Implements `core.transport.Transport`.  Three things here are load-bearing and
were each established by measurement against the local Erigon node:

1.  **Never send a `gas` field.**  This node runs `rpc.gascap = 0` and answers a
    13,872-call batch when `gas` is omitted, but returns "out of gas" for an
    explicit `gas: 50_000_000` -- which is geth's *default* cap.  Omitting the
    field gets you the node's own limit, whatever it is.
2.  **Batch.**  A sequential `eth_getStorageAt` costs 33.6 ms even locally
    (per-request scheduling, not per-slot work); 200 of them in one JSON-RPC
    batch take 68 ms total.  Everything goes through `fetch_multi`.
3.  **Empty returndata is not a value.**  A Curve pool that lacks a function
    returns `0x` rather than reverting, so `Status.WRONG_ABI` is distinct from
    `Status.REVERTED`.  Six mainnet arcs are mis-typed by the Curve API today
    and are only caught by keeping them apart.
"""

from __future__ import annotations

import contextlib
import hashlib
import http.client
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from ..core.codec import decode, selector
from ..core.transport import Answer, Call, Status

USER_AGENT = "electric-router/0.1"

# JSON-RPC batches are chunked by both count and total calldata size; a chunk
# that fails outright is halved and retried before falling back per call.
DEFAULT_BATCH = 500
# "batch limit 100 exceeded (can increase by --rpc.batch.limit)" -- Erigon, and
# geth phrases it the same way.  Parsed so the ceiling is learned once.
_BATCH_LIMIT = re.compile(r"batch limit (\d+) exceeded")
# Concurrent HTTP streams for independent calls.  One stream does not fill a slow
# uplink: three 600-probe chunks measured 3,979 ms serial, 2,334 ms at once.
# Kept modest so a public endpoint does not read it as abuse.
#
# Eight rather than four because the win is consistency, not throughput.  Over
# six runs of `prepare`, the *minimum* barely moves past four -- the node is
# execution-bound on a batch that large -- while the spread halves.  Sixteen is
# better still and is what `local_evm` uses for its own sweep of thousands of
# tiny reads, but that is a burst against a node someone chose; this default is
# what every endpoint sees.
DEFAULT_STREAMS = 8
# Between attempts at an unanswered request.  Zero on the first retry: a stalled
# socket is already gone and the next one is fresh, so there is nothing to wait
# for.  It grows only for the 429/5xx case, where there is.
STALL_BACKOFF = 0.5
MAX_BATCH_BYTES = 16 << 20


class RpcError(RuntimeError):
    def __init__(self, message: str, code: int | None = None, data: Any = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.data = data


class RpcStalled(RpcError):
    """Accepted and never answered, after every attempt.

    Its own type because the two failures want opposite treatment: an
    oversized batch is halved, and halving a stall just spreads it over twice
    as many requests that can each stall again.
    """


@dataclass(frozen=True, slots=True)
class Pin:
    """A block, resolved exactly once and threaded through every stage.

    Nothing downstream may see "latest": all candidates must be quoted at the
    same block or the winner is noise.
    """

    chain_id: int
    block: int
    url: str

    @property
    def hex_block(self) -> str:
        return hex(self.block)


_ERROR_SEL = selector("Error(string)")
_PANIC_SEL = selector("Panic(uint256)")


def revert_reason(data: Any) -> str:
    """Best-effort decode of revert returndata (same shape as yb-core's helper)."""
    if isinstance(data, str) and data.startswith("0x"):
        try:
            raw = bytes.fromhex(data[2:])
        except ValueError:
            return data
        if raw[:4] == _ERROR_SEL:
            try:
                return str(decode(["string"], raw[4:])[0])
            except Exception:
                return data
        if raw[:4] == _PANIC_SEL:
            try:
                return f"Panic(0x{decode(['uint256'], raw[4:])[0]:x})"
            except Exception:
                return data
        return data
    return "" if data is None else str(data)


@dataclass(slots=True)
class RpcStats:
    """What the transport actually spent, for telling network from compute."""

    round_trips: int = 0
    seconds: float = 0.0
    bytes_sent: int = 0
    stalls: int = 0

    @property
    def mean_ms(self) -> float:
        return self.seconds / self.round_trips * 1000 if self.round_trips else 0.0

    def reset(self) -> None:
        self.round_trips = 0
        self.seconds = 0.0
        self.bytes_sent = 0
        self.stalls = 0


#: Endpoint capabilities, between runs.  Gitignored: this is a property of
#: whichever node the machine talks to, not of the repository.
CAPS_PATH = Path(__file__).resolve().parents[3] / ".cache" / "endpoints.json"


def _endpoint_key(url: str) -> str:
    """A stable name for an endpoint that is not the endpoint.

    The URL carries the API key, so it never reaches disk -- only a digest of
    it does, which is enough to recognise the same endpoint again.
    """
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _read_caps() -> dict:
    try:
        return json.loads(CAPS_PATH.read_text())
    except (OSError, ValueError):
        return {}


def _remembered_ceiling(url: str) -> int | None:
    got = _read_caps().get(_endpoint_key(url), {}).get("batch")
    return int(got) if isinstance(got, int) and got > 0 else None


def _remember_ceiling(url: str, size: int) -> None:
    caps = _read_caps()
    caps[_endpoint_key(url)] = {"batch": int(size)}
    try:
        CAPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        CAPS_PATH.write_text(json.dumps(caps, indent=1, sort_keys=True) + "\n")
    except OSError:
        pass          # a cache that cannot be written is not an error


def _forget_ceiling(url: str) -> None:
    caps = _read_caps()
    if caps.pop(_endpoint_key(url), None) is None:
        return
    with contextlib.suppress(OSError):
        CAPS_PATH.write_text(json.dumps(caps, indent=1, sort_keys=True) + "\n")



class JsonRpcTransport:
    """Read-only JSON-RPC client pinned to a block."""

    def __init__(
        self,
        url: str,
        block: int | str = "latest",
        *,
        timeout: float = 45.0,
        attempts: int = 4,
        batch_size: int = DEFAULT_BATCH,
        max_streams: int = DEFAULT_STREAMS,
        chain_id: int | None = None,
    ) -> None:
        self.url = url
        self.timeout = timeout
        self.attempts = attempts
        self.batch_size = batch_size
        self._batch_ceiling: int | None = None
        self.max_streams = max_streams
        self._id = 0
        self._id_lock = Lock()
        # Before the first fetch below: `_post` accounts into it.
        self.stats = RpcStats()
        # The chain table already knows this, and a key scoped to a narrow
        # method list may not serve `eth_chainId` at all -- asking is a
        # courtesy check, not a requirement.
        if chain_id is None:
            try:
                chain_id = int(self.fetch("eth_chainId", []), 16)
            except Exception as exc:
                # Say which question was refused.  The scoped endpoint does not
                # serve `eth_chainId`, so every caller that omitted it -- the
                # route sweep among them -- failed at construction with a bare
                # "HTTP Error 500" naming neither the method nor the fix.
                raise RpcError(
                    f"{url.rsplit('/', 1)[0]}/... will not answer eth_chainId "
                    f"({str(exc)[:60]}); pass chain_id= from the chain table"
                ) from exc
        resolved = (
            int(self.fetch("eth_blockNumber", []), 16) if block == "latest" else int(block)
        )
        self.pin = Pin(chain_id=chain_id, block=resolved, url=url)

    # ---------------------------------------------------------------- Transport

    @property
    def block(self) -> int:
        return self.pin.block

    def gas_price(self) -> int:
        """Live gas price in wei, or 0 if the node will not say."""
        try:
            return int(self.fetch("eth_gasPrice", []), 16)
        except Exception:
            return 0

    @property
    def chain_id(self) -> int:
        return self.pin.chain_id

    def call(self, to: str, data: bytes, *, overrides: dict | None = None) -> bytes:
        params: list[Any] = [self._tx(to, data), self.pin.hex_block]
        if overrides:
            params.append(overrides)
        return _to_bytes(self.fetch("eth_call", params))

    #: JSON-RPC batch ceiling.  Erigon rejects the *whole* batch when it is over
    #: the limit rather than truncating it, so an unchunked call returns nothing
    #: at all -- and `_answer` turns "nothing" into a failed answer, which every
    #: caller is entitled to read as "this contract does not implement that
    #: method".
    #
    # Measured on 378 `stored_rates()` calls: 378 in one batch yielded 0 usable
    # answers, 100 yielded 61, and the same 378 chunked by 50 yielded the correct
    # 197.  It is also *flaky*, so the symptom was rate-bearing stableswap pools
    # silently falling back to decimals-only rates and being rejected as if their
    # maths were wrong.
    BATCH_LIMIT = 50

    def call_many(self, calls: list[Call], *, overrides: dict | None = None) -> list[Answer]:
        out: list[Answer] = []
        for lo in range(0, len(calls), self.BATCH_LIMIT):
            payloads = []
            for c in calls[lo : lo + self.BATCH_LIMIT]:
                params: list[Any] = [self._tx(c.to, c.data), self.pin.hex_block]
                if overrides:
                    params.append(overrides)
                payloads.append(("eth_call", params))
            out.extend(_answer(r) for r in self.fetch_multi(payloads))
        return out

    def call_batch(
        self, requests: list[bytes], *, to: str, overrides: dict | None = None
    ) -> list[bytes | None]:
        """Independent eth_calls, one connection each, issued concurrently.

        Threads rather than async because `urllib` is blocking and this is the
        only place in the codebase that waits on more than one socket.
        """
        if len(requests) <= 1:
            return [self._try_call(d, to=to, overrides=overrides) for d in requests]
        workers = min(len(requests), self.max_streams)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(
                pool.map(lambda d: self._try_call(d, to=to, overrides=overrides), requests)
            )

    def _try_call(self, data: bytes, *, to: str, overrides: dict | None) -> bytes | None:
        try:
            return self.call(to, data, overrides=overrides)
        except Exception:
            return None

    # -------------------------------------------------------------------- wire

    @staticmethod
    def _tx(to: str, data: bytes) -> dict[str, str]:
        # No "gas" key -- see the module docstring.
        return {"to": to, "data": "0x" + data.hex()}

    def _post(self, body: Any) -> Any:
        payload = json.dumps(body).encode()
        self.stats.round_trips += 1
        self.stats.bytes_sent += len(payload)
        started = time.perf_counter()
        try:
            return self._post_inner(payload)
        finally:
            self.stats.seconds += time.perf_counter() - started

    def _post_inner(self, payload: bytes) -> Any:
        """Ask, and ask again if the answer never comes.

        An endpoint that accepts a request and goes quiet is the common remote
        failure, not a rare one: measured on base, one read in twenty stalled
        for the whole timeout while its neighbours came back in 50 ms.  A new
        request gets a new connection, so a retry is all the recovery needed.

        A status code is an answer and is not retried, except the two that say
        "later": 429 and 5xx.
        """
        last = ""
        for attempt in range(self.attempts):
            request = urllib.request.Request(
                self.url,
                data=payload,
                headers={"Content-Type": "application/json",
                         "User-Agent": USER_AGENT},
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as exc:
                if exc.code < 500 and exc.code != 429:
                    raise RpcError(f"transport failure: {exc}") from exc
                last = f"{exc.code} {exc.reason}"
            except (urllib.error.URLError, TimeoutError, OSError,
                    http.client.HTTPException) as exc:
                last = str(getattr(exc, "reason", exc)) or type(exc).__name__
            self.stats.stalls += 1
            if attempt + 1 < self.attempts:
                time.sleep(STALL_BACKOFF * attempt)
        raise RpcStalled(
            f"no answer in {self.attempts} attempts of {self.timeout:g}s: {last}")

    def fetch(self, method: str, params: list[Any]) -> Any:
        self._id += 1
        result = self._post({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        if isinstance(result, dict) and result.get("error"):
            err = result["error"]
            raise RpcError(err.get("message", str(err)), err.get("code"), err.get("data"))
        return result["result"]

    def fetch_multi(
        self, payloads: list[tuple[str, list[Any]]], *, concurrent: bool = False
    ) -> list[Any]:
        """Batched JSON-RPC.  Returns one entry per payload, in order.

        An entry is the raw result, or an `RpcError` for a per-call failure --
        never raised, because a failed quote is arc removal, not an error.

        `concurrent` issues the chunks on separate connections.  It matters
        whenever the node caps a batch well below the work in hand: a storage
        sweep of 4,071 slots is 42 chunks at the usual ceiling, and in sequence
        those round trips dominate everything.
        """
        out: list[Any] = [None] * len(payloads)
        spans = list(_chunks(payloads, self.batch_size))
        if not concurrent or len(spans) <= 1:
            for lo, hi in spans:
                self._fetch_chunk(payloads, lo, hi, out)
            return out
        workers = min(len(spans), self.max_streams)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(lambda span: self._fetch_chunk(payloads, span[0], span[1], out), spans))
        return out

    def _fetch_chunk(
        self, payloads: list[tuple[str, list[Any]]], lo: int, hi: int, out: list[Any]
    ) -> None:
        # One contiguous id block per chunk, allocated atomically: responses
        # are matched by `first_id + offset`, so two threads interleaving their
        # allocations would silently mis-pair results with requests.
        with self._id_lock:
            first_id = self._id + 1
            self._id += hi - lo
        body = [
            {"jsonrpc": "2.0", "id": first_id + (i - lo),
             "method": payloads[i][0], "params": payloads[i][1]}
            for i in range(lo, hi)
        ]
        try:
            responses = self._post(body)
            if not isinstance(responses, list):
                raise RpcError(f"expected a batch response, got {type(responses).__name__}")
            by_id = {r.get("id"): r for r in responses}
            for i in range(lo, hi):
                entry = by_id.get(first_id + (i - lo))
                if entry is None:
                    out[i] = RpcError("missing from batch response")
                elif entry.get("error"):
                    err = entry["error"]
                    out[i] = RpcError(
                        err.get("message", str(err)), err.get("code"), err.get("data")
                    )
                else:
                    out[i] = entry.get("result")
        except RpcStalled as exc:
            # Halving would turn one unanswered request into two that can each
            # go unanswered; the retries above have already had their turn.
            for i in range(lo, hi):
                out[i] = exc
        except RpcError as exc:
            if hi - lo == 1:
                out[lo] = exc
                return
            # A node that caps batch size says so, and says the number.  Learn
            # it instead of rediscovering it by halving on every call: at the
            # 500 default against Erigon's 100, each chunk failed four times
            # before fitting, turning a 4,071-slot sweep into ~135 requests.
            self._learn_batch_limit(exc)
            # Halve and retry: an oversized or out-of-gas batch is the common
            # cause, and one bad call must not drop its 499 neighbours.
            mid = (lo + hi) // 2
            self._fetch_chunk(payloads, lo, mid, out)
            self._fetch_chunk(payloads, mid, hi, out)

    #: Batch sizes to try when asking an endpoint what it will take, largest
    #: first.  Erigon's default ceiling is 100 and it refuses the *whole* batch
    #: over it; drpc serves 2,000.  Twenty times the requests is what that
    #: difference costs, so it is worth one round trip to find out.
    BATCH_LADDER = (2000, 1000, 500, 200, 100, 50)

    def probe_batch_limit(self, sample: tuple[str, list] | None = None) -> int:
        """The largest batch this endpoint answers, measured once and kept.

        Probed with the request actually about to be sent, not a cheap stand-in:
        a node may cap by payload size or by method, and a ceiling learned from
        `eth_blockNumber` would not survive contact with a storage sweep.

        Remembered between runs, because measuring it costs 1.2 s of a cold start
        and the answer is a property of the endpoint rather than of the block.  A
        remembered ceiling that is too high is not dangerous: the batch is
        rejected, `_learn_batch_limit` reads the real cap out of the error and
        lowers it, and the entry is dropped so the next run measures again.
        """
        if self._batch_ceiling is not None:
            return self._batch_ceiling
        remembered = _remembered_ceiling(self.url)
        if remembered:
            self._batch_ceiling = remembered
            return remembered
        probe = sample or ("eth_blockNumber", [])
        stalled = False
        for size in self.BATCH_LADDER:
            if size > self.batch_size and self._batch_ceiling is None:
                pass  # still worth asking: batch_size is a default, not a limit
            try:
                got = self._post([{"jsonrpc": "2.0", "id": i + 1,
                                   "method": probe[0], "params": probe[1]}
                                  for i in range(size)])
            except RpcStalled:
                # Silence is not a refusal.  Step down so the run proceeds, but
                # do not write it down: a ceiling cached from one bad minute
                # would halve every later run against a healthy endpoint.
                stalled = True
                continue
            except Exception:
                continue
            if isinstance(got, list) and len(got) == size and not any(
                    isinstance(r, dict) and r.get("error") for r in got):
                self._batch_ceiling = size
                if not stalled:
                    _remember_ceiling(self.url, size)
                return size
        self._batch_ceiling = self.BATCH_LADDER[-1]
        return self._batch_ceiling

    def _learn_batch_limit(self, exc: RpcError) -> None:
        match = _BATCH_LIMIT.search(str(exc))
        if not match:
            return
        limit = int(match.group(1))
        with self._id_lock:
            if 0 < limit < self.batch_size:
                self.batch_size = limit
                # What was remembered is wrong; measure again next time rather
                # than keep paying for a batch this endpoint will reject.
                _forget_ceiling(self.url)

    # ------------------------------------------------------------ capabilities

    def supports_state_override(self) -> bool:
        """Can we inject the quoter's bytecode instead of deploying it?"""
        scratch = "0x" + "ee" * 20
        # PUSH1 0x2a PUSH1 0x00 MSTORE PUSH1 0x20 PUSH1 0x00 RETURN
        code = "0x602a60005260206000f3"
        try:
            result = self.fetch(
                "eth_call",
                [{"to": scratch, "data": "0x"}, self.pin.hex_block, {scratch: {"code": code}}],
            )
        except RpcError:
            return False
        return _to_bytes(result)[-1:] == b"\x2a"

    def supports_debug_trace(self) -> bool:
        """prestateTracer availability decides boa's fork prefetch setting."""
        try:
            self.fetch(
                "debug_traceCall",
                [
                    {"to": "0x" + "00" * 20, "data": "0x"},
                    self.pin.hex_block,
                    {"tracer": "prestateTracer"},
                ],
            )
        except RpcError:
            return False
        return True

    def supports_batching(self) -> bool:
        results = self.fetch_multi([("eth_chainId", []), ("eth_blockNumber", [])])
        return all(not isinstance(r, RpcError) for r in results)


# ----------------------------------------------------------------- helpers


def _chunks(items: list[Any], size: int):
    """Yield (lo, hi) index ranges bounded by count and serialized size."""
    lo = 0
    while lo < len(items):
        hi = lo
        nbytes = 0
        while hi < len(items) and hi - lo < size:
            nbytes += len(json.dumps(items[hi]))
            if nbytes > MAX_BATCH_BYTES and hi > lo:
                break
            hi += 1
        yield lo, hi
        lo = hi


def _to_bytes(value: Any) -> bytes:
    if not isinstance(value, str) or not value.startswith("0x"):
        return b""
    return bytes.fromhex(value[2:])


def _answer(result: Any) -> Answer:
    if isinstance(result, RpcError):
        message = revert_reason(result.data) or result.message
        if "transport failure" in result.message or "missing from batch" in result.message:
            return Answer(Status.MISSING, message=result.message)
        return Answer(Status.REVERTED, message=message)
    raw = _to_bytes(result)
    if len(raw) == 0:
        return Answer(Status.WRONG_ABI)
    return Answer(Status.VALUE, raw)
