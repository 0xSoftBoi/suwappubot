"""Tests for WhatsApp Business Cloud API Service."""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
import aiohttp


class TestWhatsAppMessage:
    """Tests for WhatsAppMessage dataclass."""

    def test_message_with_text(self):
        """Test WhatsAppMessage with text content."""
        from bot.services.whatsapp_service import WhatsAppMessage

        msg = WhatsAppMessage(
            from_number="1234567890",
            message_id="wamid.abc123",
            timestamp="1700000000",
            text="Hello",
            message_type="text",
        )

        assert msg.from_number == "1234567890"
        assert msg.message_id == "wamid.abc123"
        assert msg.text == "Hello"
        assert msg.message_type == "text"
        assert msg.button_payload is None
        assert msg.list_reply_id is None

    def test_message_with_button_reply(self):
        """Test WhatsAppMessage with button payload."""
        from bot.services.whatsapp_service import WhatsAppMessage

        msg = WhatsAppMessage(
            from_number="1234567890",
            message_id="wamid.abc123",
            timestamp="1700000000",
            text="Confirm",
            button_payload="confirm_swap",
            message_type="interactive",
        )

        assert msg.button_payload == "confirm_swap"
        assert msg.text == "Confirm"

    def test_message_with_list_reply(self):
        """Test WhatsAppMessage with list selection."""
        from bot.services.whatsapp_service import WhatsAppMessage

        msg = WhatsAppMessage(
            from_number="1234567890",
            message_id="wamid.abc123",
            timestamp="1700000000",
            text="Ethereum",
            list_reply_id="chain_ethereum",
            list_reply_title="Ethereum",
            message_type="interactive",
        )

        assert msg.list_reply_id == "chain_ethereum"
        assert msg.list_reply_title == "Ethereum"


