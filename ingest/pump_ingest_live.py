"""Live-first Pump/PumpSwap collector.

Keeps canonical storage/decoding from pump_ingest.py, but makes liveness the
priority for the signal product. A stale cursor gets only a small bounded scan
before we explicitly re-anchor to the live head. Historical backfill must never
block current telemetry or burn the free RPC budget.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
from typing import Any, Dict, List, Optional

from pump_ingest import Collector as BaseCollector
from pump_ingest import Target

LOG = logging.getLogger("pump_ingest")


class Collector(BaseCollector):
    def __init__(self) -> None:
        super().__init__()
        # Production used to allow 500 pages, which meant up to 125k signatures
        # were re-read every failed cycle. Live telemetry should spend at most a
        # few pages determining whether a cursor is still nearby.
        self.live_catchup_pages = min(self.max_catchup_pages, 4)

    async def signatures_since(self, target: Target, cursor: Optional[str]) -> List[Dict[str, Any]]:
        if cursor is None:
            result = await self.rpc(
                "getSignaturesForAddress",
                [target.program_id, {
                    "limit": min(self.page_limit, self.bootstrap_limit),
                    "commitment": "confirmed",
                }],
            )
            return result or []

        collected: List[Dict[str, Any]] = []
        before: Optional[str] = None
        found = False

        for _ in range(self.live_catchup_pages):
            opts: Dict[str, Any] = {
                "limit": self.page_limit,
                "commitment": "confirmed",
            }
            if before:
                opts["before"] = before
            page = await self.rpc("getSignaturesForAddress", [target.program_id, opts]) or []
            if not page:
                break

            for item in page:
                if item.get("signature") == cursor:
                    found = True
                    break
                collected.append(item)

            if found:
                break
            if len(page) < self.page_limit:
                break
            before = page[-1].get("signature")

        if found or not collected:
            return collected

        live_limit = min(self.page_limit, self.bootstrap_limit)
        LOG.warning(
            "stale cursor program=%s scanned=%s signatures across=%s pages; re-anchoring live window=%s",
            target.label,
            len(collected),
            self.live_catchup_pages,
            live_limit,
        )
        live = await self.rpc(
            "getSignaturesForAddress",
            [target.program_id, {
                "limit": live_limit,
                "commitment": "confirmed",
            }],
        )
        return live or []


async def run_collector() -> None:
    collector = Collector()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, setattr, collector, "running", False)
        except (NotImplementedError, RuntimeError):
            pass
    await collector.run()


def main() -> None:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )
    asyncio.run(run_collector())


if __name__ == "__main__":
    main()
