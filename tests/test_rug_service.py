"""Tests for RugService's token-mint extraction, panic-sell gating, and the
money-path hardening applied after an Opus review returned BLOCK.

Covers:

  1. C1 — Real extraction of the rugged token mint from a getTransaction
     (jsonParsed) response REQUIRES an actually-EXECUTED Raydium AMM
     instruction (top-level or CPI), with the candidate mint derived ONLY
     from accounts that instruction touched, and a magnitude guard requiring
     the withdrawal drain more than RUG_WITHDRAWAL_MIN_FRACTION of that
     account's pre-balance. logsSubscribe's `{"mentions": [...]}` filter
     (which matches any tx merely referencing the account) and log-string
     matching (`"withdraw"` / `"removeliquidity"`) are both
     attacker-forgeable on their own; the transaction-level verification is
     what actually gates a sell.
  2. C3 — getTransaction is called at "confirmed" commitment with a bounded
     retry on a null result (was previously an implicit "finalized" default
     that always returned null for a just-seen signature).
  3. Defensive None-on-failure behavior (RPC error, HTTP error, ambiguous
     candidates, on-chain tx failure, malformed response, transport
     exception, dust withdrawal, forged "mentions"-only tx) — NEVER a fake or
     tx-wide-inferred mint.
  4. `_handle_potential_rug` exits cleanly (no panic-sell) when extraction
     returns None.
  5. H3 — the panic_sell_enabled opt-in gate in `_get_users_holding_token`
     reads UserSettings.panic_sell_enabled (the column the Telegram /set UI
     actually writes), not User.panic_sell_enabled.
  6. H2 — `_get_users_holding_token` returns each opted-in holder exactly
     once, resolved to their default SOLANA wallet (never an EVM wallet,
     never duplicated by a fan-out join).
  7. H1 — `_execute_panic_sell` builds a per-(user, wallet, signature)
     idempotency key, so two holders of the same rugged token never collide
     on the same idempotency row.
"""

import asyncio
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from types import SimpleNamespace

import pytest

from database.db import get_session, init_db
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.user import User, Wallet
from bot.models.favorites import UserSettings
import bot.services.token_security.rug_service as rug_service_module
from bot.services.token_security.rug_service import (
    RugService,
    RAYDIUM_AMM,
    RUG_MIN_DRAINED_NOTIONAL_USD,
    STABLE_MINTS,
    WSOL_MINT,
)

WSOL = WSOL_MINT
USDC = next(iter(STABLE_MINTS))
RUGGED_MINT = "RUGtokenMintAddress1111111111111111111111"
OTHER_MINT = "OtherTokenMintAddress222222222222222222222"

SIGNATURE = "5FakeSignature1111111111111111111111111111111111111111111111111"

PAYER = "PayerAddress11111111111111111111111111111"
MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"


@pytest.fixture(autouse=True)
def _fast_retry_delay(monkeypatch):
    """C3 adds a bounded retry-with-backoff on a null getTransaction result.
    Zero it out so the retry tests don't add real wall-clock sleep time."""
    monkeypatch.setattr(rug_service_module, "RUG_TX_FETCH_RETRY_DELAY_SECONDS", 0)


# B1 fixed SOL/USD price used to price a drained WSOL vault's pre-balance for
# the absolute-notional-floor check. Deterministic and offline so tests never
# depend on network access or live price volatility.
FAKE_SOL_PRICE_USD = 150.0


@pytest.fixture(autouse=True)
def _mock_sol_price(monkeypatch):
    """B1 adds an absolute USD floor on the paired WSOL/stablecoin vault's
    pre-withdrawal balance, which requires pricing a drained WSOL vault via
    price_service.get_price("SOL"). Stub it to a fixed price so existing
    tests don't make a real network call; a test that wants to exercise the
    "price lookup failed" path overrides this within the test itself."""

    async def _fake_get_price(token):
        return FAKE_SOL_PRICE_USD if token.upper() == "SOL" else None

    monkeypatch.setattr("bot.services.price_service.price_service.get_price", _fake_get_price)


# ---------------------------------------------------------------------------
# Fake aiohttp session/response (mirrors tests/test_starknet.py convention)
# ---------------------------------------------------------------------------


