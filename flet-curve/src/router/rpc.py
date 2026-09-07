"""Batched JSON-RPC for the router, on this app's own transport.

`erouter.chain` asks for very little -- a batch of requests in, a list of
answers or exceptions out -- and asks for a great deal of it: warming a chain
is a few thousand `eth_getStorageAt` reads, which is a very different shape
from the one-request-at-a-time calls the rest of this app makes.

Three things here were measured on the router's side and are worth keeping:
one request at a time costs 33.6 ms *each* against 68 ms for two hundred in a
batch; a node refuses a batch past its own ceiling and refuses the **whole**
batch, so chunking is not optional; and several chunks in flight beat one,
because the limit is the round trip rather than the node.
"""

from __future__ import annotations

import asyncio

from curve.http import ApiError, post_json

#: Erigon's default, and geth phrases the same refusal.  The floor every
#: endpoint answers, and where chunking starts before `probe` has run.
BATCH_LIMIT = 100

#: What to ask for, largest first.  drpc serves 2,000 and Erigon refuses the
#: *whole* batch past 100, so assuming the floor is twenty times the round
#: trips on the endpoint this actually ships with -- 62 against 4 on one
#: mainnet sweep.  Worth one request to find out which it is.
BATCH_LADDER = (2000, 1000, 500, 200, BATCH_LIMIT)

#: Chunks in flight at once.  Four measured 3,979 ms serial against 2,334 ms
#: concurrent on the router's own sweep; eight is where the win flattens and
#: is still modest enough that a hosted endpoint has no cause to object.
#: Read by the caller too, to decide how much to hand over at a time -- less
#: than `batch_size * max_streams` and most of these sit idle.
MAX_STREAMS = 8

#: A sweep is thousands of reads and the endpoint is a load balancer, so a
#: dropped chunk is usually a bad backend rather than a bad request.
RETRIES = 1

#: Long, because a hundred storage reads in one request is a real amount of
#: work for a node and this is not on any interactive path.
TIMEOUT = 60.0


class RouterRpc:
    """The `erouter.chain.evm.AsyncRpc` protocol, over `curve.http`."""

    def __init__(self, url: str, chain_id: int, *,
                 max_streams: int = MAX_STREAMS, timeout: float = TIMEOUT):
        self.url = url
        self.chain_id = int(chain_id)
        self._timeout = timeout
        #: What one request may carry.  The floor until `probe` says better;
        #: read by the caller to size what it hands over.
        self.batch_size = BATCH_LIMIT
        self.max_streams = int(max_streams)
        self._streams = asyncio.Semaphore(max_streams)
        self.calls = 0
        self.batches = 0

    async def probe(self) -> int:
        """Ask this endpoint how much it will take in one request.

        With the method actually about to be sent, not a cheap stand-in: a
        node may cap by payload size or by method, and a ceiling learned from
        `eth_blockNumber` would not survive contact with a storage sweep.

        A refusal is the answer, so nothing here is an error -- the floor is
        already known to work.
        """
        sample = ("eth_getStorageAt", [_PROBE_ADDRESS, _PROBE_SLOT, "latest"])
        for size in BATCH_LADDER:
            if size <= self.batch_size and self.batch_size != BATCH_LIMIT:
                break
            got = await self._chunk([sample] * size)
            if len(got) == size and not any(isinstance(a, Exception) for a in got):
                self.batch_size = size
                return size
        return self.batch_size

    async def batch(self, requests) -> list:
        """One answer per request, in order, never raising for one of them.

        An `Exception` in a slot is how a single failure is reported -- the
        same three-state honesty `core.transport.Answer` keeps a level up, and
        for the same reason: a caller has to be able to tell "the node would
        not say" from "the answer is zero".
        """
        requests = list(requests)
        if not requests:
            return []
        size = max(1, self.batch_size)
        chunks = [requests[k:k + size] for k in range(0, len(requests), size)]
        got = await asyncio.gather(*(self._chunk(chunk) for chunk in chunks))
        return [answer for chunk in got for answer in chunk]

    async def call(self, method: str, params: list):
        answer = (await self.batch([(method, params)]))[0]
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def _chunk(self, requests: list) -> list:
        payload = [{"jsonrpc": "2.0", "id": k, "method": method, "params": params}
                   for k, (method, params) in enumerate(requests)]
        last: Exception | None = None
        for _ in range(RETRIES + 1):
            async with self._streams:
                self.batches += 1
                self.calls += len(requests)
                try:
                    answer = await post_json(self.url, payload, timeout=self._timeout)
                except ApiError as exc:
                    last = exc
                    continue
            return _unpack(answer, len(requests), payload)
        return [last or ApiError("the batch was never answered")] * len(requests)


#: The zero account, for asking an endpoint what size of batch it will take.
#: Any address does -- what is being measured is the batch, not the answer.
_PROBE_ADDRESS = "0x" + "00" * 20
_PROBE_SLOT = "0x" + "00" * 32


def _unpack(answer, count: int, payload: list) -> list:
    """Match a JSON-RPC batch reply to what was asked, by id.

    A node may answer a batch in any order, and some answer a malformed batch
    with a single object rather than a list -- which read positionally would
    hand every request its neighbour's answer.
    """
    if isinstance(answer, dict):
        answer = [answer]
    if not isinstance(answer, list):
        return [ApiError(f"unexpected batch reply: {type(answer).__name__}")] * count
    by_id = {row.get("id"): row for row in answer if isinstance(row, dict)}
    out: list = []
    for request in payload:
        row = by_id.get(request["id"])
        if row is None:
            out.append(ApiError(f"no answer for {request['method']}"))
        elif "error" in row:
            out.append(ApiError(str(row["error"])[:120]))
        else:
            out.append(row.get("result"))
    return out
