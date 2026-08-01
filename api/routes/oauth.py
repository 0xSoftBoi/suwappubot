"""
OAuth API routes for Google and Twitter authentication.

Provides endpoints for:
- Starting OAuth flow (redirect to provider)
- Handling OAuth callback
- Linking OAuth to existing accounts
- Unlinking OAuth identities
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import logging
import base64
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from bot.services.oauth_service import get_oauth_service, OAuthError, OAuthUserInfo
from bot.services.turnkey_client import get_turnkey_client, is_turnkey_configured
from bot.config.settings import settings
from bot.models.user import User, Wallet
from bot.models.oauth import OAuthIdentity, OAuthToken, OAuthState
from database.db import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/oauth", tags=["OAuth"])

# Name of the HttpOnly cookie that binds a login OAuth flow to the browser that
# initiated it. Set at /authorize (login action), required to match the stored
# OAuthState.login_nonce at /callback. Prevents login CSRF / session fixation.
OAUTH_NONCE_COOKIE = "suwappu_oauth_nonce"


# --- Pydantic Models ---


class OAuthStartResponse(BaseModel):
    """Response for starting OAuth flow."""

    authorization_url: str
    state: str


class OAuthCallbackResponse(BaseModel):
    """Response for OAuth callback."""

    success: bool
    token: str
    user: Dict[str, Any]
    expiresAt: datetime
    is_new_user: bool


class OAuthLinkRequest(BaseModel):
    """Request to link OAuth to existing account."""

    provider: str


class OAuthLinkResponse(BaseModel):
    """Response for OAuth linking."""

    authorization_url: str
    state: str


class OAuthIdentityResponse(BaseModel):
    """OAuth identity info."""

    id: int
    provider: str
    email: Optional[str]
    name: Optional[str]
    profile_image: Optional[str]
    is_primary: bool
    created_at: datetime


class OAuthProviderStatus(BaseModel):
    """Status of OAuth providers."""

    google: bool
    twitter: bool


# --- Dependencies ---


def get_db():
    with get_session() as session:
        yield session


async def get_current_user(
    db: Session = Depends(get_db),
    request: Request = None,
) -> Optional[User]:
    """Get current user from JWT token if authenticated."""
    from api.main import get_current_user_from_token

    user_payload = await get_current_user_from_token(request)
    if not user_payload:
        return None

    user_id = user_payload.get("user_id")
    return db.query(User).filter(User.id == user_id).first() if user_id else None


# --- Endpoints ---


@router.get("/providers", response_model=OAuthProviderStatus)
async def get_oauth_providers():
    """
    Get available OAuth providers.

    Returns which providers are configured and available.
    """
    return OAuthProviderStatus(
        google=settings.is_oauth_configured("google"),
        twitter=settings.is_oauth_configured("twitter"),
    )


def _is_allowed_redirect(redirect_url: Optional[str]) -> bool:
    """
    Validate a user-supplied OAuth redirect URL against the allowlist.

    Only absolute URLs whose origin (scheme+host, optionally a path beneath it)
    match one of the configured ``oauth_redirect_base`` entries are permitted —
    preventing open-redirect / authorization-code interception via attacker-
    controlled destinations. ``None`` is allowed (the callback falls back to the
    default dashboard URL). ``oauth_redirect_base`` may be a single base or a
    comma-separated list.
    """
    if redirect_url is None:
        return True

    allowed_bases = [
        base.strip().rstrip("/")
        for base in (settings.oauth_redirect_base or "").split(",")
        if base.strip()
    ]
    if not allowed_bases:
        return False

    for base in allowed_bases:
        # Exact base, or a path beneath it. The trailing "/" stops
        # "https://app.example.com.attacker.com" from matching
        # "https://app.example.com".
        if redirect_url == base or redirect_url.startswith(base + "/"):
            return True
    return False


@router.get("/{provider}/authorize")
async def oauth_authorize(
    provider: str,
    redirect_url: Optional[str] = Query(None, description="URL to redirect after auth"),
    db: Session = Depends(get_db),
):
    """
    Start OAuth authorization flow.

    Redirects the user to the OAuth provider's authorization page.

    Args:
        provider: OAuth provider ("google" or "twitter")
        redirect_url: Optional URL to redirect after successful auth
    """
    if provider not in ("google", "twitter"):
        raise HTTPException(status_code=400, detail="Invalid OAuth provider")

    if not settings.is_oauth_configured(provider):
        raise HTTPException(status_code=501, detail=f"OAuth not configured for {provider}")

    # Reject a non-allowlisted redirect_url before persisting any state, to
    # prevent open redirect / authorization-code interception.
    if not _is_allowed_redirect(redirect_url):
        logger.warning(f"OAuth authorize: rejected redirect_url for provider {provider}")
        raise HTTPException(status_code=400, detail="Invalid redirect URL")

    oauth_service = get_oauth_service()

    # Generate state and PKCE
    state = oauth_service.generate_state()
    auth_url, code_verifier = oauth_service.get_authorization_url(provider, state)

    # Bind this login flow to the initiating browser: a random nonce is stored on
    # the state row AND set as an HttpOnly cookie. The callback rejects the flow
    # unless the cookie matches — so an attacker who captures a valid code+state
    # cannot replay it in a victim's browser (login CSRF / session fixation).
    login_nonce = secrets.token_urlsafe(32)

    # Store state in database for CSRF validation
    oauth_state = OAuthState(
        state=state,
        provider=provider,
        redirect_uri=redirect_url,
        code_verifier=code_verifier,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
        action="login",
        login_nonce=login_nonce,
    )
    db.add(oauth_state)
    db.commit()

    # Redirect to OAuth provider, setting the browser-bound nonce cookie. Scoped
    # narrowly to the callback path; Secure + HttpOnly + SameSite=Lax so it rides
    # the top-level provider redirect back to us but is not JS-readable.
    redirect = RedirectResponse(url=auth_url, status_code=302)
    redirect.set_cookie(
        key=OAUTH_NONCE_COOKIE,
        value=login_nonce,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=600,
        path="/auth/oauth",
    )
    return redirect


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: str = Query(..., description="Authorization code"),
    state: str = Query(..., description="State parameter"),
    error: Optional[str] = Query(None, description="Error from provider"),
    error_description: Optional[str] = Query(None),
    response: Response = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Handle OAuth callback from provider.

    Exchanges authorization code for tokens, fetches user info,
    and creates or updates user account.
    """
    if error:
        logger.warning(f"OAuth callback error: {error} - {error_description}")
        # Redirect to frontend with error
        error_url = f"{settings.oauth_redirect_base}/auth/error?error={error}"
        return RedirectResponse(url=error_url, status_code=302)

    # Validate state (CSRF protection)
    oauth_state = (
        db.query(OAuthState)
        .filter(
            OAuthState.state == state,
            OAuthState.provider == provider,
        )
        .first()
    )

    if not oauth_state:
        logger.warning(f"OAuth callback: invalid state {state[:10]}...")
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    if oauth_state.is_expired:
        db.delete(oauth_state)
        db.commit()
        raise HTTPException(status_code=400, detail="OAuth state expired")

    # For account-linking flows the OAuth identity must be bound to the user who
    # actually initiated the flow and is currently authenticated. Without this,
    # an attacker could pre-seed a "link" state bound to a victim's user_id and
    # trick the victim into authorizing — binding the attacker's OAuth identity
    # to the victim's account (or vice versa). Require the session to match the
    # state's user_id. Login flows (action="login", no user_id) are unaffected.
    if oauth_state.action == "link" or oauth_state.user_id is not None:
        if current_user is None or current_user.id != oauth_state.user_id:
            logger.warning(
                "OAuth callback: link user mismatch "
                f"(state_user={oauth_state.user_id}, "
                f"session_user={getattr(current_user, 'id', None)})"
            )
            db.delete(oauth_state)
            db.commit()
            raise HTTPException(
                status_code=403,
                detail="Authentication required to link this account",
            )
    else:
        # Login flow: bind to the browser that started /authorize. The nonce
        # cookie must be present and match the value stored on the state row.
        # Missing/mismatched cookie => the callback was not initiated by this
        # browser (login CSRF / session fixation) — reject before issuing any
        # session. Constant-time compare avoids leaking the nonce via timing.
        presented_nonce = request.cookies.get(OAUTH_NONCE_COOKIE) if request else None
        expected_nonce = oauth_state.login_nonce
        if (
            not expected_nonce
            or not presented_nonce
            or not secrets.compare_digest(presented_nonce, expected_nonce)
        ):
            logger.warning(
                "OAuth callback: login nonce mismatch "
                f"(state={state[:10]}..., cookie_present={presented_nonce is not None})"
            )
            db.delete(oauth_state)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail="Invalid or missing login verification",
            )

    oauth_service = get_oauth_service()

    try:
        # Exchange code for tokens
        tokens = await oauth_service.exchange_code(
            provider=provider,
            code=code,
            code_verifier=oauth_state.code_verifier,
        )

        # Fetch user info
        user_info = await oauth_service.get_user_info(
            provider=provider,
            access_token=tokens.access_token,
        )

    except OAuthError as e:
        logger.error(f"OAuth flow failed: {e}")
        db.delete(oauth_state)
        db.commit()
        # The one-time login nonce has served its purpose; clear it from the browser.
        response.delete_cookie(key=OAUTH_NONCE_COOKIE, path="/auth/oauth")
        raise HTTPException(status_code=400, detail=str(e))

    # Find or create user
    is_new_user = False
    user, oauth_identity = await _find_or_create_user(
        db=db,
        user_info=user_info,
        oauth_state=oauth_state,
    )

    if not oauth_identity:
        is_new_user = True
        user, oauth_identity = await _create_oauth_user(
            db=db,
            user_info=user_info,
        )

    # Store encrypted tokens
    await _store_oauth_tokens(
        db=db,
        identity=oauth_identity,
        tokens=tokens,
    )

    # Update last login
    oauth_identity.last_login_at = datetime.utcnow()
    db.commit()

    # Clean up state
    db.delete(oauth_state)
    db.commit()

    # Create JWT token. Mirror the passkey flow: put the user's real wallet
    # address in the session so address-keyed features (portfolio, perps
    # positions, the terminal header) work. Fall back to a synthetic identifier
    # only when no wallet exists yet (e.g. Turnkey wasn't configured).
    from api.main import create_jwt_token, JWT_EXPIRY_HOURS

    wallet = (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user.id,
            Wallet.is_active == True,
        )
        .order_by(Wallet.is_default.desc(), Wallet.id.asc())
        .first()
    )
    session_address = wallet.address if wallet else f"oauth:{provider}:{user_info.provider_user_id}"
    # OAuth (Google/etc.) proves the user's identity with that provider, not
    # possession of their crypto wallet — no wallet signature or WebAuthn
    # assertion is checked here. Stamp 'weak' rather than inventing a strong
    # provenance value; api-ts's requireProofOfPossession must reject this on
    # the agent-approvals surface.
    jwt_token = create_jwt_token(
        address=session_address,
        user_id=user.id,
        src="weak",
    )
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set cookie
    response.set_cookie(
        key="suwappu_auth",
        value=jwt_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
    )

    # Redirect to frontend success page. Re-validate the stored redirect_uri as
    # defense-in-depth — never emit a Location header to a non-allowlisted
    # destination even if a state row was somehow persisted with a bad value.
    redirect_url = oauth_state.redirect_uri
    if not redirect_url or not _is_allowed_redirect(redirect_url):
        default_base = settings.oauth_redirect_base.split(",")[0].strip().rstrip("/")
        redirect_url = f"{default_base}/dashboard"
    success_url = f"{redirect_url}?auth=success&provider={provider}"

    success_redirect = RedirectResponse(url=success_url, status_code=302)
    # The one-time login nonce has served its purpose; clear it from the browser.
    success_redirect.delete_cookie(key=OAUTH_NONCE_COOKIE, path="/auth/oauth")
    return success_redirect