class _FakeResp:
    """Fake aiohttp response stand-in."""

    def __init__(self, body: dict = None, status: int = 200, raise_on_call: Exception = None):
        self._body = body
        self.status = status
        self._raise_on_call = raise_on_call

    async def json(self):
        return self._body

    async def __aenter__(self):
        if self._raise_on_call:
            raise self._raise_on_call
        return self

    async def __aexit__(self, *_):
        pass


class _FakeSession:
    """Fake aiohttp ClientSession — returns a canned response for .post(), and
    counts how many times .post() was called (used by the retry test)."""

    def __init__(self, response: _FakeResp):
        self._response = response
        self.call_count = 0

    def post(self, url, json=None):
        self.call_count += 1
        return self._response


def _install_fake_session(monkeypatch, response: _FakeResp) -> _FakeSession:
    fake_session = _FakeSession(response)

    async def _fake_get_http_session():
        return fake_session

    monkeypatch.setattr(rug_service_module, "get_http_session", _fake_get_http_session)
    return fake_session


# ---------------------------------------------------------------------------
# getTransaction(jsonParsed) response builders
# ---------------------------------------------------------------------------


def _instruction(program_id: str, accounts, data: str = "deadbeef") -> dict:
    return {"programId": program_id, "accounts": list(accounts), "data": data}


def _balance_entry(account_index: int, mint: str, ui_amount: float, decimals: int = 6) -> dict:
    raw_amount = str(int(round(ui_amount * (10**decimals))))
    return {
        "accountIndex": account_index,
        "mint": mint,
        "owner": "SomeOwnerAddress",
        "uiTokenAmount": {
            "amount": raw_amount,
            "decimals": decimals,
            "uiAmount": ui_amount,
            "uiAmountString": str(ui_amount),
        },
    }


def _tx_data(
    *,
    err=None,
    account_keys=None,
    instructions=None,
    inner_instructions=None,
    pre_balances=None,
    post_balances=None,
) -> dict:
    return {
        "slot": 123456,
        "meta": {
            "err": err,
            "preTokenBalances": pre_balances or [],
            "postTokenBalances": post_balances or [],
            "innerInstructions": inner_instructions or [],
        },
        "transaction": {
            "message": {
                "accountKeys": account_keys or [],
                "instructions": instructions or [],
            },
            "signatures": [SIGNATURE],
        },
    }


def _rpc_response(tx_data=None, rpc_error=None) -> dict:
    if rpc_error is not None:
        return {"jsonrpc": "2.0", "id": 1, "error": rpc_error}
    return {"jsonrpc": "2.0", "id": 1, "result": tx_data}


@pytest.fixture()
def sqlite_db(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'rug-service.db'}"
    assert init_db(database_url)
    yield


# ---------------------------------------------------------------------------
# 1. Real extraction — happy path (executed Raydium withdraw, magnitude ok)
# ---------------------------------------------------------------------------


def test_extract_token_mint_from_tx_returns_rugged_mint(monkeypatch):
    """WSOL leaves the pool's own vault alongside the rugged token, via an
    ACTUALLY EXECUTED Raydium instruction that drains >50% of the vault ->
    the non-WSOL mint is returned (never a hardcoded/demo value). WSOL
    pre-balance (1000 SOL @ $150 = $150k) is well above the B1 absolute
    notional floor, so this is a real, adequately-sized pool."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "PoolVaultRugged1111111111111111111",
        "PoolVaultWsol111111111111111111111",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000_000.0),
            _balance_entry(3, WSOL, 1_000.0),
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000.0),
            _balance_entry(3, WSOL, 1.0),
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result == RUGGED_MINT
    assert result != "DEMO_TOKEN_MINT"


def test_extract_token_mint_from_tx_excludes_stablecoin(monkeypatch):
    """A USDC-paired pool: USDC is excluded, only the paired token remains.
    USDC pre-balance ($50k, ~1:1 USD) is above the B1 absolute notional
    floor."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "PoolVaultRugged2222222222222222222",
        "PoolVaultUsdc222222222222222222222",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000_000.0),
            _balance_entry(3, USDC, 50_000.0),
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000.0),
            _balance_entry(3, USDC, 50.0),
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result == RUGGED_MINT


