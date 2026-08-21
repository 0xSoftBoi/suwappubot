"""Shared rig for minting Position cards in the EVM suites.

Paid mints go through EIP-3009 now, not `msg.value`: the payer signs a USDG
authorization and a RELAYER submits it, so a wallet holding tokenized equities
and no ETH can still mint. These helpers build that signature the way a real
wallet would, so the tests exercise the production path rather than a shortcut.
"""

ONE_USDG = 10**6


def wire_payments(w3, art, pos, owner, treasury, payer, deploy):
    """Deploy MockUSDG, point the collection at it, and fund the payer."""
    usdg = deploy("MockUSDG")
    pos.functions.setUsdg(usdg.address).transact({"from": owner})
    pos.functions.setTreasury(treasury).transact({"from": owner})
    usdg.functions.mint(payer, 10_000 * ONE_USDG).transact({"from": owner})
    return usdg


def sign_authorization(w3, usdg, acct, to, value, nonce, valid_after=0, valid_before=None):
    """Sign an EIP-3009 ReceiveWithAuthorization exactly as a wallet would.

    Receive-, not Transfer-: USDG requires `to == msg.sender`, so `to` is the
    COLLECTION and only it can settle. The transfer variant would let any
    observer burn the nonce and move the payer's USDG with no card minted.
    """
    if valid_before is None:
        valid_before = w3.eth.get_block("latest").timestamp + 3600
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "ReceiveWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "ReceiveWithAuthorization",
        "domain": {
            "name": "Global Dollar",
            "version": "1",
            "chainId": w3.eth.chain_id,
            "verifyingContract": usdg.address,
        },
        "message": {
            "from": acct.address,
            "to": to,
            "value": value,
            "validAfter": valid_after,
            "validBefore": valid_before,
            "nonce": nonce,
        },
    }
    signed = acct.sign_typed_data(full_message=typed)
    r = signed.r.to_bytes(32, "big") if isinstance(signed.r, int) else signed.r
    s = signed.s.to_bytes(32, "big") if isinstance(signed.s, int) else signed.s
    return (valid_after, valid_before, signed.v, r, s)


def authorized_mint(
    w3,
    pos,
    usdg,
    payer_acct,
    phase,
    ticker,
    qty,
    submitter,
    max_qty=0,
    proof=None,
    allow_unpriced=True,
    value=None,
    gas=4_000_000,
):
    """Sign and submit a paid mint. `submitter` pays the gas, `payer_acct` gets
    the cards — that split IS the feature."""
    proof = proof or []
    cost = value if value is not None else pos.functions.quote(phase, qty).call()
    seq = pos.functions.mintSeq(payer_acct.address).call()
    nonce = pos.functions.mintNonce(payer_acct.address, phase, ticker, qty, seq).call()
    va, vb, v, r, s = sign_authorization(w3, usdg, payer_acct, pos.address, cost, nonce)
    auth = (payer_acct.address, cost, va, vb, nonce, v, r, s)
    tx = pos.functions.mintWithAuthorization(
        phase, ticker, qty, max_qty, proof, allow_unpriced, auth
    ).transact({"from": submitter, "gas": gas})
    return w3.eth.wait_for_transaction_receipt(tx)


def signer_for(w3, address):
    """The eth-tester account for `address`, as a signing Account.

    Paid mints need a SIGNATURE, not just a sender, so the suites' existing
    `w3.eth.accounts[n]` addresses have to be resolvable to keys. Keeps the
    migration to EIP-3009 from having to rename every actor in every test.
    """
    from eth_account import Account

    backend = w3.provider.ethereum_tester.backend
    for i, acct in enumerate(w3.eth.accounts):
        if acct.lower() == address.lower():
            raw = backend.account_keys[i]
            return Account.from_key(raw.to_bytes() if hasattr(raw, "to_bytes") else bytes(raw))
    raise KeyError(f"no key for {address}")
