"""Tempo access-key (session-key) lifecycle.

Grants a bot-held secp256k1 access key on a user's Tempo account via the
AccountKeychain precompile, scoped to the enshrined DEX + TIP-20 selectors with an
on-chain spending limit (recurring) and expiry. The bot can then sign automated
Tempo swaps with the access key (KeychainSignature, type 0x04) — no root key, no
per-trade re-auth — while the protocol enforces the cap.

Signing model (matches the rest of the Tempo stack):
- the GRANT/REVOKE tx is signed by the user's *root* wallet. Prod roots are
  Turnkey-managed, so we sign the Tempo sender hash via the enclave
  (tempo_turnkey_signer); it is gasless-sponsorable like any other Tempo tx.
- the ACCESS key is a local key we hold (safe: scope/limit/expiry bound). Swap
  signing uses pytempo's sign_access_key() and needs no Turnkey round-trip.
"""

import logging
import time
from typing import Optional

from eth_account import Account
from eth_utils import keccak
from web3 import Web3

from bot.config.settings import settings
from bot.config.tokens import get_token_address
from bot.models.tempo_access_key import TempoAccessKey
from bot.services.tempo_fee_sponsor import tempo_fee_sponsor
from bot.utils.envelope_crypto import (
    encrypt_private_key_v2,
    encode_for_db,
    get_private_key_with_auto_migrate,
)
from database.db import get_session

logger = logging.getLogger(__name__)

# Capped/scoped tokens — the four mainnet TIP-20 stablecoins.
_SCOPED_TOKENS = ("pathUSD", "alphaUSD", "betaUSD", "thetaUSD")

# Enshrined-DEX selectors the access key may call (swap only — never withdraw).
_SWAP_SELECTORS = (
    keccak(text="swapExactAmountIn(address,address,uint128,uint128,address)")[:4],
    keccak(text="swapExactAmountOut(address,address,uint128,uint128,address)")[:4],
)

DEFAULT_PERIOD_SECONDS = 7 * 24 * 3600  # weekly recurring cap
DEFAULT_EXPIRY_SECONDS = 30 * 24 * 3600  # key auto-expires after 30 days
DEFAULT_CAP_USD = 500.0
_TIP20_DECIMALS = 6