class TestWhatsAppService:
    """Tests for WhatsAppService API client."""

    @pytest.fixture
    def service(self):
        """Create a WhatsAppService instance with mock settings."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123456789"
            mock_settings.whatsapp_access_token = "test_access_token"
            mock_settings.whatsapp_verify_token = "test_verify_token"

            from bot.services.whatsapp_service import WhatsAppService

            return WhatsAppService()

    def test_is_configured_true(self, service):
        """Test is_configured returns True when credentials are set."""
        assert service.is_configured is True

    def test_is_configured_false_missing_phone_id(self):
        """Test is_configured returns False when phone_number_id is missing."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = None
            mock_settings.whatsapp_access_token = "token"
            mock_settings.whatsapp_verify_token = "verify"

            from bot.services.whatsapp_service import WhatsAppService

            service = WhatsAppService()
            assert service.is_configured is False

    def test_is_configured_false_missing_token(self):
        """Test is_configured returns False when access_token is missing."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123"
            mock_settings.whatsapp_access_token = None
            mock_settings.whatsapp_verify_token = "verify"

            from bot.services.whatsapp_service import WhatsAppService

            service = WhatsAppService()
            assert service.is_configured is False

    @pytest.mark.asyncio
    async def test_send_text_message(self, service):
        """Test sending a text message."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(
            return_value={"messages": [{"id": "wamid.sent123"}]}
        )

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.send_text_message("1234567890", "Hello World")

        assert result == {"messages": [{"id": "wamid.sent123"}]}
        mock_session.post.assert_called_once()

        # Verify payload structure
        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert payload["messaging_product"] == "whatsapp"
        assert payload["recipient_type"] == "individual"
        assert payload["to"] == "1234567890"
        assert payload["type"] == "text"
        assert payload["text"]["body"] == "Hello World"

    @pytest.mark.asyncio
    async def test_send_interactive_buttons(self, service):
        """Test sending interactive button message."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.btn"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        buttons = [
            {"id": "btn_1", "title": "Option 1"},
            {"id": "btn_2", "title": "Option 2"},
        ]

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.send_interactive_buttons(
                to="1234567890",
                body_text="Choose an option:",
                buttons=buttons,
                header="Test Header",
                footer="Test Footer",
            )

        assert result == {"messages": [{"id": "wamid.btn"}]}

        # Verify payload structure
        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert payload["type"] == "interactive"
        assert payload["interactive"]["type"] == "button"
        assert payload["interactive"]["body"]["text"] == "Choose an option:"
        assert payload["interactive"]["header"]["text"] == "Test Header"
        assert payload["interactive"]["footer"]["text"] == "Test Footer"
        assert len(payload["interactive"]["action"]["buttons"]) == 2

    @pytest.mark.asyncio
    async def test_send_interactive_buttons_max_3(self, service):
        """Test that button count is limited to 3."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.btn"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        buttons = [
            {"id": "btn_1", "title": "Option 1"},
            {"id": "btn_2", "title": "Option 2"},
            {"id": "btn_3", "title": "Option 3"},
            {"id": "btn_4", "title": "Option 4"},  # Should be truncated
            {"id": "btn_5", "title": "Option 5"},  # Should be truncated
        ]

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            await service.send_interactive_buttons(
                to="1234567890", body_text="Choose:", buttons=buttons
            )

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        # Only 3 buttons should be sent
        assert len(payload["interactive"]["action"]["buttons"]) == 3

    @pytest.mark.asyncio
    async def test_send_interactive_buttons_title_truncation(self, service):
        """Test that button titles are truncated to 20 chars."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.btn"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        buttons = [
            {"id": "btn_1", "title": "This is a very long button title that exceeds 20 characters"},
        ]

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            await service.send_interactive_buttons(
                to="1234567890", body_text="Choose:", buttons=buttons
            )

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        btn_title = payload["interactive"]["action"]["buttons"][0]["reply"]["title"]
        assert len(btn_title) <= 20

    @pytest.mark.asyncio
    async def test_send_interactive_list(self, service):
        """Test sending interactive list message."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.list"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        sections = [
            {
                "title": "EVM Chains",
                "rows": [
                    {"id": "chain_eth", "title": "Ethereum", "description": "ETH"},
                    {"id": "chain_polygon", "title": "Polygon", "description": "MATIC"},
                ],
            }
        ]

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.send_interactive_list(
                to="1234567890",
                body_text="Select chain:",
                button_text="Choose",
                sections=sections,
                header="Chains",
                footer="Select one",
            )

        assert result == {"messages": [{"id": "wamid.list"}]}

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert payload["type"] == "interactive"
        assert payload["interactive"]["type"] == "list"
        assert payload["interactive"]["action"]["button"] == "Choose"
        assert len(payload["interactive"]["action"]["sections"]) == 1

    @pytest.mark.asyncio
    async def test_send_interactive_list_sections_limit(self, service):
        """Test that sections are limited to 10."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.list"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        # Create 15 sections
        sections = [
            {"title": f"Section {i}", "rows": [{"id": f"row_{i}", "title": f"Row {i}"}]}
            for i in range(15)
        ]

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            await service.send_interactive_list(
                to="1234567890", body_text="Select:", button_text="Choose", sections=sections
            )

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert len(payload["interactive"]["action"]["sections"]) == 10

    @pytest.mark.asyncio
    async def test_send_image(self, service):
        """Test sending image message."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.img"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.send_image(
                to="1234567890",
                image_url="https://example.com/image.png",
                caption="Check this out!",
            )

        assert result == {"messages": [{"id": "wamid.img"}]}

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert payload["type"] == "image"
        assert payload["image"]["link"] == "https://example.com/image.png"
        assert payload["image"]["caption"] == "Check this out!"

    @pytest.mark.asyncio
    async def test_send_image_no_caption(self, service):
        """Test sending image without caption."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.img"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            await service.send_image(
                to="1234567890", image_url="https://example.com/image.png"
            )

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert "caption" not in payload["image"]

    @pytest.mark.asyncio
    async def test_send_document(self, service):
        """Test sending document message."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"messages": [{"id": "wamid.doc"}]})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.send_document(
                to="1234567890",
                document_url="https://example.com/doc.pdf",
                filename="tax_export.pdf",
                caption="Your tax export",
            )

        assert result == {"messages": [{"id": "wamid.doc"}]}

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert payload["type"] == "document"
        assert payload["document"]["link"] == "https://example.com/doc.pdf"
        assert payload["document"]["filename"] == "tax_export.pdf"
        assert payload["document"]["caption"] == "Your tax export"

    @pytest.mark.asyncio
    async def test_mark_as_read(self, service):
        """Test marking message as read."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"success": True})

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.mark_as_read("wamid.abc123")

        assert result == {"success": True}

        call_args = mock_session.post.call_args
        payload = call_args[1]["json"]
        assert payload["messaging_product"] == "whatsapp"
        assert payload["status"] == "read"
        assert payload["message_id"] == "wamid.abc123"


class TestParseWebhookMessage:
    """Tests for parsing incoming webhook payloads."""

    @pytest.fixture
    def service(self):
        """Create a WhatsAppService instance with mock settings."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123456789"
            mock_settings.whatsapp_access_token = "test_access_token"
            mock_settings.whatsapp_verify_token = "test_verify_token"

            from bot.services.whatsapp_service import WhatsAppService

            return WhatsAppService()

    def test_parse_webhook_text(self, service):
        """Test parsing text message webhook payload."""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": "1234567890",
                                        "id": "wamid.abc123",
                                        "timestamp": "1700000000",
                                        "type": "text",
                                        "text": {"body": "Hello bot"},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        result = service.parse_webhook_message(payload)

        assert result is not None
        assert result.from_number == "1234567890"
        assert result.message_id == "wamid.abc123"
        assert result.text == "Hello bot"
        assert result.message_type == "text"
        assert result.button_payload is None
        assert result.list_reply_id is None

    def test_parse_webhook_button_reply(self, service):
        """Test parsing button reply webhook payload."""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": "1234567890",
                                        "id": "wamid.btn123",
                                        "timestamp": "1700000000",
                                        "type": "interactive",
                                        "interactive": {
                                            "type": "button_reply",
                                            "button_reply": {
                                                "id": "confirm_swap",
                                                "title": "Confirm",
                                            },
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        result = service.parse_webhook_message(payload)

        assert result is not None
        assert result.from_number == "1234567890"
        assert result.button_payload == "confirm_swap"
        assert result.text == "Confirm"
        assert result.message_type == "interactive"

    def test_parse_webhook_list_reply(self, service):
        """Test parsing list reply webhook payload."""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": "1234567890",
                                        "id": "wamid.list123",
                                        "timestamp": "1700000000",
                                        "type": "interactive",
                                        "interactive": {
                                            "type": "list_reply",
                                            "list_reply": {
                                                "id": "chain_ethereum",
                                                "title": "Ethereum",
                                            },
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        result = service.parse_webhook_message(payload)

        assert result is not None
        assert result.list_reply_id == "chain_ethereum"
        assert result.list_reply_title == "Ethereum"
        assert result.text == "Ethereum"
        assert result.message_type == "interactive"

    def test_parse_invalid_payload_empty_messages(self, service):
        """Test parsing payload with no messages."""
        payload = {"entry": [{"changes": [{"value": {"messages": []}}]}]}

        result = service.parse_webhook_message(payload)

        assert result is None

    def test_parse_invalid_payload_missing_fields(self, service):
        """Test parsing malformed payload."""
        payload = {"entry": [{}]}

        result = service.parse_webhook_message(payload)

        assert result is None

    def test_parse_invalid_payload_completely_malformed(self, service):
        """Test parsing completely malformed payload."""
        payload = {"invalid": "data"}

        result = service.parse_webhook_message(payload)

        assert result is None


class TestVerifyWebhook:
    """Tests for webhook verification."""

    @pytest.fixture
    def service(self):
        """Create a WhatsAppService instance with mock settings."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123456789"
            mock_settings.whatsapp_access_token = "test_access_token"
            mock_settings.whatsapp_verify_token = "my_verify_token"

            from bot.services.whatsapp_service import WhatsAppService

            return WhatsAppService()

    def test_verify_webhook_success(self, service):
        """Test successful webhook verification."""
        result = service.verify_webhook(
            mode="subscribe",
            token="my_verify_token",
            challenge="challenge_123",
        )

        assert result == "challenge_123"

    def test_verify_webhook_wrong_mode(self, service):
        """Test verification fails with wrong mode."""
        result = service.verify_webhook(
            mode="unsubscribe",  # Wrong mode
            token="my_verify_token",
            challenge="challenge_123",
        )

        assert result is None

    def test_verify_webhook_wrong_token(self, service):
        """Test verification fails with wrong token."""
        result = service.verify_webhook(
            mode="subscribe",
            token="wrong_token",  # Wrong token
            challenge="challenge_123",
        )

        assert result is None


class TestWhatsAppServiceSingleton:
    """Tests for the whatsapp_service singleton."""

    def test_singleton_exists(self):
        """Test that whatsapp_service singleton is exported."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123"
            mock_settings.whatsapp_access_token = "token"
            mock_settings.whatsapp_verify_token = "verify"

            from bot.services.whatsapp_service import whatsapp_service

            assert whatsapp_service is not None


class TestWhatsAppServiceErrorHandling:
    """Tests for error handling in WhatsAppService."""

    @pytest.fixture
    def service(self):
        """Create a WhatsAppService instance with mock settings."""
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123456789"
            mock_settings.whatsapp_access_token = "test_access_token"
            mock_settings.whatsapp_verify_token = "test_verify_token"

            from bot.services.whatsapp_service import WhatsAppService

            return WhatsAppService()

    @pytest.mark.asyncio
    async def test_send_text_message_error_response(self, service):
        """Test handling of error response from API."""
        mock_response = AsyncMock()
        mock_response.status = 400
        mock_response.json = AsyncMock(
            return_value={"error": {"message": "Invalid phone number"}}
        )

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_response), __aexit__=AsyncMock()))

        with patch.object(service, "_get_session", AsyncMock(return_value=mock_session)):
            result = await service.send_text_message("invalid", "Hello")

        # Should still return the error response
        assert "error" in result

    @pytest.mark.asyncio
    async def test_close_session(self, service):
        """Test closing the session."""
        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.close = AsyncMock()
        service._session = mock_session

        await service.close()

        mock_session.close.assert_called_once()


