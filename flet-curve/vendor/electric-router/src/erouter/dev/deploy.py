"""Put a contract on every chain at one address, from one keystore.

Everything here is contract-agnostic: CREATE2 through the canonical proxy, the
funding report, signing and sending without boa in the request path, Etherscan
verification, and the sweep that runs the lot.  What differs between contracts
-- where the source is, what salt it deploys under, and what proves it works
once it is there -- arrives as a `Target`.

Two scripts supply one each: `deploy_quoter.py` and `deploy_router.py`.  They
share this because a deployment is the one thing in the repo that cannot be
re-run to fix a mistake, and two copies of it means two places to get it wrong.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from getpass import getpass
from pathlib import Path
from time import sleep

REPO = Path(__file__).resolve().parent.parent.parent.parent

# The canonical deterministic-deployment proxy: CREATE2 with `salt` as the first
# 32 bytes of calldata and the initcode as the rest.  Checked on every chain in
# the table and present on all sixteen.
#
# This is what makes production affordable.  A scoped drpc endpoint gates
# `eth_call` by target address -- measured, a non-whitelisted target answers HTTP
# 403 -- so every chain needs its quoter whitelisted, and a key holds at most ten
# addresses against fifteen chains.  CREATE2 fixes the address from (proxy, salt,
# initcode) alone, so one recipe puts the contract at the *same* address
# everywhere and one whitelist entry covers the lot.
CREATE2_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C"

#: Etherscan's v2 endpoint: one host, one key, `chainid` selecting the explorer.
#: Not every chain in the table is served by it -- xlayer, tac and etherlink
#: answer "unsupported chainid" -- and that is not the same as unverified.
ETHERSCAN_API = "https://api.etherscan.io/v2/api"

#: How far over the chain's own estimate the gas limit is set.  Enough for a
#: pool that shifts between estimating and mining, far below any block limit.
GAS_MARGIN = 1.25

#: Chains not worth the gas, and why.  Printed rather than silently skipped:
#: a chain missing from a deployment sweep should say so.
UNSUPPORTED = {
    "etherlink": "rejects state overrides and access lists, and its tracer "
                 "output cannot be decoded -- a quoter there would still be "
                 "wire-only",
}


@dataclass(frozen=True, slots=True)
class Target:
    """What to deploy, and how to know it works."""

    #: Shown in output, and the noun in "N/M chains carry the ___".
    label: str
    contract: Path
    #: The salt carries the version, so changing the contract is a deliberate
    #: new address rather than a silent collision with a whitelist entry that no
    #: longer describes what is deployed.
    salt_phrase: str
    #: What the deployed runtime must equal.  The quoter reads a committed copy
    #: from disk so the check does not depend on the compiler agreeing with
    #: itself; anything else compiles.
    runtime: Callable[[], bytes] | None = None
    #: `(address, chain, url, args, on_fork) -> int`, zero if it works.  Runs
    #: after the bytecode comparison, and is the difference between "deployed"
    #: and "usable".
    check: Callable[..., int] | None = None
    #: `(address) -> None`, printed after a successful broadcast.
    next_steps: Callable[[str], None] | None = None
    #: Chains this contract has no business on, beyond `UNSUPPORTED`.
    skip: dict[str, str] = field(default_factory=dict)

    def initcode(self) -> bytes:
        import boa

        return boa.load_partial(str(self.contract)).compiler_data.bytecode

    def expected_runtime(self) -> bytes:
        import boa

        if self.runtime is not None:
            return self.runtime()
        return boa.load_partial(str(self.contract)).compiler_data.bytecode_runtime


def account_address(name: str) -> str:
    """The keystore's address, without decoding anything.

    A brownie keystore holds its address in clear next to the encrypted key, so
    asking "where does the deployer need funding" costs no passphrase -- which
    decides whether it is worth typing one.
    """
    path = os.path.expanduser(os.path.join("~", ".brownie", "accounts", name + ".json"))
    if not os.path.exists(path):
        raise SystemExit(f"no keystore at {path}")
    with open(path) as handle:
        return "0x" + json.load(handle)["address"].lower().removeprefix("0x")


def account_load(name: str):
    """A brownie keystore, decoded at the prompt.  Never a plaintext key."""
    from eth_account import account

    path = os.path.expanduser(os.path.join("~", ".brownie", "accounts", name + ".json"))
    if not os.path.exists(path):
        raise SystemExit(f"no keystore at {path}")
    with open(path) as handle:
        key = account.decode_keyfile_json(json.load(handle), getpass(f"passphrase for {name}: "))
    return account.Account.from_key(key)


#: Etherscan's several ways of saying the job is already done.  Matched
#: case-insensitively: the v2 API answers "Contract source code already
#: verified" in lower case, which a match on "Already Verified" misses -- so a
#: *success* was retried six times and then reported as a failure.
ALREADY_VERIFIED = ("already verified", "already been verified")

#: Chains whose explorer is a Blockscout, and where it lives.
#:
#: Verifying on Etherscan is not the same as being verified where anyone
#: looks.  Etherscan retired gnosisscan.io and the domain now serves
#: Blockscout, so a chain-100 submission to the v2 API succeeds, reads back as
#: verified, and the address still shows "Verify & publish" to every visitor.
#: tac is the other way round: v2 does not serve chain 239 at all, and its
#: Blockscout does.
#:
#: Both explorers are submitted to where both exist -- a chain is verified when
#: the place people open it is, not when one API says so.
BLOCKSCOUT = {
    "ethereum": "https://eth.blockscout.com",
    "gnosis": "https://gnosisscan.io",
    "optimism": "https://explorer.optimism.io",
    "polygon": "https://polygon.blockscout.com",
    "tac": "https://explorer.tac.build",
}


def explorer_ask(chain_id: int, key: str, form: dict | None = None, **params) -> dict:
    """One call to the v2 API, with `chainid` in the query string either way.

    That last part is the whole reason this is hand-rolled rather than boa's
    verifier: v2 reads `chainid` from the query for a POST as well as a GET,
    and boa sends it in the form body.  So every submission that was not to
    mainnet came back "Missing or unsupported chainid parameter", six times,
    and a good deployment was reported as one that could not be verified.
    """
    import urllib.parse
    import urllib.request

    query = urllib.parse.urlencode({"chainid": chain_id, "apikey": key, **params})
    body = urllib.parse.urlencode({**form, "apikey": key}).encode() if form else None
    request = urllib.request.Request(f"{ETHERSCAN_API}?{query}", data=body,
                                     headers={"User-Agent": "erouter"})
    with urllib.request.urlopen(request, timeout=60) as handle:
        return json.load(handle)


def explorer_source(chain_id: int, address: str, key: str) -> str | None:
    """The source the explorer holds for `address`, or None if it holds none.

    Three answers, and the third is why this exists: a chain the v2 API does
    not serve raises, rather than reporting an address as unverified that it
    was never asked about.
    """
    answer = explorer_ask(chain_id, key, module="contract",
                          action="getsourcecode", address=address)
    result = answer.get("result")
    if isinstance(result, str):             # NOTOK, and the string is the why
        raise RuntimeError(result)
    return result[0].get("SourceCode") or None


def submit_source(chain_id: int, address: str, contract: Path, key: str) -> str:
    """Post the standard-json bundle; returns the guid to poll."""
    import boa

    solc = boa.load_partial(str(contract)).solc_json
    entry = next(k for k, v in solc["settings"]["outputSelection"].items() if "*" in v)
    version = re.match(r"v?(\d+\.\d+\.\d+)", solc["compiler_version"])
    if version is None:
        raise RuntimeError(f"no vyper version in {solc['compiler_version']}")
    answer = explorer_ask(chain_id, key, form={
        "module": "contract", "action": "verifysourcecode",
        "codeformat": "vyper-json", "sourceCode": json.dumps(solc),
        # Both contracts are constructor-free, which is also what makes the
        # CREATE2 address the initcode's alone.
        "constructorArguments": "", "contractaddress": address,
        "contractname": f"{entry}:{contract.stem}",
        "compilerversion": f"vyper:{version.group(1)}",
        "optimizationUsed": "1", "licenseType": "1",
    })
    if answer.get("status") != "1":
        raise RuntimeError(str(answer.get("result") or answer))
    return answer["result"]


def await_verification(chain_id: int, guid: str, key: str,
                       attempts: int = 40, pause: int = 5) -> str:
    """Poll until the queue says something other than "pending"."""
    for _ in range(attempts):
        sleep(pause)
        answer = explorer_ask(chain_id, key, module="contract",
                              action="checkverifystatus", guid=guid)
        result = str(answer.get("result"))
        if "pending" not in result.lower():
            return result
    return "still pending in the queue"


def standard_json(contract: Path) -> tuple[dict, str]:
    """The vyper standard-input bundle, and the compiler that made it.

    boa hangs `compiler_version` and `integrity` off the same dict.  Etherscan
    ignores the extras; Blockscout hands the bundle to vyper, which does not.
    """
    import boa

    solc = boa.load_partial(str(contract)).solc_json
    keep = ("language", "sources", "settings")
    return {k: v for k, v in solc.items() if k in keep}, solc["compiler_version"]


def blockscout_source(host: str, address: str) -> str | None:
    """The source this Blockscout holds, or None.  404 means it has never
    seen the address, which is not the same as holding no source for it."""
    import urllib.error
    import urllib.request

    request = urllib.request.Request(f"{host}/api/v2/smart-contracts/{address}",
                                     headers={"User-Agent": "erouter"})
    try:
        with urllib.request.urlopen(request, timeout=30) as handle:
            answer = json.load(handle)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} -- is the address indexed here?") from exc
    return answer.get("source_code") if answer.get("is_verified") else None


def blockscout_submit(host: str, address: str, contract: Path) -> None:
    """Post the bundle as multipart, which is the only shape it accepts."""
    import urllib.request
    import uuid

    bundle, version = standard_json(contract)
    boundary = uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; "
        f"name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        for name, value in (("compiler_version", version), ("license_type", "none"))
    ]
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"files[0]\"; "
        f"filename=\"standard.json\"\r\nContent-Type: application/json\r\n\r\n".encode()
        + json.dumps(bundle).encode() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())

    request = urllib.request.Request(
        f"{host}/api/v2/smart-contracts/{address}/verification/via/"
        f"vyper-standard-input", data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                 "User-Agent": "erouter"})
    with urllib.request.urlopen(request, timeout=60) as handle:
        answer = json.load(handle)
    # It answers with the job it started.  Anything else means it started none,
    # and the poll that follows would spend a minute discovering that.
    if "started" not in str(answer.get("message", "")).lower():
        raise RuntimeError(str(answer)[:200])


def blockscout_verify(host: str, address: str, contract: Path,
                      attempts: int = 20, pause: int = 5) -> bool:
    """Submit, then poll the contract itself -- there is no job to ask about."""
    import urllib.error

    try:
        if blockscout_source(host, address):
            print(f"  already verified on {host}")
            return True
        blockscout_submit(host, address, contract)
    except (RuntimeError, OSError, urllib.error.HTTPError) as exc:
        print(f"  ! {host}: {str(exc)[:80]}")
        return False
    for _ in range(attempts):
        sleep(pause)
        if blockscout_source(host, address):
            print(f"  verified on {host}")
            return True
    print(f"  ! {host}: submitted, still not showing as verified")
    return False


def verify_with_retries(chain_id: int, address: str, contract: Path, key: str,
                        attempts: int = 6, pause: int = 10,
                        settle: int = 10) -> bool:
    """Etherscan needs the code indexed before it will look at it.

    Retries exist for that indexing delay and nothing else.  `settle` is the
    wait before the *first* attempt, which a deployment mined seconds ago needs
    and an address that has been on chain for a week does not.  "Already
    verified" is the desired end state -- CREATE2 puts identical bytecode on
    every chain, so the second chain onward is often verified on submission.
    """
    sleep(settle)
    for attempt in range(attempts):
        try:
            result = await_verification(
                chain_id, submit_source(chain_id, address, contract, key), key)
        except (RuntimeError, OSError) as exc:
            result = str(exc)
        if result.lower().startswith("pass") or any(
                phrase in result.lower() for phrase in ALREADY_VERIFIED):
            print(f"  verified -- {result}")
            return True
        print(f"  verify attempt {attempt + 1}/{attempts}: {result}")
        if attempt + 1 < attempts:
            sleep(pause)
    print("  ! not verified -- the deployment is still good, verify by hand")
    return False


def verify_one(target: Target, name: str, args) -> int:
    """Publish the source for a contract already on chain.

    Verification is not part of a deployment, however much the `--verify` flag
    makes it look like one.  A deployment happens once; a chain whose explorer
    was down that afternoon, or one the sweep submitted to the wrong `chainid`,
    still has unverified bytecode weeks later and no reason to be redeployed.
    So it is its own pass, over the address CREATE2 already fixed.

    Every explorer the chain has, not the first that answers: gnosis is served
    by Etherscan's API and shown to people by Blockscout, and satisfying one
    left the other displaying "Verify & publish".

    It refuses on a runtime mismatch rather than submitting: an explorer
    showing source that is not the code there is worse than one showing none.
    """
    from erouter.chain import chains as chain_table
    from erouter.core.keccak import keccak256
    from erouter.dev import config
    from erouter.dev.rpc import JsonRpcTransport

    chain = chain_table.get(name)
    address = args.address or create2_address(
        keccak256(args.salt.encode()), target.initcode())
    print(f"{chain.name} (chain {chain.chain_id})  {address}")

    answer = JsonRpcTransport(
        config.rpc_url(chain.rpc_attr), chain_id=chain.chain_id).fetch(
        "eth_getCode", [address, "latest"]) or "0x"
    on_chain = bytes.fromhex(answer[2:])
    expected = bytes(target.expected_runtime())
    if not on_chain:
        print(f"  ! no {target.label} deployed here -- nothing to verify")
        return 1
    if on_chain != expected:
        print(f"  ! runtime differs: {len(on_chain):,} on chain vs "
              f"{len(expected):,} compiled -- refusing to publish a source "
              f"that is not the code")
        return 1

    done = []
    key = getattr(config.networks(), "ETHERSCAN_API_KEY", None)
    if not key:
        print("  ! no ETHERSCAN_API_KEY in networks.py")
        done.append(False)
    else:
        try:
            if explorer_source(chain.chain_id, address, key):
                print("  already verified on etherscan")
                done.append(True)
            else:
                done.append(verify_with_retries(
                    chain.chain_id, address, target.contract, key, settle=0))
        except (RuntimeError, OSError) as exc:
            # Not a failure where Blockscout is the chain's explorer anyway.
            print(f"  - etherscan does not serve this chain: {str(exc)[:60]}")
            done.append(name in BLOCKSCOUT)

    if name in BLOCKSCOUT:
        done.append(blockscout_verify(BLOCKSCOUT[name], address, target.contract))
    return 0 if all(done) else 1


def create2_address(salt: bytes, initcode: bytes, proxy: str = CREATE2_PROXY) -> str:
    """Where CREATE2 through `proxy` puts this initcode -- on any chain."""
    from erouter.core.keccak import keccak256

    body = b"\xff" + bytes.fromhex(proxy[2:]) + salt + keccak256(initcode)
    return "0x" + keccak256(body)[12:].hex()


def funding_estimate(url: str, chain_id: int, payload: bytes, sender: str | None):
    """(gas, gas price, native cost) for this deployment, from the chain itself.

    Printed before anything is sent, because the question when deploying across
    fourteen chains is not "did it work" but "how much does each one need".
    """
    from erouter.dev.rpc import JsonRpcTransport

    rpc = JsonRpcTransport(url, chain_id=chain_id)
    tx = {"to": CREATE2_PROXY, "data": "0x" + payload.hex()}
    if sender:
        tx["from"] = sender
    try:
        gas = int(rpc.fetch("eth_estimateGas", [tx]), 16)
    except Exception:
        # What the EVM charges to store code, plus the transaction itself.
        # Only used when the node will not estimate for an unfunded sender.
        gas = 21_000 + 200 * len(payload)
    price = rpc.gas_price()
    # The *limit*, not the estimate.  A sender must hold `limit * price` up
    # front wherever the surplus is refunded, and monad does not refund it: its
    # receipts burn the limit exactly.  Pricing the estimate said monad needed
    # 0.242 MON for a deployment that cost 0.303, so the next one was short.
    return gas, price, int(gas * GAS_MARGIN) * price / 1e18


def funding_report(target: Target, names: list[str], deployer: str, salt_phrase: str) -> int:
    """Balance against deployment cost, per chain.  Sends nothing, asks nothing.

    The sweep needs the deployer funded on every chain at once, and a chain
    discovered to be short *during* it is the expensive way to find out -- the
    passphrase is typed and half the chains are done.
    """
    from erouter.chain import chains as chain_table
    from erouter.core.keccak import keccak256
    from erouter.dev import config
    from erouter.dev.rpc import JsonRpcTransport

    initcode = target.initcode()
    salt = keccak256(salt_phrase.encode())
    address = create2_address(salt, initcode)
    print(f"  deployer  {deployer}")
    print(f"  {target.label:<9} {address} (once deployed)\n")
    print(f"  {'chain':<11} {'native':<8} {'balance':>14} {'needs':>12} {'short by':>12}")
    print("  " + "-" * 62)

    short: list[str] = []
    for name in names:
        chain = chain_table.get(name)
        try:
            rpc = JsonRpcTransport(config.rpc_url(chain.rpc_attr), chain_id=chain.chain_id)
            balance = int(rpc.fetch("eth_getBalance", [deployer, "latest"]), 16) / 1e18
            if bytes.fromhex(
                (rpc.fetch("eth_getCode", [address, "latest"]) or "0x")[2:]
            ):
                print(f"  {name:<11} {chain.native_symbol:<8} {'-':>14} "
                      f"{'deployed':>12} {'':>12}")
                continue
            _, _, cost = funding_estimate(
                config.rpc_url(chain.rpc_attr), chain.chain_id, salt + initcode, deployer)
        except Exception as exc:
            print(f"  {name:<11} {'':<8} {'':>14} {'':>12}   ! {str(exc)[:28]}")
            short.append(name)
            continue
        # Twice what the limit costs: gas prices move between reading one and
        # sending a transaction, and a sweep that dies half way through is
        # worse than one that asks for a little more up front.
        want = cost * 2
        gap = max(0.0, want - balance)
        print(f"  {name:<11} {chain.native_symbol:<8} {balance:>14.6f} {want:>12.6f} "
              f"{(f'{gap:.6f}' if gap else '-'):>12}")
        if gap:
            short.append(name)

    if short:
        print(f"\n  {len(short)} chain(s) need funding: {', '.join(short)}")
    else:
        print("\n  every chain is funded; deploy with --chain all --create2 --broadcast")
    return 0 if not short else 1


def send_create2(url: str, chain, account, payload: bytes, gas: int) -> str:
    """Sign the proxy call and send it, without boa in the way.

    `NetworkEnv.execute_code` re-forks at `latest` before every send so it can
    simulate first, then reads account state at that block.  Monad produces
    blocks faster than a load balancer converges, so the backend answering the
    state read had not seen the block the head came from, and the deployment
    died with "26: Unknown block" -- having simulated nothing and sent nothing.

    None of that is needed here: the contract has no constructor, the fork
    rehearsal has already proved it deploys, and the gas limit comes from the
    chain's own estimate.  Sending directly also drops boa's `safe`-block
    assumption, which polygon's endpoint does not serve either.
    """
    from erouter.dev.rpc import JsonRpcTransport

    rpc = JsonRpcTransport(url, chain_id=chain.chain_id)
    nonce = int(rpc.fetch("eth_getTransactionCount", [account.address, "pending"]), 16)
    block = rpc.fetch("eth_getBlockByNumber", ["latest", False])
    tx = {"chainId": chain.chain_id, "nonce": nonce, "to": CREATE2_PROXY,
          "value": 0, "data": "0x" + payload.hex(), "gas": gas}
    base_fee = block.get("baseFeePerGas") if isinstance(block, dict) else None
    if base_fee is not None:
        tip = int(rpc.fetch("eth_maxPriorityFeePerGas", []), 16)
        tx |= {"type": 2, "maxPriorityFeePerGas": tip,
               "maxFeePerGas": 2 * int(base_fee, 16) + tip}
    else:  # a chain that never adopted EIP-1559
        tx["gasPrice"] = rpc.gas_price()
    signed = account.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    tx_hash = rpc.fetch("eth_sendRawTransaction", ["0x" + bytes(raw).hex()])
    print(f"  tx        {tx_hash}")

    for _ in range(60):
        sleep(2)
        receipt = rpc.fetch("eth_getTransactionReceipt", [tx_hash])
        if receipt:
            ok = int(receipt.get("status", "0x0"), 16) == 1
            used = int(receipt.get("gasUsed", "0x0"), 16)
            print(f"  receipt   block {int(receipt['blockNumber'], 16):,}  "
                  f"gas used {used:,}  {'ok' if ok else 'REVERTED'}")
            if not ok:
                raise SystemExit("  ! the deployment transaction reverted")
            return tx_hash
    raise SystemExit(f"  ! no receipt for {tx_hash} after two minutes")


def fork_at_head(url: str, chain_id: int, holding: str = "") -> int:
    """Fork a few blocks behind head, and say where.

    `allow_dirty` because a sweep forks once per chain and the previous fork
    still holds the contract it just rehearsed deploying; without it every chain
    after the first fails with "Cannot fork with dirty state".  Nothing is
    carried over -- each fork starts from that chain's head.  Pinned to a real
    block rather than boa's default `safe` tag, which polygon's endpoint does
    not serve and which would drop that chain.

    `holding` is an address the fork must already have code at, for the case
    that lag is not a safety margin but the whole problem: a contract broadcast
    seconds ago is not in a block five back.  On ethereum that is a minute, and
    a fork taken there answers every call to it with `0x`, which decodes into a
    `DecodeError` that reads like a broken contract.  Wait for it instead.
    """
    import boa

    from erouter.dev.rpc import JsonRpcTransport

    rpc = JsonRpcTransport(url, chain_id=chain_id)
    at = rpc.pin.block - 5
    if holding:
        for _ in range(30):
            answer = rpc.fetch("eth_getCode", [holding, hex(at)]) or "0x"
            if len(answer) > 2:
                break
            sleep(2)
            at = JsonRpcTransport(url, chain_id=chain_id).pin.block
        else:
            raise SystemExit(
                f"  ! {holding} still has no code at block {at:,} after a "
                f"minute; the deployment landed but this node has not caught up")
    boa.fork(url, block_identifier=at, allow_dirty=True)
    return at


def deploy_one(target: Target, name: str, args, account=None) -> int:
    import boa

    from erouter.chain import chains as chain_table
    from erouter.dev import config

    chain = chain_table.get(name)
    url = config.rpc_url(chain.rpc_attr)
    expected = target.expected_runtime()
    print(f"{chain.name} (chain {chain.chain_id})")
    print(f"  contract  {target.contract.relative_to(REPO)}  "
          f"({len(expected):,} bytes runtime)")
    print(f"  mode      {'BROADCAST' if args.broadcast else 'fork rehearsal'}")

    if args.broadcast:
        boa.set_network_env(url)
        boa.env.add_account(account)
        deployer = account
        print(f"  deployer  {deployer.address}")
    else:
        fork_at_head(url, chain.chain_id)
        boa.env.eoa = boa.env.generate_address()
        deployer = None
        print(f"  deployer  {boa.env.eoa} (fork)")

    plain = None
    if args.create2:
        from erouter.core.keccak import keccak256

        initcode = target.initcode()
        salt = keccak256(args.salt.encode())
        address = create2_address(salt, initcode)
        print(f"  salt      {args.salt!r} -> 0x{salt.hex()}")
        print(f"  proxy     {CREATE2_PROXY}")
        print(f"\n  deterministic address {address}")
        if not bytes(boa.env.get_code(CREATE2_PROXY)):
            print("  ! the deterministic proxy is not deployed on this chain")
            return 1
        existing = bytes(boa.env.get_code(address))
        if existing:
            # Re-running across fourteen chains must be safe: a chain that is
            # already done should say so and cost nothing, not revert half way
            # through the sweep.
            print(f"  already deployed ({len(existing):,} bytes) -- nothing to send")
        else:
            gas, price, cost = funding_estimate(
                url, chain.chain_id, salt + initcode,
                deployer.address if deployer else None)
            limit = int(gas * GAS_MARGIN)
            print(f"  cost      {limit:,} gas limit at {price / 1e9:,.3f} gwei "
                  f"= {cost:.6f} {chain.native_symbol} to hold")
            # Send the gas limit rather than letting it be inferred.  A node
            # that will not estimate leaves the block gas limit as the
            # fallback, and the sender must hold `limit * max_fee` up front
            # whatever the transaction actually burns.  On monad that is
            # 150,000,000 * 202 gwei = 30.3 MON against a 1.0 MON deployer, so
            # it failed with "Insufficient funds for gas * price + value" while
            # the real cost was 0.364 MON.  base survives the same fallback
            # only because 400M gas at 0.01 gwei is 0.004 ETH.
            print(f"  sending {len(salt) + len(initcode):,} bytes through the proxy "
                  f"with a {limit:,} gas limit")
            if args.broadcast:
                send_create2(url, chain, deployer, salt + initcode, limit)
            else:
                boa.env.execute_code(CREATE2_PROXY, data=salt + initcode,
                                     gas=limit, is_modifying=True)
    else:
        plain = boa.load(str(target.contract))
        address = str(plain.address)
        print(f"\n  deployed at {address}")

    # Same bytes the repo has been measuring against?  A mismatch means the
    # deployed contract is not the one every number here was taken from.
    #
    # Read from the chain when broadcasting: the send goes out over the wire,
    # so boa's env never learns about it and would report the code it last
    # forked -- which is nothing.
    if args.broadcast:
        from erouter.dev.rpc import JsonRpcTransport

        answer = JsonRpcTransport(url, chain_id=chain.chain_id).fetch(
            "eth_getCode", [address, "latest"]) or "0x"
        on_chain = bytes.fromhex(answer[2:])
    else:
        on_chain = boa.env.get_code(address)
    if bytes(on_chain) != bytes(expected):
        print(f"  ! runtime differs: {len(on_chain):,} on chain vs "
              f"{len(expected):,} compiled")
        return 1
    print(f"  runtime matches the compiled bytecode ({len(expected):,} bytes)")

    unproven = False
    if target.check is not None and target.check(
            address, chain, url, args, on_fork=not args.broadcast):
            # The contract is on chain and its runtime matched; only the trade
            # that would have proved it usable could not be made.  Worth an
            # exit code, but not worth calling the deployment a failure.
            unproven = True

    if args.broadcast and args.verify:
        key = getattr(config.networks(), "ETHERSCAN_API_KEY", None)
        if key:
            verify_with_retries(chain.chain_id, address, target.contract, key)
        else:
            print("  ! no ETHERSCAN_API_KEY in networks.py; skipping verification")

    if args.broadcast:
        if target.next_steps is not None:
            target.next_steps(address)
    else:
        print("\n  fork rehearsal only -- nothing was broadcast.")
        print("  re-run with --broadcast (and --verify) when you want it on chain.")
    return 2 if unproven else 0


def run(target: Target, description: str) -> int:
    """The CLI every deployment shares."""
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--chain", default="ethereum",
        help="a chain name, or 'all' for every chain that can be served",
    )
    parser.add_argument("--account", default="babe", help="brownie keystore name")
    parser.add_argument(
        "--broadcast", action="store_true",
        help="send the transaction. Without it, this deploys on a fork and "
             "throws the result away, which is the safe way to rehearse",
    )
    parser.add_argument("--verify", action="store_true", help="submit to Etherscan")
    parser.add_argument(
        "--verify-only", action="store_true",
        help="publish the source for what is already deployed and do nothing "
             "else -- no fork, no passphrase, no transaction",
    )
    parser.add_argument(
        "--address",
        help="what to verify, if not the --create2 address for this salt",
    )
    parser.add_argument(
        "--create2", action="store_true",
        help="deploy through the deterministic proxy, so it lands on the same "
             "address on every chain and costs one whitelist entry instead of "
             "fifteen",
    )
    parser.add_argument(
        "--salt", default=target.salt_phrase,
        help="salt phrase for --create2; changing it changes the address",
    )
    parser.add_argument(
        "--funding", action="store_true",
        help="report the deployer's balance against what each chain's "
             "deployment costs, and stop. Needs no passphrase",
    )
    args = parser.parse_args()

    from erouter.chain import chains as chain_table

    skipped = UNSUPPORTED | target.skip
    if args.chain == "all":
        wanted = [n for n in chain_table.CHAINS if n not in skipped]
        for name, why in skipped.items():
            print(f"  skipping {name}: {why}\n")
    else:
        wanted = [args.chain]

    if args.funding:
        return funding_report(target, wanted, account_address(args.account), args.salt)

    # Once, not once per chain: a fourteen-chain sweep should ask for the
    # passphrase a single time.
    account = account_load(args.account) if args.broadcast else None

    results: dict[str, int] = {}
    for name in wanted:
        try:
            results[name] = (verify_one(target, name, args) if args.verify_only
                             else deploy_one(target, name, args, account))
        except Exception as exc:
            # In full, with the traceback.  This was truncated to 100
            # characters, which is how monad failed the sweep without leaving
            # any evidence of why -- a deployment script that swallows the one
            # message worth having is worse than one that crashes.
            import traceback

            print(f"  ! {name} failed: {type(exc).__name__}: {exc}")
            traceback.print_exc()
            results[name] = 1
        print()

    if len(wanted) > 1 and args.verify_only:
        done = [n for n, code in results.items() if code == 0]
        print(f"  {len(done)}/{len(wanted)} explorers hold the {target.label} source")
        for name, code in results.items():
            if code:
                print(f"    ! {name} -- not verified")
    elif len(wanted) > 1:
        # Two different failures, and conflating them once reported fifteen
        # landed deployments as three.  Code 2 means the contract is on chain
        # with a matching runtime and only the trade could not be made.
        landed = [n for n, code in results.items() if code in (0, 2)]
        unproven = [n for n, code in results.items() if code == 2]
        print(f"  {len(landed)}/{len(wanted)} chains carry the {target.label}")
        for name, code in results.items():
            if code == 1:
                print(f"    ! {name} -- did not deploy")
        if unproven:
            print(f"  {len(unproven)} deployed but unproven: {', '.join(unproven)}")
            print(f"    the {target.label} is there and its runtime matches; no "
                  f"trade could be made to exercise it")
    return 0 if all(code == 0 for code in results.values()) else 1
