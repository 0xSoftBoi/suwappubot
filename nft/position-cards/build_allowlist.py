#!/usr/bin/env python3
"""Build the Merkle allowlist for the Suwappu Positions mint.

A spot is EARNED from real Suwappu usage — XP level, lifetime volume, swap count,
referrals — not handed out for a retweet. The bot already tracks all of it, so the
allowlist is a snapshot of people who actually used the product.

  # from the live bot database
  python3 nft/position-cards/build_allowlist.py --from-db

  # or from a snapshot file: [{"address": "0x..", "xp_level": "gold", ...}, ...]
  python3 nft/position-cards/build_allowlist.py --input snapshot.json

Emits allowlist/<phase>.json — the Merkle root for configurePhase(), plus a proof
per address for the mint UI.

THE FAILURE THIS GUARDS AGAINST: an allowlist whose total grants exceed the phase
allocation. That was the standard 2021-22 mistake — a "guaranteed" list that was
really a race, which produced a gas war and a lot of angry holders. This script
refuses to emit such a list unless --oversubscribe is passed explicitly.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from merkle import build_tree, leaf_for, proof_for, root_of, verify  # noqa: E402

FOUNDER, ALLOWLIST = "Founder", "Allowlist"


def load_config() -> dict:
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def classify(row: dict) -> str | None:
    """Which phase a user has earned. Founder beats Allowlist."""
    level = str(row.get("xp_level") or "").lower()
    volume = float(row.get("total_volume_usd") or 0)
    swaps = int(row.get("total_swaps") or 0)
    referrals = int(row.get("referrals") or 0)

    if level in ("gold", "platinum", "diamond") or volume >= 50_000 or referrals >= 5:
        return FOUNDER
    if swaps >= 5 or volume >= 1_000 or referrals >= 1:
        return ALLOWLIST
    return None


def rows_from_db() -> list[dict]:
    """Snapshot every user with an EVM wallet and their earned signals."""
    sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
    from bot.models.points import UserPoints
    from bot.models.user import User, Wallet
    from database.db import get_session

    out = []
    with get_session() as session:
        q = (
            session.query(User, UserPoints)
            .outerjoin(UserPoints, UserPoints.user_id == User.id)
            .all()
        )
        for user, pts in q:
            wallet = (
                session.query(Wallet)
                .filter(Wallet.user_id == user.id, Wallet.chain_type == "evm")
                .first()
            )
            if not wallet or not wallet.address:
                continue
            referrals = 0
            try:
                from bot.models.referral import Referral

                referrals = session.query(Referral).filter(Referral.referrer_id == user.id).count()
            except Exception:
                pass
            out.append(
                {
                    "address": wallet.address,
                    "xp_level": getattr(pts, "level", None) if pts else None,
                    "total_volume_usd": getattr(pts, "total_volume_usd", 0) if pts else 0,
                    "total_swaps": getattr(pts, "total_swaps", 0) if pts else 0,
                    "referrals": referrals,
                }
            )
    return out


def build_phase(name: str, entries: list[tuple[str, int]], allocation: int, oversubscribe: bool):
    """entries = [(address, max_qty)]. Returns the artefact dict."""
    seen, deduped = set(), []
    for addr, qty in entries:
        key = addr.lower()
        if key in seen:  # one grant per address, keep the largest
            for d in deduped:
                if d[0].lower() == key:
                    d[1] = max(d[1], qty)
            continue
        seen.add(key)
        deduped.append([addr, qty])

    granted = sum(q for _a, q in deduped)
    if granted > allocation and not oversubscribe:
        raise SystemExit(
            f"{name}: {len(deduped)} addresses granted {granted} cards but the phase "
            f"allocation is {allocation}. An allowlist bigger than its allocation is a "
            f"race, not a guarantee — trim the list, raise the allocation, or pass "
            f"--oversubscribe if a race is genuinely intended."
        )

    leaves = [leaf_for(a, q) for a, q in deduped]
    layers = build_tree(leaves)
    root = root_of(layers)

    proofs = {}
    for addr, qty in deduped:
        leaf = leaf_for(addr, qty)
        pr = proof_for(layers, leaf)
        if not verify(pr, root, leaf):
            raise SystemExit(f"{name}: self-check failed for {addr}")
        proofs[addr.lower()] = {"max_qty": qty, "proof": ["0x" + p.hex() for p in pr]}

    return {
        "phase": name,
        "merkle_root": "0x" + root.hex(),
        "addresses": len(deduped),
        "granted_cards": granted,
        "allocation": allocation,
        "utilisation": round(granted / allocation, 3) if allocation else None,
        "leaf_encoding": "keccak256(keccak256(abi.encode(address,uint256 maxQty)))",
        "proofs": proofs,
    }


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--from-db", action="store_true", help="snapshot the live bot database")
    src.add_argument("--input", help="snapshot JSON file")
    ap.add_argument("--out", default=os.path.join(HERE, "allowlist"))
    ap.add_argument("--oversubscribe", action="store_true", help="allow grants > allocation")
    args = ap.parse_args()

    cfg = load_config()
    phases = cfg["mint"]["phases"]

    if args.from_db:
        try:
            rows = rows_from_db()
        except Exception as e:
            raise SystemExit(f"database snapshot failed: {e}")
    else:
        with open(args.input) as f:
            rows = json.load(f)
    if not rows:
        raise SystemExit("snapshot is empty — nothing to build")

    buckets: dict[str, list[tuple[str, int]]] = {FOUNDER: [], ALLOWLIST: []}
    for row in rows:
        phase = classify(row)
        if not phase:
            continue
        addr = row.get("address")
        if not addr or not str(addr).startswith("0x") or len(addr) != 42:
            continue
        buckets[phase].append((addr, phases[phase]["wallet_cap"]))

    os.makedirs(args.out, exist_ok=True)
    for name, entries in buckets.items():
        if not entries:
            print(f"{name}: no qualifying addresses — skipped")
            continue
        art = build_phase(name, entries, phases[name]["allocation"], args.oversubscribe)
        path = os.path.join(args.out, f"{name.lower()}.json")
        with open(path, "w") as f:
            json.dump(art, f, indent=1)
        print(
            f"{name}: {art['addresses']} addresses · {art['granted_cards']}/"
            f"{art['allocation']} cards ({art['utilisation']:.0%}) · root {art['merkle_root']}"
        )
        print(f"  -> {path}")

    print("\nnext: configurePhase(<phase>, <root>, price, walletCap, allocation, start, end)")


if __name__ == "__main__":
    main()
