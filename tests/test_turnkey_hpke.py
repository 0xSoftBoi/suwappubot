"""HPKE port is cross-checked against a vector produced by @turnkey/crypto (JS).

The vector below was generated with the official library's ``hpkeEncrypt`` for a
freshly generated receiver key; decrypting it here proves the Python port matches
Turnkey's KEM/KDF/AEAD construction byte for byte.
"""

import json

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from bot.utils.turnkey_hpke import (
    TurnkeyBundleError,
    decrypt_export_bundle,
    generate_target_keypair,
    hpke_decrypt,
    verify_enclave_signature,
)

RECEIVER_PRIV = "6f32df40622c998f1ed0dfdc9f7fea8045ffedd87165fb5837d04f93de29abd3"
RECEIVER_PUB = "043a31b8f0a0ac332498f9967f5b70e38c2652590238de6af9e30a479937d2f041ff2689ef28f2662a3530137807d2b3bf7ae183b2741ebad20549626b55f46842"
ENCAPPED = "04bb89b61964689e13252763a298cabe7ca3bd094425d808b6f9b4fabe1caa5c2abff8f5eded04a3587149e3ca87a556b483e27d764f1de4e365678bf9b77224f1"
CIPHERTEXT = "17fbca01060d204639553d781e124d98fe3f13cd53a9b5e0294f264ecdcd48b2bc134805459144fb2db34531bb753508b0845e7dd682b389f52a66a3ff405f5da3079e68c8c650edcecd7087e1210c94bd7e518f71272f6e6c6716179d22d5dff92ee1c336fbc84fffa3bfcd12"
PLAINTEXT = (
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
)


def test_decrypts_vector_from_turnkey_js_library():
    out = hpke_decrypt(bytes.fromhex(CIPHERTEXT), bytes.fromhex(ENCAPPED), RECEIVER_PRIV)
    assert out.decode() == PLAINTEXT


def test_wrong_receiver_key_fails_closed():
    other = generate_target_keypair()
    with pytest.raises(TurnkeyBundleError):
        hpke_decrypt(bytes.fromhex(CIPHERTEXT), bytes.fromhex(ENCAPPED), other.private_hex)


def test_generated_target_key_is_uncompressed_p256():
    kp = generate_target_keypair()
    assert len(kp.public_uncompressed_hex) == 130 and kp.public_uncompressed_hex.startswith("04")
    assert len(kp.private_hex) == 64


def _signed_bundle(signer: ec.EllipticCurvePrivateKey, org: str) -> tuple[str, str]:
    signer_pub = (
        signer.public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        .hex()
    )
    data = json.dumps(
        {"encappedPublic": ENCAPPED, "ciphertext": CIPHERTEXT, "organizationId": org}
    ).encode()
    sig = signer.sign(data, ec.ECDSA(hashes.SHA256())).hex()
    bundle = json.dumps(
        {
            "version": "v1.0.0",
            "data": data.hex(),
            "dataSignature": sig,
            "enclaveQuorumPublic": signer_pub,
        }
    )
    return bundle, signer_pub


def test_decrypt_export_bundle_end_to_end_with_override_signer():
    signer = ec.generate_private_key(ec.SECP256R1())
    bundle, signer_pub = _signed_bundle(signer, "org-123")
    out = decrypt_export_bundle(
        bundle, RECEIVER_PRIV, "org-123", expected_signer_public_hex=signer_pub
    )
    assert out.decode() == PLAINTEXT


def test_bundle_rejects_wrong_org_and_wrong_signer():
    signer = ec.generate_private_key(ec.SECP256R1())
    bundle, signer_pub = _signed_bundle(signer, "org-123")
    with pytest.raises(TurnkeyBundleError, match="organization"):
        decrypt_export_bundle(
            bundle, RECEIVER_PRIV, "org-999", expected_signer_public_hex=signer_pub
        )
    # Default expectation is Turnkey's production signer; a self-signed bundle must fail.
    with pytest.raises(TurnkeyBundleError, match="signer"):
        decrypt_export_bundle(bundle, RECEIVER_PRIV, "org-123")