# ---------------------------------------------------------------------------
# 2. C1 adversarial cases — forged/ambiguous/unrelated -> NEVER a fake mint
# ---------------------------------------------------------------------------


def test_extract_token_mint_from_tx_forged_mentions_only_returns_none(monkeypatch):
    """Attacker-forgeable case this fix specifically closes: RAYDIUM_AMM
    appears only as a bare, unused account key (what logsSubscribe's
    {"mentions": [...]} filter matches), while the only executed instruction
    is an unrelated Memo containing "withdraw" plus a tiny unrelated-mint
    self-transfer. Since RAYDIUM_AMM is never a programId of an EXECUTED
    instruction, extraction must refuse to guess."""
    account_keys = [PAYER, RAYDIUM_AMM, "UnrelatedTokenAcct11111111111111111"]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[_instruction(MEMO_PROGRAM, [account_keys[0]], data="d2l0aGRyYXc=")],
        pre_balances=[_balance_entry(2, OTHER_MINT, 10.0)],
        post_balances=[_balance_entry(2, OTHER_MINT, 9.0)],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_different_pool_not_confused(monkeypatch):
    """A REAL executed Raydium withdraw drains pool A's vault (mint A) AND
    its paired WSOL vault (real 2-sided AMM withdraw, well above the B1
    notional floor). A separate, unrelated instruction in the same tx also
    moves mint B's balance, but mint B's account is never touched by the
    Raydium instruction. Extraction must return mint A, never mint B, and
    never None (a real, unambiguous, adequately-funded rug on pool A did
    happen)."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "PoolVaultMintA333333333333333333333",
        "PoolVaultWsolA33333333333333333333",
        "UnrelatedMintBAcct4444444444444444444",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]]),
            _instruction("SomeOtherProgram5555555555555555555", [account_keys[4]]),
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000.0),
            _balance_entry(3, WSOL, 1_000.0),  # pool A's own paired WSOL vault
            _balance_entry(4, OTHER_MINT, 50.0),
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 10.0),  # 99% drained by Raydium -> real rug
            _balance_entry(3, WSOL, 1.0),  # Raydium's own WSOL vault, also drained
            _balance_entry(4, OTHER_MINT, 1.0),  # 98% drained, but NOT a Raydium account
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result == RUGGED_MINT
    assert result != OTHER_MINT


def test_extract_token_mint_from_tx_dust_withdrawal_returns_none(monkeypatch):
    """A real executed Raydium instruction, but the vault balance only drops
    1% -> below RUG_WITHDRAWAL_MIN_FRACTION, so it does not qualify as a
    rug and must return None."""
    account_keys = [PAYER, RAYDIUM_AMM, "PoolVaultDust666666666666666666666"]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[_instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2]])],
        pre_balances=[_balance_entry(2, RUGGED_MINT, 1_000.0)],
        post_balances=[_balance_entry(2, RUGGED_MINT, 990.0)],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_ambiguous_candidates_returns_none(monkeypatch):
    """Two DIFFERENT non-SOL/non-stable mints both qualify on accounts the
    executed Raydium instruction touched -> can't tell which one was
    rugged, so we refuse to guess."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "VaultA777777777777777777777777777777",
        "VaultB88888888888888888888888888888",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000.0),
            _balance_entry(3, OTHER_MINT, 500.0),
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 10.0),
            _balance_entry(3, OTHER_MINT, 5.0),
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_no_candidates_returns_none(monkeypatch):
    """Only SOL/stablecoins touched by the executed Raydium instruction (e.g.
    a stable/stable pool) -> no candidate token -> None."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "VaultWsol99999999999999999999999999",
        "VaultUsdc00000000000000000000000000",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, WSOL, 500.0),
            _balance_entry(3, USDC, 500.0),
        ],
        post_balances=[
            _balance_entry(2, WSOL, 5.0),
            _balance_entry(3, USDC, 5.0),
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


# ---------------------------------------------------------------------------
# 2b. B1 adversarial cases — absolute USD notional floor
# ---------------------------------------------------------------------------


def test_extract_token_mint_from_tx_fresh_decoy_pool_returns_none(monkeypatch):
    """B1 core regression: the exact attack the money-path reviewer
    reconstructed. Raydium AMM v4 pools are permissionless -- an attacker
    buys a little of victim mint X, creates a BRAND NEW Raydium pool for
    (X, WSOL) seeded with only ~$4.50 (0.03 SOL @ $150), and withdraws 100%
    of it in one tx. Before B1, RUG_WITHDRAWAL_MIN_FRACTION alone (purely
    relative) let this qualify identically to a real multi-figure rug. The
    absolute USD floor must reject it: the paired WSOL vault's pre-balance
    (~$4.50) is far below RUG_MIN_DRAINED_NOTIONAL_USD, so this must return
    None even though every other C1 check (executed instruction, magnitude,
    single candidate) is satisfied."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "PoolVaultDecoyMint11111111111111111",
        "PoolVaultDecoyWsol111111111111111111",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000_000.0),  # attacker's own throwaway mint
            _balance_entry(3, WSOL, 0.03),  # ~$4.50 @ $150/SOL -- a decoy seed
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 0.0),  # 100% withdrawn
            _balance_entry(3, WSOL, 0.0),  # 100% withdrawn
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_large_pool_partial_withdrawal_still_detected(monkeypatch):
    """B1 must NOT introduce a false negative on real rugs: a legitimately
    large pool (500 SOL @ $150 = $75k, well above the floor) that has a
    genuine partial (>50%, here 60%) liquidity withdrawal must still be
    detected -- the absolute floor only exempts pools too small to be a real
    rug worth protecting against, not partial withdrawals in general."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "PoolVaultLargeRugged22222222222222",
        "PoolVaultLargeWsol222222222222222222",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000_000.0),
            _balance_entry(3, WSOL, 500.0),  # $75k paired vault -- a real, funded pool
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 400_000.0),  # 60% withdrawn
            _balance_entry(3, WSOL, 200.0),  # 60% withdrawn
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result == RUGGED_MINT


def test_extract_token_mint_from_tx_sol_price_lookup_failure_returns_none(monkeypatch):
    """If the WSOL pre-balance can't be priced (price_service call fails or
    returns None), we cannot establish the B1 floor -- fail defensively to
    None rather than let an unpriced pool through unguarded."""
    account_keys = [
        PAYER,
        RAYDIUM_AMM,
        "PoolVaultUnpriced11111111111111111",
        "PoolVaultUnpricedWsol111111111111111",
    ]
    tx = _tx_data(
        account_keys=account_keys,
        instructions=[
            _instruction(RAYDIUM_AMM, [account_keys[1], account_keys[2], account_keys[3]])
        ],
        pre_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000_000.0),
            _balance_entry(3, WSOL, 1_000.0),
        ],
        post_balances=[
            _balance_entry(2, RUGGED_MINT, 1_000.0),
            _balance_entry(3, WSOL, 1.0),
        ],
    )
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    async def _failing_get_price(token):
        return None

    monkeypatch.setattr("bot.services.price_service.price_service.get_price", _failing_get_price)

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


# ---------------------------------------------------------------------------
# 3. Defensive None-on-failure paths — NEVER a fake mint
# ---------------------------------------------------------------------------


def test_extract_token_mint_from_tx_rpc_error_returns_none(monkeypatch):
    body = _rpc_response(rpc_error={"code": -32602, "message": "invalid signature"})
    _install_fake_session(monkeypatch, _FakeResp(body))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_http_error_returns_none(monkeypatch):
    _install_fake_session(monkeypatch, _FakeResp({}, status=500))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_missing_result_returns_none(monkeypatch):
    """C3: getTransaction returning a null result (unfinalized/not yet
    visible at 'confirmed') retries up to RUG_TX_FETCH_MAX_ATTEMPTS times,
    then gives up and returns None — never a wrong mint."""
    fake_session = _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=None)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None
    assert fake_session.call_count == rug_service_module.RUG_TX_FETCH_MAX_ATTEMPTS


def test_extract_token_mint_from_tx_onchain_failure_returns_none(monkeypatch):
    """The liquidity-removal tx itself reverted on-chain — nothing to protect."""
    tx = _tx_data(err={"InstructionError": [0, "Custom"]})
    _install_fake_session(monkeypatch, _FakeResp(_rpc_response(tx_data=tx)))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


def test_extract_token_mint_from_tx_transport_exception_returns_none(monkeypatch):
    """Any unexpected exception (network blip, malformed JSON, etc.) is
    swallowed defensively and mapped to None, never a fake mint."""
    _install_fake_session(monkeypatch, _FakeResp(raise_on_call=ConnectionError("network down")))

    service = RugService()
    result = asyncio.run(service._extract_token_mint_from_tx(SIGNATURE))

    assert result is None


# ---------------------------------------------------------------------------
# 4. _handle_potential_rug exits cleanly when extraction returns None
# ---------------------------------------------------------------------------


def test_handle_potential_rug_skips_panic_sell_when_mint_is_none(monkeypatch):
    service = RugService()

    async def fake_extract(signature):
        return None

    calls = {"get_users": 0, "panic_sell": 0}

    async def fake_get_users(token_mint):
        calls["get_users"] += 1
        return [(1, 1)]

    async def fake_panic_sell(user_id, wallet_id, token_mint, signature):
        calls["panic_sell"] += 1

    monkeypatch.setattr(service, "_extract_token_mint_from_tx", fake_extract)
    monkeypatch.setattr(service, "_get_users_holding_token", fake_get_users)
    monkeypatch.setattr(service, "_execute_panic_sell", fake_panic_sell)

    asyncio.run(service._handle_potential_rug(["Program log: removeLiquidity"], SIGNATURE))

    assert calls["get_users"] == 0
    assert calls["panic_sell"] == 0


def test_handle_potential_rug_fires_panic_sell_when_mint_found(monkeypatch):
    service = RugService()

    async def fake_extract(signature):
        return RUGGED_MINT

    calls = {"panic_sell": []}

    async def fake_get_users(token_mint):
        assert token_mint == RUGGED_MINT
        return [(1, 10), (2, 20)]

    async def fake_panic_sell(user_id, wallet_id, token_mint, signature):
        calls["panic_sell"].append((user_id, wallet_id, token_mint, signature))

    monkeypatch.setattr(service, "_extract_token_mint_from_tx", fake_extract)
    monkeypatch.setattr(service, "_get_users_holding_token", fake_get_users)
    monkeypatch.setattr(service, "_execute_panic_sell", fake_panic_sell)

    asyncio.run(service._handle_potential_rug(["Program log: removeLiquidity"], SIGNATURE))

    assert sorted(calls["panic_sell"]) == [
        (1, 10, RUGGED_MINT, SIGNATURE),
        (2, 20, RUGGED_MINT, SIGNATURE),
    ]


# ---------------------------------------------------------------------------
# 5/6. panic_sell_enabled opt-in gate + holder query (H3 + H2, DB-backed)
#
# CAVEAT (B2, known non-functional gap — see
# RugService._get_users_holding_token's docstring): the two tests below
# construct `SwapTransaction(to_token=RUGGED_MINT, ...)`, i.e. they store a
# 43-44 char mint-shaped string directly in `to_token`. That is NOT what
# production writes there — swap_engine.py stores a token SYMBOL (e.g.
# "PEPE") in that column — so these tests only exercise the opt-in-gating
# (H3) and wallet-resolution (H2) logic in isolation, using a test double
# that happens to make the `to_token == token_mint` comparison succeed. They
# pass only because SQLite doesn't enforce the column's declared
# VARCHAR(20) length; on Postgres even this test's oversized string would be
# rejected/truncated at write time. See
# test_get_users_holding_token_symbol_vs_mint_mismatch_is_a_noop below for a
# test that reproduces the REAL production shape and its (currently null)
# result.
# ---------------------------------------------------------------------------


def test_get_users_holding_token_only_returns_opted_in_users(sqlite_db):
    """Users with UserSettings.panic_sell_enabled=False must NEVER be
    auto-sold, even if they hold a matching completed swap into the rugged
    token. H3: this reads UserSettings.panic_sell_enabled — the column the
    Telegram /set UI actually writes — not User.panic_sell_enabled.

    NOTE (B2): uses a mint-shaped `to_token` test double — see the module
    caveat above. This test is about the opt-in gate, not mint matching."""
    service = RugService()

    with get_session() as session:
        opted_in = User(id=1, username="protected-user")
        opted_out = User(id=2, username="unprotected-user")
        session.add_all([opted_in, opted_out])
        session.flush()

        session.add_all(
            [
                UserSettings(user_id=1, panic_sell_enabled=True),
                UserSettings(user_id=2, panic_sell_enabled=False),
            ]
        )

        wallet_in = Wallet(
            id=1,
            user_id=1,
            address="SoLwalletIn11111111111111111111111111111",
            chain_type="solana",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        wallet_out = Wallet(
            id=2,
            user_id=2,
            address="SoLwalletOut2222222222222222222222222222",
            chain_type="solana",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        session.add_all([wallet_in, wallet_out])

        swap_in = SwapTransaction(
            user_id=1,
            from_chain="solana",
            from_token="SOL",
            from_amount="1000000000",
            to_chain="solana",
            to_token=RUGGED_MINT,
            to_amount="500000",
            status=SwapStatus.COMPLETED.value,
        )
        swap_out = SwapTransaction(
            user_id=2,
            from_chain="solana",
            from_token="SOL",
            from_amount="1000000000",
            to_chain="solana",
            to_token=RUGGED_MINT,
            to_amount="500000",
            status=SwapStatus.COMPLETED.value,
        )
        session.add_all([swap_in, swap_out])

    holders = asyncio.run(service._get_users_holding_token(RUGGED_MINT))

    assert (1, 1) in holders
    assert not any(user_id == 2 for user_id, _wallet_id in holders)


def test_get_users_holding_token_no_evm_wallets_no_duplicates(sqlite_db):
    """H2: the holder query must never (a) hand an EVM wallet id into the
    Solana panic-sell path, or (b) return the same user more than once when
    they have multiple wallets or multiple matching completed swaps.

    NOTE (B2): uses a mint-shaped `to_token` test double — see the module
    caveat above. This test is about wallet resolution, not mint matching."""
    service = RugService()

    with get_session() as session:
        opted_in = User(id=1, username="protected-user")
        opted_out = User(id=2, username="unprotected-user")
        multi_swap = User(id=3, username="multi-swap-user")
        session.add_all([opted_in, opted_out, multi_swap])
        session.flush()

        session.add_all(
            [
                UserSettings(user_id=1, panic_sell_enabled=True),
                UserSettings(user_id=2, panic_sell_enabled=False),
                UserSettings(user_id=3, panic_sell_enabled=True),
            ]
        )

        # User 1 has BOTH an EVM wallet and a Solana wallet, both "default".
        evm_wallet = Wallet(
            id=101,
            user_id=1,
            address="0xEvmWalletAddress1111111111111111111111",
            chain_type="evm",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        sol_wallet = Wallet(
            id=102,
            user_id=1,
            address="SoLWalletDefault11111111111111111111111",
            chain_type="solana",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        wallet_out = Wallet(
            id=103,
            user_id=2,
            address="SoLWalletOut2222222222222222222222222222",
            chain_type="solana",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        wallet_multi = Wallet(
            id=104,
            user_id=3,
            address="SoLWalletMulti333333333333333333333333333",
            chain_type="solana",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        session.add_all([evm_wallet, sol_wallet, wallet_out, wallet_multi])

        def _swap(user_id):
            return SwapTransaction(
                user_id=user_id,
                from_chain="solana",
                from_token="SOL",
                from_amount="1000000000",
                to_chain="solana",
                to_token=RUGGED_MINT,
                to_amount="500000",
                status=SwapStatus.COMPLETED.value,
            )

        # User 3 has TWO matching completed swaps into the rugged mint.
        session.add_all([_swap(1), _swap(2), _swap(3), _swap(3)])

    holders = asyncio.run(service._get_users_holding_token(RUGGED_MINT))

    holder_map = dict(holders)

    # Opted-out user never appears.
    assert 2 not in holder_map

    # Opted-in user's SOLANA wallet is returned, never the EVM one.
    assert holder_map[1] == sol_wallet.id
    assert holder_map[1] != evm_wallet.id

    # Each user appears at most once, even with multiple matching swaps.
    holder_user_ids = [user_id for user_id, _wallet_id in holders]
    assert holder_user_ids.count(1) == 1
    assert holder_user_ids.count(3) == 1


def test_get_users_holding_token_symbol_vs_mint_mismatch_is_a_noop(sqlite_db):
    """B2 — KNOWN NON-FUNCTIONAL GAP, documented not fixed. Reproduces the
    REAL production shape: `SwapTransaction.to_token` holds a token SYMBOL
    (as swap_engine.py actually writes it — see quote.to_token, "Destination
    token symbol"), never a mint address. `_extract_token_mint_from_tx`
    always hands `_get_users_holding_token` a real mint (43-44 base58
    chars), so `SwapTransaction.to_token == token_mint` can never match a
    symbol-shaped column.

    This test intentionally asserts the CURRENT (broken) behavior: an
    opted-in user who genuinely holds the rugged token (per their completed
    swap's SYMBOL) is NOT found, because the lookup is keyed on the mint.
    This is a known gap, not a regression to "fix" by loosening the query —
    there is no mint/contract-address column on SwapTransaction to match
    against instead (a schema migration is out of scope here; see the
    logger.warning + docstring on `_get_users_holding_token`). If this
    assertion ever starts failing (holders show up), it means a mint column
    was added and this test — and its documentation — need updating
    together, not deleting."""
    service = RugService()

    with get_session() as session:
        user = User(id=1, username="protected-user")
        session.add(user)
        session.flush()

        session.add(UserSettings(user_id=1, panic_sell_enabled=True))

        wallet = Wallet(
            id=1,
            user_id=1,
            address="SoLWalletRealShape1111111111111111111111",
            chain_type="solana",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        session.add(wallet)

        # Production shape: to_token is a SYMBOL, not the mint.
        swap = SwapTransaction(
            user_id=1,
            from_chain="solana",
            from_token="SOL",
            from_amount="1000000000",
            to_chain="solana",
            to_token="RUGGED",  # a realistic ticker/symbol, NOT RUGGED_MINT
            to_amount="500000",
            status=SwapStatus.COMPLETED.value,
        )
        session.add(swap)

    # _extract_token_mint_from_tx always passes a real mint address here.
    holders = asyncio.run(service._get_users_holding_token(RUGGED_MINT))

    # KNOWN GAP: this is empty in production today, even though user 1 is
    # opted in and genuinely holds the rugged token per their completed swap.
    assert holders == []


# ---------------------------------------------------------------------------
# 7. H1 — per-(user, wallet, signature) idempotency
# ---------------------------------------------------------------------------


def test_execute_panic_sell_idempotency_key_is_per_user(monkeypatch):
    """Two holders of the same rugged token, sold in the same
    _handle_potential_rug fan-out (same signature), must produce two
    DISTINCT idempotency keys — the old f"panic_sell:{token_mint}:{minute}"
    key collided across every holder, so only the first sell ever executed
    and the rest silently reused its SwapTransaction."""
    service = RugService()

    fake_wallet = SimpleNamespace(
        id=None,
        address="SoLWalletAddr1111111111111111111111111",
        chain_type="solana",
        is_active=True,
    )

    def fake_get_wallet_by_id(wallet_id):
        fake_wallet.id = wallet_id
        return fake_wallet

    async def fake_get_solana_token_balance(token_mint, address):
        return 100.0

    monkeypatch.setattr(service._wallet_service, "get_wallet_by_id", fake_get_wallet_by_id)
    monkeypatch.setattr(
        service._wallet_service, "get_solana_token_balance", fake_get_solana_token_balance
    )

    async def fake_get_quote(**kwargs):
        return SimpleNamespace(from_chain="solana", to_chain="solana")

    captured_keys = []

    async def fake_execute_swap(quote, wallet_id, user_id, idempotency_key=None):
        captured_keys.append(idempotency_key)
        return SimpleNamespace(id=len(captured_keys))

    service._swap_engine = SimpleNamespace(get_quote=fake_get_quote, execute_swap=fake_execute_swap)

    asyncio.run(service._execute_panic_sell(1, 10, RUGGED_MINT, SIGNATURE))
    asyncio.run(service._execute_panic_sell(2, 20, RUGGED_MINT, SIGNATURE))

    assert len(captured_keys) == 2
    assert captured_keys[0] != captured_keys[1]
    assert all(k is not None for k in captured_keys)
    assert "1" in captured_keys[0].split(":") and "10" in captured_keys[0].split(":")
    assert "2" in captured_keys[1].split(":") and "20" in captured_keys[1].split(":")
