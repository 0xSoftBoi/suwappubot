"""HPKE decryption for Turnkey export bundles (wallet / private-key export).

Turnkey's ACTIVITY_TYPE_EXPORT_WALLET never returns plaintext: the caller must
supply a P-256 ``targetPublicKey`` and receives an *export bundle* whose
ciphertext is HPKE-encrypted to that key (DHKEM(P-256, HKDF-SHA256),
HKDF-SHA256, AES-256-GCM, single-shot). This module is a line-for-line port of
``@turnkey/crypto`` (crypto.ts ``hpkeDecrypt`` + turnkey_helpers.ts
``decryptExportBundle``/``verifyEnclaveSignature``) and is cross-checked in
tests against a vector produced by that library.

Nothing here touches the network. Keys live only in memory; callers must
treat the returned plaintext as key material.
"""

from __future__ import annotations

import hmac
import hashlib
import json
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidSignature

# --- Constants: byte-for-byte from @turnkey/crypto/src/constants.ts ---------
HPKE_VERSION = b"HPKE-v1"
SUITE_ID_1 = bytes([75, 69, 77, 0, 16])  # "KEM" || 0x0010 (DHKEM P-256)
SUITE_ID_2 = bytes([72, 80, 75, 69, 0, 16, 0, 1, 0, 2])  # "HPKE" || kem || kdf || aead
LABEL_SECRET = b"secret"
LABEL_EAE_PRK = b"eae_prk"
LABEL_SHARED_SECRET = b"shared_secret"
# Pre-built LabeledInfo blobs (they embed the key-schedule context that binds
# the "turnkey_hpke" info string), copied verbatim so we cannot drift.
AES_KEY_INFO = bytes(
    [0, 32, 72, 80, 75, 69, 45, 118, 49, 72, 80, 75, 69, 0, 16, 0, 1, 0, 2, 107, 101, 121, 0]
    + [143, 195, 174, 184, 50, 73, 10, 75, 90, 179, 228, 32, 35, 40, 125, 178, 154, 31, 75, 199]
    + [194, 34, 192, 223, 34, 135, 39, 183, 10, 64, 33, 18, 47, 63, 4, 233, 32, 108, 209, 36]
    + [19, 80, 53, 41, 180, 122, 198, 166, 48, 185, 46, 196, 207, 125, 35, 69, 8, 208, 175, 151]
    + [113, 201, 158, 80]
)
IV_INFO = bytes(
    [0, 12, 72, 80, 75, 69, 45, 118, 49, 72, 80, 75, 69, 0, 16, 0, 1, 0, 2]
    + [98, 97, 115, 101, 95, 110, 111, 110, 99, 101, 0]
    + [143, 195, 174, 184, 50, 73, 10, 75, 90, 179, 228, 32, 35, 40, 125, 178, 154, 31, 75, 199]
    + [194, 34, 192, 223, 34, 135, 39, 183, 10, 64, 33, 18, 47, 63, 4, 233, 32, 108, 209, 36]
    + [19, 80, 53, 41, 180, 122, 198, 166, 48, 185, 46, 196, 207, 125, 35, 69, 8, 208, 175, 151]
    + [113, 201, 158, 80]
)
# Turnkey production signer enclave quorum key (export bundles are signed by it).
PRODUCTION_SIGNER_SIGN_PUBLIC_KEY = (
    "04cf288fe433cc4e1aa0ce1632feac4ea26bf2f5a09dcfe5a42c398e06898710"
    "330f0572882f4dbdf0f5304b8fc8703acd69adca9a4bbf7f5d00d20a5e364b2569"
)


class TurnkeyBundleError(ValueError):
    """Raised when an export bundle fails verification or decryption."""


@dataclass(frozen=True)
class TargetKeyPair:
    """Ephemeral receiver key for one export. ``public_uncompressed_hex`` is
    what goes into the activity's ``targetPublicKey``."""

    private_hex: str
    public_uncompressed_hex: str


def generate_target_keypair() -> TargetKeyPair:
    priv = ec.generate_private_key(ec.SECP256R1())
    priv_hex = format(priv.private_numbers().private_value, "064x")
    pub = priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return TargetKeyPair(private_hex=priv_hex, public_uncompressed_hex=pub.hex())


def _hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    # HMAC with an empty key is HMAC with a zero-filled key, matching both
    # RFC 5869's default salt and @noble's behaviour for an empty Uint8Array.
    return hmac.new(salt, ikm, hashlib.sha256).digest()