class TempoKeychainService:
    """Grant / revoke / use Tempo access keys."""

    def get_active_key(self, user_id: int) -> Optional[TempoAccessKey]:
        """Return the user's active, unexpired access key (or None)."""
        now = int(time.time())
        with get_session() as session:
            rec = (
                session.query(TempoAccessKey)
                .filter(
                    TempoAccessKey.user_id == user_id,
                    TempoAccessKey.status == "active",
                )
                .order_by(TempoAccessKey.id.desc())
                .first()
            )
            if rec and rec.expiry and rec.expiry <= now:
                rec.status = "expired"
                return None
            # Detach a plain snapshot for use outside the session.
            if rec:
                session.expunge(rec)
            return rec

    # ---- grant -----------------------------------------------------------

    def _build_restrictions(self, cap_raw: int, expiry: int):
        """KeyRestrictions: per-token recurring caps + DEX-swap/approve call scope."""
        from pytempo.contracts import StablecoinDEX
        from pytempo.keychain import KeyRestrictions, TokenLimit, CallScope

        dex = StablecoinDEX.ADDRESS
        limits, calls = [], []
        for sym in _SCOPED_TOKENS:
            addr = get_token_address(sym, "tempo")
            if not addr:
                continue
            addr = Web3.to_checksum_address(addr)
            limits.append(TokenLimit(token=addr, limit=cap_raw, period=DEFAULT_PERIOD_SECONDS))
            # approve(spender=DEX) on the token + swap selectors on the DEX.
            calls.append(CallScope.approve(target=addr, recipients=[dex]))
        for sel in _SWAP_SELECTORS:
            calls.append(CallScope.with_selector(target=dex, selector=sel))
        return KeyRestrictions(expiry=expiry, limits=limits, allowed_calls=calls)

    async def grant(self, *, user_id: int, wallet, cap_usd: float = DEFAULT_CAP_USD):
        """Generate an access key, authorize it on-chain as the root wallet, store it.

        `wallet` is the user's Tempo root Wallet object. Returns the TempoAccessKey
        record. Raises on failure (nothing is stored unless the grant tx submits).
        """
        from pytempo.contracts import AccountKeychain
        from pytempo.keychain import SignatureType

        root_address = wallet.address
        access = Account.create()
        key_address = access.address
        cap_raw = int(cap_usd * (10**_TIP20_DECIMALS))
        expiry = int(time.time()) + DEFAULT_EXPIRY_SECONDS

        restrictions = self._build_restrictions(cap_raw, expiry)
        authorize_call = AccountKeychain.authorize_key(
            key_id=Web3.to_checksum_address(key_address),
            signature_type=SignatureType.SECP256K1,
            restrictions=restrictions,
        )

        # Sign + submit as root (Turnkey enclave or local), gasless when enabled.
        tx_hash = await self._submit_as_root(wallet, root_address, (authorize_call,))

        enc = encode_for_db(encrypt_private_key_v2(access.key.hex()))
        with get_session() as session:
            rec = TempoAccessKey(
                user_id=user_id,
                root_address=root_address,
                key_address=key_address,
                encrypted_private_key=enc["encrypted_private_key"],
                encryption_scheme=enc["encryption_scheme"],
                kms_wrapped_dek=enc.get("kms_wrapped_dek"),
                aesgcm_nonce=enc.get("aesgcm_nonce"),
                kms_key_id=enc.get("kms_key_id"),
                key_version=enc.get("key_version", 1),
                spend_token=get_token_address("pathUSD", "tempo"),
                spend_limit_raw=str(cap_raw),
                period_seconds=DEFAULT_PERIOD_SECONDS,
                expiry=expiry,
                authorize_tx_hash=tx_hash,
                status="active",
            )
            session.add(rec)
            session.flush()
            session.expunge(rec)
        logger.info(
            f"Tempo access key granted for user {user_id}: {key_address[:10]}… "
            f"cap=${cap_usd}/wk expiry={expiry} tx={tx_hash}"
        )
        return rec

    async def revoke(self, user_id: int) -> Optional[str]:
        """Revoke the user's active access key on-chain. Returns the revoke tx hash."""
        from pytempo.contracts import AccountKeychain

        rec = self.get_active_key(user_id)
        if not rec:
            return None
        wallet = self._load_root_wallet(rec.root_address)
        if not wallet:
            raise ValueError(f"Root wallet {rec.root_address} not found for revoke")

        revoke_call = AccountKeychain.revoke_key(key_id=Web3.to_checksum_address(rec.key_address))
        tx_hash = await self._submit_as_root(wallet, rec.root_address, (revoke_call,))
        with get_session() as session:
            row = session.query(TempoAccessKey).filter(TempoAccessKey.id == rec.id).first()
            if row:
                row.status = "revoked"
                row.revoke_tx_hash = tx_hash
        logger.info(f"Tempo access key revoked for user {user_id}: tx={tx_hash}")
        return tx_hash

    # ---- access-key signing (used by the automated swap path) ------------

    def get_access_private_key(self, rec: TempoAccessKey) -> str:
        """Decrypt the access key's private key (hex)."""
        return get_private_key_with_auto_migrate(rec)

    def sign_swap_with_access_key(self, tx, root_address: str, rec: TempoAccessKey):
        """Sign a pytempo TempoTransaction with the access key (KeychainSignature)."""
        key = self.get_access_private_key(rec)
        if not key.startswith("0x"):
            key = "0x" + key
        return tx.sign_access_key(key, Web3.to_checksum_address(root_address))

    # ---- internals -------------------------------------------------------

    def _load_root_wallet(self, address: str):
        from bot.models.user import Wallet

        with get_session() as session:
            w = session.query(Wallet).filter(Wallet.address == address).first()
            if w:
                session.expunge(w)
            return w

    async def _submit_as_root(self, wallet, root_address: str, calls) -> str:
        """Build a Tempo type-0x76 tx for `calls`, sign as root, submit (gasless if on).

        Root signing routes through the Turnkey enclave for Turnkey wallets or a
        local key otherwise; when fee sponsorship is enabled and a sponsor wallet
        exists, the sponsor counter-signs so the grant/revoke is gasless too.
        """
        import asyncio

        import attrs
        from pytempo import TempoTransaction

        from bot.services.rpc_manager import rpc_manager
        from bot.config.chains import get_chain_by_name

        web3 = rpc_manager.get_web3("tempo")
        chain_id = get_chain_by_name("tempo").chain_id

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(root_address))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price) or 2_000_000_000

        tx = TempoTransaction.create(
            chain_id=chain_id,
            gas_limit=500_000,
            max_fee_per_gas=gas_price * 2,
            max_priority_fee_per_gas=gas_price,
            nonce=nonce,
            awaiting_fee_payer=True,
            calls=tuple(calls),
        )

        # Root signs the 0x76 sender hash.
        root_sig = await self._root_signature(wallet, root_address, tx.get_signing_hash())
        tx = attrs.evolve(tx, sender_signature=root_sig, sender_address=root_address)

        # Sponsor (fee payer) — gasless when configured; else root must hold gas.
        sponsor = await self._load_sponsor() if tempo_fee_sponsor.enabled else None
        if sponsor and sponsor[0].lower() != root_address.lower():
            sponsor_address, sponsor_turnkey, sponsor_key = sponsor
            fee_token = get_token_address(tempo_fee_sponsor.fee_token, "tempo")
            tx = attrs.evolve(tx, fee_token=Web3.to_checksum_address(fee_token))
            fp_sig = await self._signature(
                address=sponsor_address,
                is_turnkey=sponsor_turnkey,
                raw_key=sponsor_key,
                hash32=tx.get_signing_hash(for_fee_payer=True),
            )
            tx = attrs.evolve(tx, fee_payer_signature=fp_sig)

        raw = tx.encode()
        tx_hash = await asyncio.to_thread(lambda: web3.eth.send_raw_transaction(raw).hex())
        return tx_hash

    async def _root_signature(self, wallet, address: str, hash32: bytes):
        raw_key = None if wallet.is_turnkey_wallet else self._wallet_key(wallet)
        return await self._signature(
            address=address, is_turnkey=wallet.is_turnkey_wallet, raw_key=raw_key, hash32=hash32
        )

    async def _signature(self, *, address: str, is_turnkey: bool, raw_key, hash32: bytes):
        from pytempo.models import Signature

        if is_turnkey:
            from bot.services.tempo_turnkey_signer import sign_tempo_hash

            return await sign_tempo_hash(address, hash32)
        key = raw_key if raw_key.startswith("0x") else "0x" + raw_key
        sm = Account.from_key(key).unsafe_sign_hash(hash32)
        return Signature(r=sm.r, s=sm.s, v=sm.v)

    def _wallet_key(self, wallet) -> str:
        from bot.services.wallet import WalletService

        return WalletService().get_private_key(wallet)

    async def _load_sponsor(self):
        import asyncio

        from bot.models.custodial import HotWallet
        from bot.services.hot_wallet import hot_wallet_service

        name = tempo_fee_sponsor.sponsor_wallet_name

        def _load():
            with get_session() as session:
                sw = (
                    session.query(HotWallet)
                    .filter(HotWallet.name == name, HotWallet.is_active == True)
                    .first()
                )
                if not sw:
                    return None
                turnkey = sw.is_turnkey_wallet
                return (
                    sw.address,
                    turnkey,
                    (None if turnkey else hot_wallet_service.get_private_key(sw)),
                )

        return await asyncio.to_thread(_load)


tempo_keychain_service = TempoKeychainService()