class TestMessageSplitting:
    """Tests for message splitting logic."""

    @pytest.fixture
    def service(self):
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123456789"
            mock_settings.whatsapp_access_token = "test_access_token"
            mock_settings.whatsapp_verify_token = "test_verify_token"

            from bot.services.whatsapp_service import WhatsAppService

            return WhatsAppService()

    def test_short_message_no_split(self, service):
        """Short messages should not be split."""
        result = service._split_message("Hello world")
        assert result == ["Hello world"]

    def test_long_message_splits_on_newline(self, service):
        """Long messages should split on the last newline before the limit."""
        # Build a message slightly over 4000 chars with newlines
        lines = [f"Line {i}: " + "x" * 80 for i in range(60)]
        text = "\n".join(lines)
        assert len(text) > 4000

        chunks = service._split_message(text)
        assert len(chunks) >= 2
        for chunk in chunks:
            assert len(chunk) <= 4000

    def test_long_message_no_newlines_hard_split(self, service):
        """Messages without newlines should hard-split at max_len."""
        text = "x" * 10000
        chunks = service._split_message(text, max_len=4000)
        assert len(chunks) == 3  # 4000 + 4000 + 2000
        assert chunks[0] == "x" * 4000
        assert chunks[1] == "x" * 4000
        assert chunks[2] == "x" * 2000

    def test_exact_limit_no_split(self, service):
        """Message exactly at limit should not split."""
        text = "x" * 4000
        chunks = service._split_message(text)
        assert chunks == [text]

    @pytest.mark.asyncio
    async def test_send_text_splits_long_message(self, service):
        """send_text_message should call _send_single_text for each chunk."""
        long_text = "a" * 5000
        with patch.object(service, "_send_single_text", AsyncMock(return_value={"messages": [{"id": "wamid.1"}]})) as mock_send:
            await service.send_text_message("1234567890", long_text)

        assert mock_send.call_count == 2