def test_tampered_signature_is_rejected():
    signer = ec.generate_private_key(ec.SECP256R1())
    bundle, signer_pub = _signed_bundle(signer, "org-123")
    parsed = json.loads(bundle)
    parsed["data"] = parsed["data"][:-2] + ("00" if parsed["data"][-2:] != "00" else "11")
    with pytest.raises(TurnkeyBundleError, match="signature"):
        verify_enclave_signature(
            parsed["enclaveQuorumPublic"], parsed["dataSignature"], parsed["data"], signer_pub
        )


# --- TurnkeyClient.export_wallet wiring -----------------------------------


async def test_export_wallet_sends_target_key_and_decrypts_bundle(monkeypatch):
    from bot.services.turnkey_client import TurnkeyClient

    signer = ec.generate_private_key(ec.SECP256R1())
    client = TurnkeyClient.__new__(TurnkeyClient)
    client._org_id = "parent-org"
    client.export_signer_public_key_hex = (
        signer.public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        .hex()
    )

    captured: dict = {}

    async def fake_submit(activity_type, params, organization_id=None):
        captured.update(type=activity_type, params=params, org=organization_id)
        # Encrypt a mnemonic to the caller's target key with the *real* HPKE
        # construction (mirrors what Turnkey's enclave does), sign the bundle.
        from bot.utils.turnkey_hpke import hpke_decrypt  # noqa: F401  (import sanity)

        target_pub = bytes.fromhex(params["targetPublicKey"])
        eph = ec.generate_private_key(ec.SECP256R1())
        eph_pub = eph.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        # Build ciphertext by running the port's own derivation in reverse
        # (encrypt side) — identical KDF inputs, AES-GCM encrypt instead of decrypt.
        from bot.utils import turnkey_hpke as h
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        ss = eph.exchange(
            ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), target_pub)
        )
        kem_context = eph_pub + target_pub
        shared = h._extract_and_expand(
            b"",
            h._labeled_ikm(h.LABEL_EAE_PRK, ss, h.SUITE_ID_1),
            h._labeled_info(h.LABEL_SHARED_SECRET, kem_context, h.SUITE_ID_1, 32),
            32,
        )
        ikm = h._labeled_ikm(h.LABEL_SECRET, b"", h.SUITE_ID_2)
        key = h._extract_and_expand(shared, ikm, h.AES_KEY_INFO, 32)
        iv = h._extract_and_expand(shared, ikm, h.IV_INFO, 12)
        ct = AESGCM(key).encrypt(iv, PLAINTEXT.encode(), eph_pub + target_pub)
        data = json.dumps(
            {
                "encappedPublic": eph_pub.hex(),
                "ciphertext": ct.hex(),
                "organizationId": organization_id,
            }
        ).encode()
        bundle = json.dumps(
            {
                "version": "v1.0.0",
                "data": data.hex(),
                "dataSignature": signer.sign(data, ec.ECDSA(hashes.SHA256())).hex(),
                "enclaveQuorumPublic": client.export_signer_public_key_hex,
            }
        )
        return {"exportWalletResult": {"walletId": params["walletId"], "exportBundle": bundle}}

    monkeypatch.setattr(client, "_submit_activity", fake_submit)
    monkeypatch.setattr(client, "derive_backup_key", lambda m, c="evm", a=None: f"derived:{m}")

    out = await client.export_wallet("wallet-1", organization_id="sub-org-9")

    assert captured["type"] == "ACTIVITY_TYPE_EXPORT_WALLET"
    assert captured["org"] == "sub-org-9"
    assert set(captured["params"]) == {"walletId", "targetPublicKey"}
    assert captured["params"]["targetPublicKey"].startswith("04")
    assert out == f"derived:{PLAINTEXT}"


async def test_export_wallet_rejects_bundle_for_other_org(monkeypatch):
    from bot.services.turnkey_client import TurnkeyClient, TurnkeyActivityError

    signer = ec.generate_private_key(ec.SECP256R1())
    client = TurnkeyClient.__new__(TurnkeyClient)
    client._org_id = "parent-org"
    client.export_signer_public_key_hex = (
        signer.public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        .hex()
    )

    async def fake_submit(activity_type, params, organization_id=None):
        bundle, _ = _signed_bundle(signer, "someone-else")
        return {"exportWalletResult": {"exportBundle": bundle}}

    monkeypatch.setattr(client, "_submit_activity", fake_submit)
    with pytest.raises(TurnkeyActivityError):
        await client.export_wallet("wallet-1", organization_id="sub-org-9")
