"""Tests for the webhook dispatcher service."""

import pytest
import json
import hashlib
import hmac
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timedelta

from bot.services.webhook_dispatcher import WebhookDispatcher, MAX_ATTEMPTS, RETRY_DELAYS
from bot.models.webhook_event import WebhookEvent


def _make_db_session_mock(events_by_id=None):
    """Build a mock get_session context manager.

    ``events_by_id`` is an optional dict[int, WebhookEvent] that the
    mock session will return when queried by id.
    """
    events_by_id = events_by_id or {}
    _next_id = [max(events_by_id.keys(), default=0) + 1]

    mock_session = MagicMock()

    def handle_add(obj):
        if isinstance(obj, WebhookEvent) and obj.id is None:
            obj.id = _next_id[0]
            events_by_id[obj.id] = obj
            _next_id[0] += 1

    def handle_flush():
        pass

    def handle_query(model):
        mock_query = MagicMock()

        def handle_filter(*args, **kwargs):
            mock_filter = MagicMock()
            # Simplistic: return the first event from the store
            # For tests that need specific events we pass a single-entry dict
            mock_filter.first.return_value = next(iter(events_by_id.values()), None)
            mock_filter.limit.return_value = mock_filter
            mock_filter.all.return_value = list(events_by_id.values())
            return mock_filter

        mock_query.filter.side_effect = handle_filter
        return mock_query

    mock_session.add.side_effect = handle_add
    mock_session.flush.side_effect = handle_flush
    mock_session.query.side_effect = handle_query

    mock_context = MagicMock()
    mock_context.__enter__ = MagicMock(return_value=mock_session)
    mock_context.__exit__ = MagicMock(return_value=None)
    mock_get_session = MagicMock(return_value=mock_context)
    return mock_get_session, mock_session, events_by_id


@pytest.mark.asyncio
class TestWebhookDispatcherDelivery:
    """Tests for immediate webhook delivery."""

    async def test_dispatch_successful_delivery(self):
        """Test that a successful HTTP POST marks the event as delivered."""
        mock_get_session, _, events = _make_db_session_mock()

        # Mock aiohttp session with a 200 response
        mock_resp = AsyncMock()
        mock_resp.status = 200

        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            result = await dispatcher.dispatch(
                agent_id=1,
                event_type="swap.completed",
                payload='{"event":"swap.completed"}',
                callback_url="https://agent.example.com/webhook",
            )

        # The event should exist in our store
        assert len(events) == 1
        event = list(events.values())[0]
        assert event.status == "delivered"
        assert event.attempts == 1
        assert event.delivered_at is not None

        # Verify HTTP POST was called with the correct URL
        mock_http.post.assert_called_once()
        call_args = mock_http.post.call_args
        assert call_args[0][0] == "https://agent.example.com/webhook"

    async def test_dispatch_failed_delivery_schedules_retry(self):
        """Test that a failed HTTP POST schedules a retry."""
        mock_get_session, _, events = _make_db_session_mock()

        # Mock aiohttp session with a 500 response
        mock_resp = AsyncMock()
        mock_resp.status = 500

        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher.dispatch(
                agent_id=1,
                event_type="swap.failed",
                payload='{"event":"swap.failed"}',
                callback_url="https://agent.example.com/webhook",
            )

        event = list(events.values())[0]
        assert event.status == "pending"
        assert event.attempts == 1
        assert event.last_error == "HTTP 500"
        assert event.next_retry_at is not None

    async def test_dispatch_network_error_schedules_retry(self):
        """Test that a network error schedules a retry."""
        mock_get_session, _, events = _make_db_session_mock()

        # Mock aiohttp session that raises on POST
        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(side_effect=ConnectionError("Connection refused"))
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher.dispatch(
                agent_id=1,
                event_type="swap.submitted",
                payload='{"event":"swap.submitted"}',
                callback_url="https://agent.example.com/webhook",
            )

        event = list(events.values())[0]
        assert event.status == "pending"
        assert event.attempts == 1
        assert "Connection refused" in event.last_error

    async def test_dispatch_max_attempts_marks_failed(self):
        """Test that exceeding max attempts marks event as permanently failed."""
        # Pre-populate an event that has already been attempted MAX_ATTEMPTS-1 times
        existing_event = WebhookEvent(
            agent_id=1,
            event_type="swap.completed",
            payload='{}',
            callback_url="https://agent.example.com/webhook",
            status="pending",
            attempts=MAX_ATTEMPTS - 1,
            created_at=datetime.utcnow(),
        )
        existing_event.id = 42

        mock_get_session, _, events = _make_db_session_mock({42: existing_event})

        # Mock failed HTTP response
        mock_resp = AsyncMock()
        mock_resp.status = 503

        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher._attempt_delivery(42)

        assert existing_event.status == "failed"
        assert existing_event.attempts == MAX_ATTEMPTS

    async def test_dispatch_already_delivered_is_noop(self):
        """Test that attempting delivery on an already-delivered event does nothing."""
        existing_event = WebhookEvent(
            agent_id=1,
            event_type="swap.completed",
            payload='{}',
            callback_url="https://agent.example.com/webhook",
            status="delivered",
            attempts=1,
            delivered_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
        )
        existing_event.id = 10

        mock_get_session, _, _ = _make_db_session_mock({10: existing_event})

        mock_http = AsyncMock()
        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher._attempt_delivery(10)

        # HTTP should never be called
        mock_http.post.assert_not_called()