def _hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    out = b""
    block = b""
    counter = 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def _extract_and_expand(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return _hkdf_expand(_hkdf_extract(salt, ikm), info, length)


def _labeled_ikm(label: bytes, ikm: bytes, suite_id: bytes) -> bytes:
    return HPKE_VERSION + suite_id + label + ikm


def _labeled_info(label: bytes, info: bytes, suite_id: bytes, length: int) -> bytes:
    return length.to_bytes(2, "big") + HPKE_VERSION + suite_id + label + info


def _load_p256_public(uncompressed: bytes) -> ec.EllipticCurvePublicKey:
    if len(uncompressed) != 65 or uncompressed[0] != 0x04:
        raise TurnkeyBundleError("expected a 65-byte uncompressed P-256 public key")
    return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), uncompressed)


def hpke_decrypt(ciphertext: bytes, encapped_public: bytes, receiver_private_hex: str) -> bytes:
    """Decrypt a Turnkey HPKE payload. ``encapped_public`` must be uncompressed."""
    receiver_priv = ec.derive_private_key(int(receiver_private_hex, 16), ec.SECP256R1())
    receiver_pub = receiver_priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    sender_pub = _load_p256_public(encapped_public)

    aad = encapped_public + receiver_pub
    # Step 1: ECDH shared secret (x-coordinate, 32 bytes) — same as noble's
    # getSharedSecret(...).slice(1) on the compressed point.
    ss = receiver_priv.exchange(ec.ECDH(), sender_pub)
    # Step 2: KEM context
    kem_context = encapped_public + receiver_pub
    # Step 3: shared secret
    ikm = _labeled_ikm(LABEL_EAE_PRK, ss, SUITE_ID_1)
    info = _labeled_info(LABEL_SHARED_SECRET, kem_context, SUITE_ID_1, 32)
    shared_secret = _extract_and_expand(b"", ikm, info, 32)
    # Steps 4-5: AES key + base nonce from the key schedule
    ikm = _labeled_ikm(LABEL_SECRET, b"", SUITE_ID_2)
    key = _extract_and_expand(shared_secret, ikm, AES_KEY_INFO, 32)
    iv = _extract_and_expand(shared_secret, ikm, IV_INFO, 12)
    # Step 6
    try:
        return AESGCM(key).decrypt(iv, ciphertext, aad)
    except Exception as exc:  # cryptography raises InvalidTag
        raise TurnkeyBundleError(f"HPKE decryption failed: {exc}") from exc


def verify_enclave_signature(
    enclave_quorum_public_hex: str,
    signature_der_hex: str,
    signed_data_hex: str,
    expected_signer_public_hex: str = PRODUCTION_SIGNER_SIGN_PUBLIC_KEY,
) -> None:
    """ECDSA-P256/SHA-256 check that the bundle came from Turnkey's signer enclave."""
    if enclave_quorum_public_hex.lower() != expected_signer_public_hex.lower():
        raise TurnkeyBundleError(
            "export bundle signer does not match the expected Turnkey enclave key"
        )
    quorum_key = _load_p256_public(bytes.fromhex(enclave_quorum_public_hex))
    try:
        quorum_key.verify(
            bytes.fromhex(signature_der_hex),
            bytes.fromhex(signed_data_hex),
            ec.ECDSA(hashes.SHA256()),
        )
    except InvalidSignature as exc:
        raise TurnkeyBundleError("export bundle enclave signature is invalid") from exc


def decrypt_export_bundle(
    export_bundle: str,
    receiver_private_hex: str,
    organization_id: str,
    expected_signer_public_hex: str = PRODUCTION_SIGNER_SIGN_PUBLIC_KEY,
) -> bytes:
    """Verify and decrypt an ``exportBundle`` string from ExportWallet/ExportPrivateKey.

    Returns the raw plaintext bytes: for a wallet export that is the UTF-8
    mnemonic; for a private-key export the raw key bytes.
    """
    try:
        bundle = json.loads(export_bundle)
    except (TypeError, ValueError) as exc:
        raise TurnkeyBundleError("export bundle is not valid JSON") from exc

    for field in ("enclaveQuorumPublic", "dataSignature", "data"):
        if not bundle.get(field):
            raise TurnkeyBundleError(f"export bundle is missing '{field}'")

    verify_enclave_signature(
        bundle["enclaveQuorumPublic"],
        bundle["dataSignature"],
        bundle["data"],
        expected_signer_public_hex=expected_signer_public_hex,
    )

    try:
        signed = json.loads(bytes.fromhex(bundle["data"]).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise TurnkeyBundleError("export bundle signed data is malformed") from exc

    if not signed.get("organizationId") or signed["organizationId"] != organization_id:
        raise TurnkeyBundleError(
            f"export bundle organization mismatch: expected {organization_id},"
            f" got {signed.get('organizationId')}"
        )
    if not signed.get("encappedPublic") or not signed.get("ciphertext"):
        raise TurnkeyBundleError("export bundle signed data lacks encappedPublic/ciphertext")

    return hpke_decrypt(
        bytes.fromhex(signed["ciphertext"]),
        bytes.fromhex(signed["encappedPublic"]),
        receiver_private_hex,
    )