@router.post("/link", response_model=OAuthLinkResponse)
async def oauth_link(
    link_request: OAuthLinkRequest,
    db: Session = Depends(get_db),
    request: Request = None,
    current_user: User = Depends(get_current_user),
):
    """
    Link OAuth account to existing user.

    Requires authenticated user. Starts OAuth flow for linking.
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")

    provider = link_request.provider
    if provider not in ("google", "twitter"):
        raise HTTPException(status_code=400, detail="Invalid OAuth provider")

    if not settings.is_oauth_configured(provider):
        raise HTTPException(status_code=501, detail=f"OAuth not configured for {provider}")

    # Check if provider not already linked
    existing = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.user_id == current_user.id,
            OAuthIdentity.provider == provider,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400, detail=f"{provider.capitalize()} account already linked"
        )

    oauth_service = get_oauth_service()

    # Generate state and PKCE for linking
    state = oauth_service.generate_state()
    auth_url, code_verifier = oauth_service.get_authorization_url(provider, state)

    # Store state in database for CSRF validation with action="link"
    oauth_state = OAuthState(
        state=state,
        provider=provider,
        code_verifier=code_verifier,
        action="link",  # Important - this tells callback to link, not create new user
        user_id=current_user.id,  # Link to this user
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    db.add(oauth_state)
    db.commit()

    return OAuthLinkResponse(
        authorization_url=auth_url,
        state=state,
    )


@router.delete("/unlink/{provider}")
async def oauth_unlink(
    provider: str,
    db: Session = Depends(get_db),
    request: Request = None,
    current_user: User = Depends(get_current_user),
):
    """
    Unlink OAuth account from user.

    User must have another authentication method available.
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")

    if provider not in ("google", "twitter"):
        raise HTTPException(status_code=400, detail="Invalid OAuth provider")

    # Find identity to unlink
    identity = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.user_id == current_user.id,
            OAuthIdentity.provider == provider,
        )
        .first()
    )

    if not identity:
        raise HTTPException(status_code=404, detail=f"{provider.capitalize()} account not linked")

    # Safety check - must have other auth methods
    other_identities = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.user_id == current_user.id,
            OAuthIdentity.id != identity.id,
        )
        .count()
    )

    has_telegram = current_user.telegram_id is not None
    has_wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).count() > 0

    if other_identities == 0 and not has_telegram and not has_wallet:
        raise HTTPException(
            status_code=400, detail="Cannot unlink: this is your only authentication method"
        )

    # If unlinking primary, promote another to primary
    if identity.is_primary and other_identities > 0:
        new_primary = (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.user_id == current_user.id,
                OAuthIdentity.id != identity.id,
            )
            .first()
        )
        if new_primary:
            new_primary.is_primary = True

    # Delete identity (cascade deletes tokens via relationship)
    db.delete(identity)
    db.commit()

    return {"success": True, "message": f"{provider.capitalize()} account unlinked"}


