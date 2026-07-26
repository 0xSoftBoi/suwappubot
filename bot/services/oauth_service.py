"""
OAuth service for Google and Twitter authentication.

Handles OAuth 2.0 flows including:
- Authorization URL generation
- Token exchange
- User info fetching
- Token refresh
- Account linking
"""

import secrets
import hashlib
import base64
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any
from dataclasses import dataclass
import aiohttp

from bot.config.settings import settings

logger = logging.getLogger(__name__)


@dataclass
class OAuthUserInfo:
    """User information retrieved from OAuth provider."""

    provider: str
    provider_user_id: str
    email: Optional[str]
    name: Optional[str]
    profile_image: Optional[str]
    email_verified: bool = True


@dataclass
class OAuthTokens:
    """OAuth tokens from provider."""

    access_token: str
    refresh_token: Optional[str]
    expires_in: int  # seconds
    token_type: str
    scope: Optional[str]


class OAuthService:
    """
    Service for handling OAuth 2.0 authentication flows.

    Supports Google and Twitter OAuth with PKCE for enhanced security.
    """

    # OAuth provider configurations
    PROVIDERS = {
        "google": {
            "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
            "scopes": ["openid", "email", "profile"],
            "supports_pkce": True,
        },
        "twitter": {
            "auth_url": "https://twitter.com/i/oauth2/authorize",
            "token_url": "https://api.twitter.com/2/oauth2/token",
            "userinfo_url": "https://api.twitter.com/2/users/me",
            "scopes": ["users.read", "tweet.read", "offline.access"],
            "supports_pkce": True,
        },
    }

    def __init__(self):
        self._http_session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create HTTP session."""
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        return self._http_session

    async def close(self):
        """Close HTTP session."""
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()

    def _get_credentials(self, provider: str) -> Tuple[str, str]:
        """Get OAuth credentials for a provider."""
        if provider == "google":
            client_id = settings.google_client_id
            client_secret = settings.google_client_secret
        elif provider == "twitter":
            client_id = settings.twitter_client_id
            client_secret = settings.twitter_client_secret
        else:
            raise ValueError(f"Unknown OAuth provider: {provider}")

        if not client_id or not client_secret:
            raise ValueError(f"OAuth not configured for provider: {provider}")

        return client_id, client_secret

    def _get_redirect_uri(self, provider: str) -> str:
        """Get the OAuth redirect URI."""
        base = settings.oauth_redirect_base.rstrip("/")
        return f"{base}/auth/callback/{provider}"

    @staticmethod
    def _generate_pkce() -> Tuple[str, str]:
        """
        Generate PKCE code verifier and challenge.

        Returns:
            Tuple of (code_verifier, code_challenge)
        """
        # Generate code verifier (43-128 chars of [A-Z, a-z, 0-9, -, ., _, ~])
        code_verifier = secrets.token_urlsafe(64)[:96]

        # Generate code challenge (S256)
        digest = hashlib.sha256(code_verifier.encode()).digest()
        code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

        return code_verifier, code_challenge

    @staticmethod
    def generate_state() -> str:
        """Generate a random state parameter for CSRF protection."""
        return secrets.token_urlsafe(32)

    def get_authorization_url(
        self,
        provider: str,
        state: str,
        code_verifier: Optional[str] = None,
    ) -> Tuple[str, Optional[str]]:
        """
        Generate OAuth authorization URL.

        Args:
            provider: OAuth provider ("google" or "twitter")
            state: State parameter for CSRF protection
            code_verifier: Optional PKCE code verifier (generates new if None)

        Returns:
            Tuple of (authorization_url, code_verifier)
        """
        if provider not in self.PROVIDERS:
            raise ValueError(f"Unknown OAuth provider: {provider}")

        config = self.PROVIDERS[provider]
        client_id, _ = self._get_credentials(provider)
        redirect_uri = self._get_redirect_uri(provider)

        # Build query parameters
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
            "scope": " ".join(config["scopes"]),
        }

        # Add PKCE if supported
        if config.get("supports_pkce"):
            if not code_verifier:
                code_verifier, code_challenge = self._generate_pkce()
            else:
                digest = hashlib.sha256(code_verifier.encode()).digest()
                code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        # Provider-specific params
        if provider == "google":
            params["access_type"] = "offline"  # Get refresh token
            params["prompt"] = "consent"  # Always show consent screen
        elif provider == "twitter":
            params["code_challenge_method"] = "S256"

        # Build URL
        query = "&".join(f"{k}={v}" for k, v in params.items())
        auth_url = f"{config['auth_url']}?{query}"

        return auth_url, code_verifier

    async def exchange_code(
        self,
        provider: str,
        code: str,
        code_verifier: Optional[str] = None,
    ) -> OAuthTokens:
        """
        Exchange authorization code for tokens.

        Args:
            provider: OAuth provider
            code: Authorization code from callback
            code_verifier: PKCE code verifier (required if PKCE was used)

        Returns:
            OAuthTokens with access token and optional refresh token
        """
        if provider not in self.PROVIDERS:
            raise ValueError(f"Unknown OAuth provider: {provider}")

        config = self.PROVIDERS[provider]
        client_id, client_secret = self._get_credentials(provider)
        redirect_uri = self._get_redirect_uri(provider)

        # Build token request
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        if code_verifier and config.get("supports_pkce"):
            data["code_verifier"] = code_verifier

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }

        # Twitter requires basic auth for token exchange
        if provider == "twitter":
            auth_string = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
            headers["Authorization"] = f"Basic {auth_string}"
            # Remove client_secret from body for Twitter
            del data["client_secret"]

        session = await self._get_session()
        async with session.post(
            config["token_url"],
            data=data,
            headers=headers,
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"OAuth token exchange failed: {error_text}")
                raise OAuthError(f"Token exchange failed: {error_text}")

            result = await response.json()

        return OAuthTokens(
            access_token=result["access_token"],
            refresh_token=result.get("refresh_token"),
            expires_in=result.get("expires_in", 3600),
            token_type=result.get("token_type", "Bearer"),
            scope=result.get("scope"),
        )

    async def get_user_info(
        self,
        provider: str,
        access_token: str,
    ) -> OAuthUserInfo:
        """
        Fetch user information from OAuth provider.

        Args:
            provider: OAuth provider
            access_token: Valid access token

        Returns:
            OAuthUserInfo with user details
        """
        if provider not in self.PROVIDERS:
            raise ValueError(f"Unknown OAuth provider: {provider}")

        config = self.PROVIDERS[provider]

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

        # Twitter needs query params for fields
        url = config["userinfo_url"]
        if provider == "twitter":
            url += "?user.fields=id,name,username,profile_image_url"

        session = await self._get_session()
        async with session.get(url, headers=headers) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"OAuth userinfo fetch failed: {error_text}")
                raise OAuthError(f"Failed to fetch user info: {error_text}")

            result = await response.json()

        # Parse provider-specific response
        if provider == "google":
            return OAuthUserInfo(
                provider="google",
                provider_user_id=result["id"],
                email=result.get("email"),
                name=result.get("name"),
                profile_image=result.get("picture"),
                email_verified=result.get("verified_email", True),
            )
        elif provider == "twitter":
            data = result.get("data", {})
            return OAuthUserInfo(
                provider="twitter",
                provider_user_id=data["id"],
                email=None,  # Twitter doesn't provide email in basic scope
                name=data.get("name"),
                profile_image=data.get("profile_image_url"),
                email_verified=True,
            )

        raise ValueError(f"Unknown provider: {provider}")

    async def refresh_token(
        self,
        provider: str,
        refresh_token: str,
    ) -> OAuthTokens:
        """
        Refresh an expired access token.

        Args:
            provider: OAuth provider
            refresh_token: Valid refresh token

        Returns:
            New OAuthTokens
        """
        if provider not in self.PROVIDERS:
            raise ValueError(f"Unknown OAuth provider: {provider}")

        config = self.PROVIDERS[provider]
        client_id, client_secret = self._get_credentials(provider)

        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }

        # Twitter requires basic auth
        if provider == "twitter":
            auth_string = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
            headers["Authorization"] = f"Basic {auth_string}"
            del data["client_secret"]

        session = await self._get_session()
        async with session.post(
            config["token_url"],
            data=data,
            headers=headers,
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"OAuth token refresh failed: {error_text}")
                raise OAuthError(f"Token refresh failed: {error_text}")

            result = await response.json()

        return OAuthTokens(
            access_token=result["access_token"],
            refresh_token=result.get("refresh_token", refresh_token),
            expires_in=result.get("expires_in", 3600),
            token_type=result.get("token_type", "Bearer"),
            scope=result.get("scope"),
        )


class OAuthError(Exception):
    """Raised when OAuth flow fails."""

    pass


# Global service instance
_oauth_service: Optional[OAuthService] = None


def get_oauth_service() -> OAuthService:
    """Get the OAuth service instance."""
    global _oauth_service
    if _oauth_service is None:
        _oauth_service = OAuthService()
    return _oauth_service
