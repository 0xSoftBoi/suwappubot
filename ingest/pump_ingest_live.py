"""Live-first Pump/PumpSwap collector.

The original collector correctly refused to skip a gap, but on a high-volume
program that can turn an old cursor into an endless RPC loop. This entrypoint
keeps all canonical storage/decoding logic and changes only cursor recovery:
try a bounded catch-up, then explicitly re-anchor to the live head instead of
repeating the same historical scan forever.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Any, Dict, List, Optional

from pump_ingest import Collector as BaseCollector
from pump_ingest import Target

LOG = logging.getLogger("pump_ingest")


class Collector(BaseCollector):
    async def signatures_since(self, target: Target, cursor: Optional[str]) -> List[Dict[str, Any]]:
        # First boot: deliberately ingest only the bounded recent window.
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

        for _ in range(self.max_catchup_pages):
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

        # Stale cursor recovery. A live signal system cannot spend every cycle
        # replaying an unbounded historical gap. Re-anchor to a recent bounded
        # window, ingest it, and let ingest_target advance the canonical cursor
        # to the newest observed signature. Historical backfill can be a
        # separate low-priority worker later without blocking live telemetry.
        live_limit = min(self.page_limit, self.bootstrap_limit)
        LOG.warning(
            "stale cursor program=%s scanned=%s signatures without reaching cursor; "
            "re-anchoring to live head window=%s",
            target.label,
            len(collected),
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
    )
    asyncio.run(run_collector())


if __name__ == "__main__":
    main()