@pytest.mark.asyncio
class TestWebhookDispatcherHeaders:
    """Tests for webhook request headers and HMAC signature."""

    async def test_headers_include_event_metadata(self):
        """Test that delivery headers contain event type, delivery id, and timestamp."""
        mock_get_session, _, events = _make_db_session_mock()

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher.dispatch(
                agent_id=1,
                event_type="swap.completed",
                payload='{"test": true}',
                callback_url="https://example.com/hook",
            )

        call_kwargs = mock_http.post.call_args
        headers = call_kwargs[1]["headers"] if "headers" in call_kwargs[1] else call_kwargs.kwargs["headers"]
        assert headers["Content-Type"] == "application/json"
        assert headers["X-Suwappu-Event"] == "swap.completed"
        assert "X-Suwappu-Delivery" in headers
        assert "X-Suwappu-Timestamp" in headers

    async def test_hmac_signature_when_api_key_provided(self):
        """Test that HMAC signature is computed correctly when api_key is given."""
        mock_get_session, _, events = _make_db_session_mock()

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        payload = '{"event":"swap.completed","data":{}}'
        api_key = "suw_ag_test_key_12345"

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher.dispatch(
                agent_id=1,
                event_type="swap.completed",
                payload=payload,
                callback_url="https://example.com/hook",
                agent_api_key=api_key,
            )

        call_kwargs = mock_http.post.call_args
        headers = call_kwargs[1]["headers"] if "headers" in call_kwargs[1] else call_kwargs.kwargs["headers"]

        # Verify signature header is present
        assert "X-Suwappu-Signature" in headers
        sig_header = headers["X-Suwappu-Signature"]
        assert sig_header.startswith("sha256=")

        # Verify the signature is correct
        signing_key = hashlib.sha256(api_key.encode()).digest()
        expected_sig = hmac.new(signing_key, payload.encode(), hashlib.sha256).hexdigest()
        assert sig_header == f"sha256={expected_sig}"

    async def test_no_signature_when_no_api_key(self):
        """Test that no signature header is set when api_key is not provided."""
        mock_get_session, _, events = _make_db_session_mock()

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher.dispatch(
                agent_id=1,
                event_type="swap.submitted",
                payload='{}',
                callback_url="https://example.com/hook",
            )

        call_kwargs = mock_http.post.call_args
        headers = call_kwargs[1]["headers"] if "headers" in call_kwargs[1] else call_kwargs.kwargs["headers"]
        assert "X-Suwappu-Signature" not in headers


@pytest.mark.asyncio
class TestWebhookDispatcherRetryLoop:
    """Tests for the background retry sweep."""

    async def test_retry_pending_picks_up_eligible_events(self):
        """Test that _retry_pending finds events with next_retry_at <= now."""
        event = WebhookEvent(
            agent_id=1,
            event_type="swap.completed",
            payload='{}',
            callback_url="https://example.com/hook",
            status="pending",
            attempts=1,
            next_retry_at=datetime.utcnow() - timedelta(seconds=5),
            created_at=datetime.utcnow() - timedelta(minutes=1),
        )
        event.id = 99

        mock_get_session, _, events = _make_db_session_mock({99: event})

        # Mock successful delivery on retry
        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_post_cm = AsyncMock()
        mock_post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_post_cm.__aexit__ = AsyncMock(return_value=None)

        mock_http = AsyncMock()
        mock_http.post = MagicMock(return_value=mock_post_cm)

        dispatcher = WebhookDispatcher()
        dispatcher._http_session = mock_http

        with patch('bot.services.webhook_dispatcher.get_session', mock_get_session):
            await dispatcher._retry_pending()

        assert event.status == "delivered"
        assert event.attempts == 2

    async def test_retry_delays_are_exponential(self):
        """Verify that retry delays follow the configured exponential backoff."""
        assert RETRY_DELAYS == [1, 5, 30], (
            "Expected exponential backoff delays of [1, 5, 30] seconds"
        )
        assert MAX_ATTEMPTS == 3

    async def test_start_stop_lifecycle(self):
        """Test that start/stop manage the background task correctly."""
        dispatcher = WebhookDispatcher()

        with patch.object(dispatcher, '_retry_loop', new_callable=AsyncMock):
            await dispatcher.start()
            assert dispatcher._running is True
            assert dispatcher._http_session is not None
            assert dispatcher._task is not None

            await dispatcher.stop()
            assert dispatcher._running is False
            assert dispatcher._http_session is None


@pytest.mark.asyncio
class TestWebhookEventModel:
    """Tests for the WebhookEvent model."""

    def test_webhook_event_repr(self):
        """Test the string representation."""
        event = WebhookEvent(
            id=1,
            agent_id=5,
            event_type="swap.completed",
            payload="{}",
            callback_url="https://example.com",
            status="pending",
        )
        r = repr(event)
        assert "WebhookEvent" in r
        assert "swap.completed" in r
        assert "pending" in r

    def test_webhook_event_defaults(self):
        """Test default values on WebhookEvent columns.

        SQLAlchemy Column defaults only apply at flush/insert time, not
        at Python construction. So status/attempts will be None in-memory
        unless explicitly set. The DB will apply the defaults.
        """
        event = WebhookEvent(
            agent_id=1,
            event_type="swap.submitted",
            payload="{}",
            callback_url="https://example.com",
        )
        # These are None at construction -- the DB default fills them in on INSERT
        assert event.next_retry_at is None
        assert event.last_error is None
        assert event.response_status is None
        assert event.delivered_at is None
        # Verify the Column objects have the expected server defaults
        from bot.models.webhook_event import WebhookEvent as WE
        assert WE.__table__.c.status.default.arg == "pending"
        assert WE.__table__.c.attempts.default.arg == 0
