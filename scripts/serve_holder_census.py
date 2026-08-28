#!/usr/bin/env python3
import concurrent.futures
import json
import os
from collections import Counter
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import suwappu_holder_census as c


def main():
    latest, logs, holders = c.reconstruct()
    try:
        supply = int(c.rpc("eth_call", [{"to": c.TOKEN, "data": "0x18160ddd"}, "latest"]), 16)
    except Exception:
        supply = 100_000_000_000 * (10 ** c.DECIMALS)

    profiles = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        fs = [ex.submit(c.enrich, h, supply, i + 1) for i, h in enumerate(holders)]
        for i, f in enumerate(concurrent.futures.as_completed(fs), 1):
            profiles.append(f.result())
            if i % 50 == 0:
                print(f"ENRICH {i}/{len(holders)}", flush=True)
    profiles.sort(key=lambda p: p["rank"])

    contracts = sum(1 for p in profiles if p.get("is_contract"))
    source_counts = Counter()
    for p in profiles:
        e = p.get("first_suwappu_transfer") or {}
        cp = (e.get("counterparty") or "").lower() if isinstance(e, dict) else ""
        if cp:
            source_counts[cp] += 1

    payload = {
        "meta": {
            "token": c.TOKEN,
            "chain": "Base",
            "latest_block": latest,
            "scan_start_block": c.START_BLOCK,
            "transfer_log_count": len(logs),
            "holder_count": len(holders),
            "total_supply_raw": str(supply),
        },
        "summary": {
            "profiles": len(profiles),
            "explorer_is_contract_count": contracts,
            "top_initial_token_counterparties": source_counts.most_common(25),
        },
        "profiles": profiles,
    }

    with open("suwappu-holder-census.json", "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
    print("ARTIFACT_READY suwappu-holder-census.json", flush=True)

    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), SimpleHTTPRequestHandler)
    print(f"SERVING {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