@router.get("/identities", response_model=list[OAuthIdentityResponse])
async def get_oauth_identities(
    db: Session = Depends(get_db),
    request: Request = None,
    current_user: User = Depends(get_current_user),
):
    """
    Get all OAuth identities linked to current user.
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")

    identities = db.query(OAuthIdentity).filter(OAuthIdentity.user_id == current_user.id).all()

    return [
        OAuthIdentityResponse(
            id=identity.id,
            provider=identity.provider,
            email=identity.email,
            name=identity.name,
            profile_image=identity.profile_image,
            is_primary=identity.is_primary,
            created_at=identity.created_at,
        )
        for identity in identities
    ]


# --- Helper Functions ---


async def _find_or_create_user(
    db: Session,
    user_info: OAuthUserInfo,
    oauth_state: OAuthState,
) -> tuple[Optional[User], Optional[OAuthIdentity]]:
    """
    Find existing user by OAuth identity.

    Returns (user, identity) if found, (None, None) otherwise.
    """
    # Check if OAuth identity exists
    identity = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.provider == user_info.provider,
            OAuthIdentity.provider_user_id == user_info.provider_user_id,
        )
        .first()
    )

    if identity:
        user = db.query(User).filter(User.id == identity.user_id).first()
        return user, identity

    # Check if linking to existing user
    if oauth_state.user_id:
        user = db.query(User).filter(User.id == oauth_state.user_id).first()
        if user:
            # Create new identity for existing user
            identity = OAuthIdentity(
                user_id=user.id,
                provider=user_info.provider,
                provider_user_id=user_info.provider_user_id,
                email=user_info.email,
                name=user_info.name,
                profile_image=user_info.profile_image,
                is_verified=user_info.email_verified,
            )
            db.add(identity)
            db.commit()
            return user, identity

    return None, None


async def _create_oauth_user(
    db: Session,
    user_info: OAuthUserInfo,
) -> tuple[User, OAuthIdentity]:
    """
    Create new user from OAuth login.

    Also creates a Turnkey sub-org and wallet if configured.
    """
    # Create user
    user = User(
        telegram_id=None,
        username=user_info.name or f"oauth_{user_info.provider_user_id[:8]}",
        first_name=user_info.name,
        created_at=datetime.utcnow(),
        tos_accepted=True,  # OAuth implies acceptance
        tos_accepted_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Create OAuth identity
    identity = OAuthIdentity(
        user_id=user.id,
        provider=user_info.provider,
        provider_user_id=user_info.provider_user_id,
        email=user_info.email,
        name=user_info.name,
        profile_image=user_info.profile_image,
        is_verified=user_info.email_verified,
        is_primary=True,
    )
    db.add(identity)
    db.commit()

    # Create Turnkey wallet if configured
    if is_turnkey_configured():
        try:
            await _create_turnkey_wallet_for_user(db, user, user_info)
        except Exception as e:
            logger.error(f"Failed to create Turnkey wallet for OAuth user: {e}")
            # Continue without wallet - user can create later

    return user, identity


async def _create_turnkey_wallet_for_user(
    db: Session,
    user: User,
    user_info: OAuthUserInfo,
) -> Wallet:
    """Create Turnkey sub-org and wallet for new OAuth user."""
    turnkey = get_turnkey_client()

    # Create sub-organization for user
    sub_org_name = f"user_{user.id}_{user_info.provider}"
    sub_org = await turnkey.create_sub_organization(
        name=sub_org_name,
        root_user_email=user_info.email,
    )

    # Create EVM wallet
    wallet_name = f"{user_info.name or 'OAuth'} Wallet"
    turnkey_wallet = await turnkey.create_wallet(
        wallet_name=wallet_name,
        chain_type="evm",
        organization_id=sub_org.sub_org_id,
    )

    # Store wallet in database
    wallet = Wallet(
        user_id=user.id,
        name=wallet_name,
        address=turnkey_wallet.address,
        chain_type="evm",
        wallet_provider="turnkey",
        turnkey_sub_org_id=sub_org.sub_org_id,
        turnkey_wallet_id=turnkey_wallet.wallet_id,
        turnkey_account_id=turnkey_wallet.account_id,
        is_active=True,
        is_default=True,
    )
    db.add(wallet)
    db.commit()

    logger.info(f"Created Turnkey wallet {wallet.address[:10]}... for OAuth user {user.id}")
    return wallet


async def _store_oauth_tokens(
    db: Session,
    identity: OAuthIdentity,
    tokens,
) -> OAuthToken:
    """
    Store OAuth tokens with KMS envelope encryption.

    Note: Access and refresh tokens are encrypted separately with fresh DEKs,
    but we only store metadata for the access token (refresh uses same scheme).
    """
    from bot.utils.envelope_crypto import encrypt_private_key_v2, encode_for_db

    # Delete existing tokens for this identity
    db.query(OAuthToken).filter(OAuthToken.identity_id == identity.id).delete()

    # Calculate expiration
    expires_at = datetime.utcnow() + timedelta(seconds=tokens.expires_in)

    # Encrypt access token with KMS
    access_encrypted = encrypt_private_key_v2(tokens.access_token)
    access_fields = encode_for_db(access_encrypted)

    # Encrypt refresh token with KMS (if present)
    # Note: We use a concatenated format "nonce:dek:ciphertext" to store all metadata
    refresh_token_encrypted = None
    if tokens.refresh_token:
        refresh_encrypted = encrypt_private_key_v2(tokens.refresh_token)
        # Store as "wrapped_dek|nonce|ciphertext" to preserve all metadata
        refresh_token_encrypted = "|".join(
            [
                base64.b64encode(refresh_encrypted.wrapped_dek).decode("ascii"),
                base64.b64encode(refresh_encrypted.nonce).decode("ascii"),
                base64.b64encode(refresh_encrypted.ciphertext).decode("ascii"),
            ]
        )

    # Create new token record
    oauth_token = OAuthToken(
        identity_id=identity.id,
        access_token_encrypted=access_fields["encrypted_private_key"],
        refresh_token_encrypted=refresh_token_encrypted,
        token_type=tokens.token_type,
        scope=tokens.scope,
        expires_at=expires_at,
        encryption_scheme="kms_aesgcm_v2",
        kms_wrapped_dek=access_fields["kms_wrapped_dek"],
        aesgcm_nonce=access_fields["aesgcm_nonce"],
    )
    db.add(oauth_token)
    db.commit()

    return oauth_token


def _get_oauth_access_token(db: Session, identity_id: int) -> Optional[str]:
    """
    Get and decrypt OAuth access token for an identity.

    Args:
        db: Database session
        identity_id: The OAuth identity ID

    Returns:
        Decrypted access token or None if not found/expired
    """
    from bot.utils.envelope_crypto import decrypt_wallet_key

    # Query token
    oauth_token = db.query(OAuthToken).filter(OAuthToken.identity_id == identity_id).first()

    if not oauth_token:
        return None

    # Check expiration
    if oauth_token.is_expired:
        logger.warning(f"OAuth token expired for identity {identity_id}")
        return None

    # Decrypt access token
    try:
        access_token = decrypt_wallet_key(
            encrypted_private_key=oauth_token.access_token_encrypted,
            encryption_scheme=oauth_token.encryption_scheme,
            kms_wrapped_dek=oauth_token.kms_wrapped_dek,
            aesgcm_nonce=oauth_token.aesgcm_nonce,
        )
        return access_token
    except Exception as e:
        logger.error(f"Failed to decrypt OAuth access token: {e}")
        return None
