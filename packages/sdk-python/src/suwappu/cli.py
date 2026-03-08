"""CLI entry point for the Suwappu SDK.

Usage:
    suwappu get_quote ETH USDC 1.0 arbitrum
    suwappu execute_swap quote_abc123
    suwappu get_portfolio [chain]
    suwappu get_prices ETH [chain]
    suwappu list_chains
    suwappu list_tokens arbitrum

Works with: uv run suwappu, uvx suwappu, or pip install suwappu && suwappu
"""

from __future__ import annotations

import asyncio
import json
import sys

from suwappu.client import create_client


def _serialize(obj: object) -> str:
    if hasattr(obj, "model_dump"):
        return json.dumps(obj.model_dump(), indent=2)  # type: ignore[union-attr]
    if isinstance(obj, list):
        return json.dumps(
            [x.model_dump() if hasattr(x, "model_dump") else x for x in obj],
            indent=2,
        )
    return json.dumps(obj, indent=2)


async def _run(args: list[str]) -> None:
    if not args:
        _print_help()
        return

    command, *rest = args
    client = create_client()

    try:
        match command:
            case "get_quote":
                if len(rest) < 4:
                    print("Usage: suwappu get_quote <from> <to> <amount> <chain>", file=sys.stderr)
                    sys.exit(1)
                from_tok, to_tok, amount, chain = rest[0], rest[1], rest[2], rest[3]
                result = await client.get_quote(from_tok, to_tok, float(amount), chain)
                print(_serialize(result))

            case "execute_swap":
                if not rest:
                    print("Usage: suwappu execute_swap <quote_id>", file=sys.stderr)
                    sys.exit(1)
                result = await client.execute_swap(rest[0])
                print(_serialize(result))

            case "get_portfolio":
                chain = rest[0] if rest else None
                result = await client.get_portfolio(chain)
                print(_serialize(result))

            case "get_prices":
                if not rest:
                    print("Usage: suwappu get_prices <token> [chain]", file=sys.stderr)
                    sys.exit(1)
                token = rest[0]
                chain = rest[1] if len(rest) > 1 else None
                result = await client.get_prices(token, chain)
                print(_serialize(result))

            case "list_chains":
                result = await client.list_chains()
                print(_serialize(result))

            case "list_tokens":
                if not rest:
                    print("Usage: suwappu list_tokens <chain>", file=sys.stderr)
                    sys.exit(1)
                result = await client.list_tokens(rest[0])
                print(_serialize(result))

            case _:
                print(f"Unknown command: {command}", file=sys.stderr)
                _print_help()
                sys.exit(1)
    finally:
        await client.close()


def _print_help() -> None:
    print("""suwappu — Cross-chain DEX SDK for AI agents

Commands:
  get_quote <from> <to> <amount> <chain>   Get swap quote
  execute_swap <quote_id>                   Execute a swap
  get_portfolio [chain]                     Check balances
  get_prices <token> [chain]                Token prices
  list_chains                               Supported chains
  list_tokens <chain>                       Tokens on a chain

Environment:
  SUWAPPU_API_KEY    Your API key (from POST /v1/agent/register)

Install:
  uv add suwappu     # or: pip install suwappu""")


def main() -> None:
    asyncio.run(_run(sys.argv[1:]))


if __name__ == "__main__":
    main()
