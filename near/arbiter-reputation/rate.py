#!/usr/bin/env python3
"""Score workers from edges.json (written by extract.py).

  python3 rate.py <seed-account> [<seed-account> ...]

Seeds are the buyers YOU choose to trust (e.g. verified orgs). With no seeds every rating is 0: the rule never
invents trust. Prints each worker's max-flow rating in NEAR.
"""
import json, sys
from flowrep import ratings

edges = json.load(open("edges.json"))
att = [{"buyer": x["buyer"], "worker": x["worker"], "amount": int(x["amount_yocto"]) / 1e24, "rubric": x["rubric"]}
       for x in edges if x["attested"]]
seeds = sys.argv[1:]
workers = sorted({e["worker"] for e in att})
print(f"attested edges: {len(att)} | seeds: {seeds or 'NONE'}")
for w, r in sorted(ratings(att, seeds, workers).items(), key=lambda kv: -kv[1]):
    print(f"  {w}: {r:.4f} NEAR")
