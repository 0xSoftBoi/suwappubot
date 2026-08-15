"""DKIM (RFC 6376) signature verification — the trust-minimized core of
zk-email social recovery.

zk-email's insight is that an email is *cryptographically* authenticated by the
sending domain via its DKIM signature (RSA-SHA256 over canonicalized headers,
public key in DNS). Verifying that signature ourselves — rather than trusting a
provider like Turnkey to do it — is what makes email a trustworthy recovery
factor. The on-chain *zk* variant proves the same DKIM check inside a circuit so
a contract can verify it without revealing the email; here, the bot backend is
the (already trusted) verifier, so a direct DKIM check is the right primitive.

We rely on ``cryptography`` for the RSA/SHA-256 primitives (not hand-rolled) and
implement only the RFC 6376 canonicalization, which is validated against the
spec's own known-answer vectors in the tests.

Scope: rsa-sha256 with relaxed/relaxed and simple/simple canonicalization — what
Gmail, Outlook, and other major providers emit. Other algorithms are reported as
unverified rather than silently accepted (fail closed).
"""

import base64
import hashlib
import logging
import re
from dataclasses import dataclass
from email.parser import BytesParser
from email.utils import parseaddr
from typing import Callable, Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_der_public_key

logger = logging.getLogger(__name__)

# A resolver maps (selector, domain) -> base64 DER public key (the DKIM ``p=``
# value), or None if not found. Injectable so verification is testable offline.
PublicKeyResolver = Callable[[str, str], Optional[str]]


@dataclass
class DkimResult:
    verified: bool
    domain: Optional[str] = None  # DKIM ``d=`` domain (the authenticated signer)
    from_address: Optional[str] = None  # parsed From: header address
    subject: Optional[str] = None  # decoded-as-bytes Subject header (raw)
    reason: str = ""


# ── Canonicalization (RFC 6376 §3.4) ─────────────────────────────────────────


def canonicalize_header_relaxed(name: bytes, value: bytes) -> bytes:
    """Relaxed header canonicalization for a single header field (RFC 6376 §3.4.2)."""
    name = name.lower().strip(b" \t")
    value = re.sub(rb"\r\n([ \t])", rb"\1", value)  # unfold continuation lines
    value = re.sub(rb"[ \t]+", b" ", value)  # collapse WSP runs to a single SP
    value = value.strip(b" \t")  # drop WSP around the value (incl. after the colon)
    return name + b":" + value + b"\r\n"


def canonicalize_body_relaxed(body: bytes) -> bytes:
    """Relaxed body canonicalization (RFC 6376 §3.4.4)."""
    lines = body.split(b"\r\n")
    canon_lines = []
    for line in lines:
        line = re.sub(rb"[ \t]+", b" ", line)  # collapse internal WSP
        line = line.rstrip(b" \t")  # ignore trailing WSP
        canon_lines.append(line)
    canon = b"\r\n".join(canon_lines)
    canon = canon.rstrip(b"\r\n")  # ignore all empty lines at the end
    return canon + b"\r\n" if canon else b""


def canonicalize_body_simple(body: bytes) -> bytes:
    """Simple body canonicalization (RFC 6376 §3.4.3): strip trailing empty
    lines; an empty body becomes a single CRLF."""
    canon = body.rstrip(b"\r\n")
    return canon + b"\r\n" if canon else b"\r\n"


def _parse_tags(value: str) -> dict:
    """Parse a DKIM tag-list (``v=1; a=rsa-sha256; ...``) into a dict."""
    tags: dict = {}
    for part in value.split(";"):
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        tags[k.strip()] = (
            re.sub(r"\s+", "", v.strip()) if k.strip() in ("b", "bh", "p") else v.strip()
        )
    return tags


def _dns_txt_resolver(selector: str, domain: str) -> Optional[str]:
    """Default resolver: fetch ``selector._domainkey.domain`` TXT and return p=."""
    try:
        import dns.resolver  # dnspython

        name = f"{selector}._domainkey.{domain}"
        answers = dns.resolver.resolve(name, "TXT")
        record = "".join(
            b.decode() if isinstance(b, bytes) else b for rdata in answers for b in rdata.strings
        )
        tags = _parse_tags(record)
        return tags.get("p") or None
    except Exception as e:  # noqa: BLE001 — DNS failures must fail closed, not crash
        logger.warning(f"DKIM DNS lookup failed for {selector}._domainkey.{domain}: {e}")
        return None


