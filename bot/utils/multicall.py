"""Multicall3 batched balance fetching.

Multicall3 is deployed at the same address on 100+ EVM chains. This module
batches N `balanceOf(holder)` calls plus the native balance
(`getEthBalance(holder)`) into a single eth_call via `aggregate3` with
allowFailure=true per inner call, so one bad token doesn't fail the batch.
"""

import asyncio
import logging

from web3 import Web3

logger = logging.getLogger(__name__)

MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

# Key used in the result dict for the native (gas token) balance.
NATIVE_KEY = "native"

MULTICALL3_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {"name": "target", "type": "address"},
                    {"name": "allowFailure", "type": "bool"},
                    {"name": "callData", "type": "bytes"},
                ],
                "name": "calls",
                "type": "tuple[]",
            }
        ],
        "name": "aggregate3",
        "outputs": [
            {
                "components": [
                    {"name": "success", "type": "bool"},
                    {"name": "returnData", "type": "bytes"},
                ],
                "name": "returnData",
                "type": "tuple[]",
            }
        ],
        "stateMutability": "payable",
        "type": "function",
    },
    {
        "inputs": [{"name": "addr", "type": "address"}],
        "name": "getEthBalance",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

ERC20_BALANCEOF_ABI = [
    {
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]


def _get_web3(web3_or_rpc_url) -> Web3:
    if isinstance(web3_or_rpc_url, str):
        return Web3(Web3.HTTPProvider(web3_or_rpc_url, request_kwargs={"timeout": 5}))
    return web3_or_rpc_url


# Building a contract object parses its ABI and constructs the function
# namespace and codec — real CPU, and it was being paid three times per
# multicall. This is the hottest loop on python-worker (every wallet × chain,
# every refresh pass), so the encoders are built once at import instead.
#
# Calldata encoding is pure ABI work that never touches the network and never
# varies by chain, so one provider-less Web3 serves every chain. Only the
# aggregate3 *call* needs a chain-bound contract, and that one is built per
# call because it must ride the caller's provider.
_ENCODER_W3 = Web3()
MULTICALL3_CHECKSUM = Web3.to_checksum_address(MULTICALL3_ADDRESS)
_MULTICALL3_ENCODER = _ENCODER_W3.eth.contract(address=MULTICALL3_CHECKSUM, abi=MULTICALL3_ABI)
_ERC20_ENCODER = _ENCODER_W3.eth.contract(abi=ERC20_BALANCEOF_ABI)


def build_aggregate3_calls(
    w3: Web3, holder_address: str, token_addresses: list[str]
) -> tuple[list[tuple[str, bool, bytes]], list[str]]:
    """Build the aggregate3 call tuples and the parallel result-key list.

    Returns (calls, keys) where keys[i] is NATIVE_KEY or the original token
    address corresponding to calls[i].
    """
    holder = Web3.to_checksum_address(holder_address)

    calls: list[tuple[str, bool, bytes]] = []
    keys: list[str] = []

    # Native balance via Multicall3's getEthBalance helper
    native_data = _MULTICALL3_ENCODER.encode_abi("getEthBalance", args=[holder])
    calls.append((MULTICALL3_CHECKSUM, True, bytes.fromhex(native_data[2:])))
    keys.append(NATIVE_KEY)

    balanceof_data = bytes.fromhex(_ERC20_ENCODER.encode_abi("balanceOf", args=[holder])[2:])
    for token_addr in token_addresses:
        calls.append((Web3.to_checksum_address(token_addr), True, balanceof_data))
        keys.append(token_addr)

    return calls, keys


def _multicall_balances_sync(
    web3_or_rpc_url, holder_address: str, token_addresses: list[str]
) -> dict[str, int]:
    w3 = _get_web3(web3_or_rpc_url)
    calls, keys = build_aggregate3_calls(w3, holder_address, token_addresses)

    # Bound to the caller's provider because this one actually makes the call.
    multicall = w3.eth.contract(address=MULTICALL3_CHECKSUM, abi=MULTICALL3_ABI)
    results = multicall.functions.aggregate3(calls).call()

    balances: dict[str, int] = {}
    for key, (success, return_data) in zip(keys, results):
        if not success or not return_data or len(return_data) < 32:
            # Reverted / empty inner call — omit so caller can fall back per-token
            continue
        balances[key] = int.from_bytes(return_data[:32], byteorder="big")
    return balances


async def multicall_balances(
    web3_or_rpc_url, holder_address: str, token_addresses: list[str]
) -> dict[str, int]:
    """Fetch native + ERC-20 raw balances in ONE eth_call via Multicall3.

    Returns a dict mapping NATIVE_KEY and each token address (as passed in)
    to raw integer balances. Failed/reverted inner calls are omitted.
    Raises on full-call failure (e.g. chain without Multicall3, RPC error) —
    callers should fall back to per-token fetching.
    """
    return await asyncio.to_thread(
        _multicall_balances_sync, web3_or_rpc_url, holder_address, token_addresses
    )
