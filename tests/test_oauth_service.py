"""
Tests for OAuth service.

Tests cover:
- OAuth URL generation
- PKCE code generation
- Token exchange (mocked)
- User info fetching (mocked)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import hashlib
import base64

from bot.services.oauth_service import OAuthService, OAuthError, OAuthTokens, OAuthUserInfo


class TestOAuthService:
    """Tests for OAuthService class."""

    @pytest.fixture
    def oauth_service(self):
        """Create an OAuth service instance."""
        return OAuthService()

    def test_generate_state(self, oauth_service):
        """Test state generation for CSRF protection."""
        state1 = oauth_service.generate_state()
        state2 = oauth_service.generate_state()

        # States should be non-empty strings
        assert isinstance(state1, str)
        assert len(state1) > 20

        # States should be unique
        assert state1 != state2

    def test_generate_pkce(self, oauth_service):
        """Test PKCE code verifier and challenge generation."""
        verifier, challenge = oauth_service._generate_pkce()

        # Verifier should be valid
        assert isinstance(verifier, str)
        assert 43 <= len(verifier) <= 128

        # Challenge should be S256 hash of verifier
        expected_digest = hashlib.sha256(verifier.encode()).digest()
        expected_challenge = base64.urlsafe_b64encode(expected_digest).rstrip(b"=").decode()
        assert challenge == expected_challenge

    @patch.object(OAuthService, '_get_credentials')
    def test_get_authorization_url_google(self, mock_creds, oauth_service):
        """Test Google OAuth authorization URL generation."""
        mock_creds.return_value = ("test_client_id", "test_client_secret")

        with patch('bot.services.oauth_service.settings') as mock_settings:
            mock_settings.oauth_redirect_base = "https://app.suwappu.com"

            state = oauth_service.generate_state()
            url, verifier = oauth_service.get_authorization_url("google", state)

            # URL should contain required parameters
            assert "accounts.google.com" in url
            assert "client_id=test_client_id" in url
            assert f"state={state}" in url
            assert "response_type=code" in url
            assert "scope=" in url
            assert "code_challenge=" in url
            assert "code_challenge_method=S256" in url
            assert "access_type=offline" in url

            # Verifier should be returned
            assert verifier is not None

    @patch.object(OAuthService, '_get_credentials')
    def test_get_authorization_url_twitter(self, mock_creds, oauth_service):
        """Test Twitter OAuth authorization URL generation."""
        mock_creds.return_value = ("test_client_id", "test_client_secret")

        with patch('bot.services.oauth_service.settings') as mock_settings:
            mock_settings.oauth_redirect_base = "https://app.suwappu.com"

            state = oauth_service.generate_state()
            url, verifier = oauth_service.get_authorization_url("twitter", state)

            # URL should contain required parameters
            assert "twitter.com" in url
            assert "client_id=test_client_id" in url
            assert f"state={state}" in url
            assert "code_challenge=" in url

    def test_get_authorization_url_invalid_provider(self, oauth_service):
        """Test that invalid provider raises error."""
        with pytest.raises(ValueError, match="Unknown OAuth provider"):
            oauth_service.get_authorization_url("invalid", "state")

    @pytest.mark.asyncio
    async def test_exchange_code_google(self, oauth_service):
        """Test Google token exchange."""
        mock_response = {
            "access_token": "test_access_token",
            "refresh_token": "test_refresh_token",
            "expires_in": 3600,
            "token_type": "Bearer",
            "scope": "openid email profile",
        }

        with patch.object(oauth_service, '_get_credentials') as mock_creds:
            mock_creds.return_value = ("test_client_id", "test_client_secret")

            with patch('bot.services.oauth_service.settings') as mock_settings:
                mock_settings.oauth_redirect_base = "https://app.suwappu.com"

                with patch.object(oauth_service, '_get_session') as mock_session:
                    mock_resp = AsyncMock()
                    mock_resp.status = 200
                    mock_resp.json = AsyncMock(return_value=mock_response)

                    # Create a proper async context manager for session.post()
                    mock_post_cm = AsyncMock()
                    mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
                    mock_post_cm.__aexit__ = AsyncMock(return_value=None)

                    mock_client = AsyncMock()
                    mock_client.post = MagicMock(return_value=mock_post_cm)
                    mock_session.return_value = mock_client

                    tokens = await oauth_service.exchange_code(
                        provider="google",
                        code="test_code",
                        code_verifier="test_verifier",
                    )

                    assert tokens.access_token == "test_access_token"
                    assert tokens.refresh_token == "test_refresh_token"
                    assert tokens.expires_in == 3600

    @pytest.mark.asyncio
    async def test_exchange_code_error(self, oauth_service):
        """Test token exchange error handling."""
        with patch.object(oauth_service, '_get_credentials') as mock_creds:
            mock_creds.return_value = ("test_client_id", "test_client_secret")

            with patch('bot.services.oauth_service.settings') as mock_settings:
                mock_settings.oauth_redirect_base = "https://app.suwappu.com"

                with patch.object(oauth_service, '_get_session') as mock_session:
                    mock_resp = AsyncMock()
                    mock_resp.status = 400
                    mock_resp.text = AsyncMock(return_value="Invalid code")

                    # Create a proper async context manager for session.post()
                    mock_post_cm = AsyncMock()
                    mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
                    mock_post_cm.__aexit__ = AsyncMock(return_value=None)

                    mock_client = AsyncMock()
                    mock_client.post = MagicMock(return_value=mock_post_cm)
                    mock_session.return_value = mock_client

                    with pytest.raises(OAuthError):
                        await oauth_service.exchange_code(
                            provider="google",
                            code="invalid_code",
                        )


class TestOAuthUserInfo:
    """Tests for OAuthUserInfo parsing."""

    def test_google_user_info(self):
        """Test Google user info creation."""
        user_info = OAuthUserInfo(
            provider="google",
            provider_user_id="123456",
            email="test@example.com",
            name="Test User",
            profile_image="https://example.com/photo.jpg",
            email_verified=True,
        )

        assert user_info.provider == "google"
        assert user_info.provider_user_id == "123456"
        assert user_info.email == "test@example.com"
        assert user_info.name == "Test User"
        assert user_info.email_verified

    def test_twitter_user_info(self):
        """Test Twitter user info creation (no email)."""
        user_info = OAuthUserInfo(
            provider="twitter",
            provider_user_id="789",
            email=None,
            name="Twitter User",
            profile_image="https://pbs.twimg.com/photo.jpg",
        )

        assert user_info.provider == "twitter"
        assert user_info.email is None


class TestOAuthTokens:
    """Tests for OAuthTokens dataclass."""

    def test_tokens_creation(self):
        """Test OAuth tokens creation."""
        tokens = OAuthTokens(
            access_token="access",
            refresh_token="refresh",
            expires_in=3600,
            token_type="Bearer",
            scope="email profile",
        )

        assert tokens.access_token == "access"
        assert tokens.refresh_token == "refresh"
        assert tokens.expires_in == 3600
        assert tokens.token_type == "Bearer"
        assert tokens.scope == "email profile"

    def test_tokens_without_refresh(self):
        """Test tokens without refresh token."""
        tokens = OAuthTokens(
            access_token="access",
            refresh_token=None,
            expires_in=3600,
            token_type="Bearer",
            scope=None,
        )

        assert tokens.refresh_token is None
        assert tokens.scope is None