def verify_email(
    raw: bytes,
    public_key_resolver: Optional[PublicKeyResolver] = None,
) -> DkimResult:
    """Verify the DKIM signature of a raw RFC 5322 email.

    Returns a ``DkimResult``; ``verified`` is True only when the body hash and
    the header signature both check out against the signer's published key.
    """
    resolver = public_key_resolver or _dns_txt_resolver

    raw = raw.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")  # normalize to CRLF
    msg = BytesParser().parsebytes(raw)

    dkim_header = msg.get("DKIM-Signature")
    if not dkim_header:
        return DkimResult(False, reason="no DKIM-Signature header")

    from_address = parseaddr(msg.get("From", ""))[1] or None
    subject = msg.get("Subject")

    tags = _parse_tags(dkim_header)
    algo = tags.get("a", "rsa-sha256")
    if algo != "rsa-sha256":
        return DkimResult(
            False,
            from_address=from_address,
            subject=subject,
            reason=f"unsupported algorithm {algo}",
        )

    domain = tags.get("d")
    selector = tags.get("s")
    signed_headers = [h.strip().lower() for h in tags.get("h", "").split(":") if h.strip()]
    bh_b64 = tags.get("bh", "")
    b_b64 = tags.get("b", "")
    if not (domain and selector and signed_headers and bh_b64 and b_b64):
        return DkimResult(
            False,
            domain=domain,
            from_address=from_address,
            subject=subject,
            reason="missing required DKIM tags",
        )

    header_canon, _, body_canon = tags.get("c", "simple/simple").partition("/")
    body_canon = body_canon or "simple"

    # Split raw message into header block and body.
    sep = raw.find(b"\r\n\r\n")
    body = raw[sep + 4 :] if sep != -1 else b""

    # 1) Body hash.
    canon_body = (
        canonicalize_body_relaxed(body)
        if body_canon == "relaxed"
        else canonicalize_body_simple(body)
    )
    if "l" in tags:
        try:
            canon_body = canon_body[: int(tags["l"])]
        except ValueError:
            pass
    computed_bh = base64.b64encode(hashlib.sha256(canon_body).digest()).decode()
    if computed_bh != bh_b64:
        return DkimResult(
            False,
            domain=domain,
            from_address=from_address,
            subject=subject,
            reason="body hash mismatch",
        )

    # 2) Header signature. Build the signed header set in h= order, taking the
    # bottom-most unused instance of each (RFC 6376 §5.4.2), then append the
    # DKIM-Signature header itself with an emptied b= and no trailing CRLF.
    raw_headers = _split_headers(raw[: sep if sep != -1 else len(raw)])
    by_name: dict = {}
    for name, value in raw_headers:
        by_name.setdefault(name.lower(), []).append((name, value))

    signing_input = b""
    for hname in signed_headers:
        instances = by_name.get(hname.encode())
        if not instances:
            continue  # a signed header that's absent contributes nothing
        name, value = instances.pop()  # bottom-most unused
        if header_canon == "relaxed":
            signing_input += canonicalize_header_relaxed(name, value)
        else:
            signing_input += name + b":" + value + b"\r\n"

    dkim_name, dkim_value = _find_raw_header(raw_headers, b"dkim-signature")
    if dkim_name is None:
        return DkimResult(
            False,
            domain=domain,
            from_address=from_address,
            subject=subject,
            reason="DKIM-Signature header not found in raw block",
        )
    # Strip the b= value (keep the tag), per RFC: the b= tag is included empty.
    stripped_value = re.sub(rb"(b=)[^;]*", rb"\1", dkim_value)
    if header_canon == "relaxed":
        dkim_canon = canonicalize_header_relaxed(dkim_name, stripped_value).rstrip(b"\r\n")
    else:
        dkim_canon = dkim_name + b":" + stripped_value
    signing_input += dkim_canon

    pub_b64 = resolver(selector, domain)
    if not pub_b64:
        return DkimResult(
            False,
            domain=domain,
            from_address=from_address,
            subject=subject,
            reason="public key not found",
        )

    try:
        pubkey = load_der_public_key(base64.b64decode(pub_b64))
        pubkey.verify(
            base64.b64decode(b_b64),
            signing_input,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except Exception as e:  # noqa: BLE001 — any verification failure is a non-match
        return DkimResult(
            False,
            domain=domain,
            from_address=from_address,
            subject=subject,
            reason=f"signature verification failed: {e}",
        )

    return DkimResult(True, domain=domain, from_address=from_address, subject=subject, reason="ok")


def _split_headers(header_block: bytes) -> list:
    """Split a raw header block into (name, value) pairs, preserving raw values
    (including internal folding) but excluding the trailing CRLF of each field."""
    # Unfold-aware split: a header starts at a line that is not WSP-continued.
    headers = []
    current = b""
    for line in header_block.split(b"\r\n"):
        if line[:1] in (b" ", b"\t") and current:
            current += b"\r\n" + line
        else:
            if current:
                headers.append(current)
            current = line
    if current:
        headers.append(current)
    result = []
    for h in headers:
        name, _, value = h.partition(b":")
        if _:
            result.append((name, value))
    return result


def _find_raw_header(raw_headers: list, lname: bytes):
    for name, value in raw_headers:
        if name.lower().strip() == lname:
            return name, value
    return None, None