class TestParseUnsupportedTypes:
    """Tests for parsing unsupported message types."""

    @pytest.fixture
    def service(self):
        with patch("bot.services.whatsapp_service.settings") as mock_settings:
            mock_settings.whatsapp_phone_number_id = "123456789"
            mock_settings.whatsapp_access_token = "test_access_token"
            mock_settings.whatsapp_verify_token = "test_verify_token"

            from bot.services.whatsapp_service import WhatsAppService

            return WhatsAppService()

    def test_parse_image_message(self, service):
        """Image messages should be parsed with message_type='image'."""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": "1234567890",
                                        "id": "wamid.img123",
                                        "timestamp": "1700000000",
                                        "type": "image",
                                        "image": {"id": "media_id", "mime_type": "image/jpeg"},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        result = service.parse_webhook_message(payload)

        assert result is not None
        assert result.message_type == "image"
        assert result.text is None

    def test_parse_audio_message(self, service):
        """Audio messages should be parsed with message_type='audio'."""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": "1234567890",
                                        "id": "wamid.aud123",
                                        "timestamp": "1700000000",
                                        "type": "audio",
                                        "audio": {"id": "media_id"},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        result = service.parse_webhook_message(payload)

        assert result is not None
        assert result.message_type == "audio"
        assert result.text is None

    def test_parse_status_update_no_message(self, service):
        """Status update payloads (no messages) should return None."""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "statuses": [
                                    {
                                        "id": "wamid.abc123",
                                        "status": "delivered",
                                        "timestamp": "1700000000",
                                        "recipient_id": "1234567890",
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        result = service.parse_webhook_message(payload)
        assert result is None


class TestWebhookSignatureVerification:
    """Tests for the _verify_whatsapp_signature helper."""

    @pytest.mark.asyncio
    async def test_signature_valid(self):
        """Valid signature should pass verification."""
        import hashlib
        import hmac as hmac_mod

        secret = "test_app_secret"
        body = b'{"entry": []}'
        expected_sig = hmac_mod.new(secret.encode(), body, hashlib.sha256).hexdigest()

        mock_request = MagicMock()
        mock_request.headers = {"X-Hub-Signature-256": f"sha256={expected_sig}"}

        with patch("api.main.settings") as mock_settings:
            mock_settings.whatsapp_app_secret = secret
            from api.main import _verify_whatsapp_signature
            result = await _verify_whatsapp_signature(mock_request, body)

        assert result is True

    @pytest.mark.asyncio
    async def test_signature_invalid(self):
        """Invalid signature should fail verification."""
        mock_request = MagicMock()
        mock_request.headers = {"X-Hub-Signature-256": "sha256=invalid_signature"}

        with patch("api.main.settings") as mock_settings:
            mock_settings.whatsapp_app_secret = "test_app_secret"
            from api.main import _verify_whatsapp_signature
            result = await _verify_whatsapp_signature(mock_request, b'{"entry": []}')

        assert result is False

    @pytest.mark.asyncio
    async def test_signature_skipped_when_no_secret(self):
        """Verification should be skipped when no app secret is configured."""
        mock_request = MagicMock()
        mock_request.headers = {}

        with patch("api.main.settings") as mock_settings:
            mock_settings.whatsapp_app_secret = None
            from api.main import _verify_whatsapp_signature
            result = await _verify_whatsapp_signature(mock_request, b'anything')

        assert result is True

    @pytest.mark.asyncio
    async def test_signature_missing_header(self):
        """Missing signature header should fail when secret is configured."""
        mock_request = MagicMock()
        mock_request.headers = {}

        with patch("api.main.settings") as mock_settings:
            mock_settings.whatsapp_app_secret = "test_app_secret"
            from api.main import _verify_whatsapp_signature
            result = await _verify_whatsapp_signature(mock_request, b'{"entry": []}')

        assert result is False
