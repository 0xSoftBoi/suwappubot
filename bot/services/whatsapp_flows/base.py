"""Base class for WhatsApp conversation flows."""

import logging
from typing import Any, Dict, Optional

from bot.services.whatsapp_conversation import ConversationState, conversation_manager

logger = logging.getLogger(__name__)


class FlowResponse:
    """What a flow step returns to the unified service for rendering."""

    __slots__ = (
        "text",
        "buttons",
        "header",
        "footer",
        "list_button_text",
        "list_sections",
        "document",
        "image",
    )

    def __init__(
        self,
        text: str,
        buttons: list | None = None,
        header: str | None = None,
        footer: str | None = None,
        list_button_text: str | None = None,
        list_sections: list | None = None,
        document: dict | None = None,
        image: str | None = None,
    ):
        self.text = text
        self.buttons = buttons
        self.header = header
        self.footer = footer
        self.list_button_text = list_button_text
        self.list_sections = list_sections
        self.document = document
        self.image = image


class BaseWhatsAppFlow:
    """
    Abstract base for multi-step WhatsApp flows.

    Subclasses define ``flow_name`` and a mapping of step names to async handler
    methods.  The base class provides step dispatch plus universal ``cancel``
    handling.
    """

    flow_name: str = ""

    # Subclasses override: {"step_name": handler_method}
    # Each handler receives (user_id, text, state) and returns FlowResponse.
    steps: Dict[str, str] = {}

    # Commands that trigger this flow (besides the flow_name itself)
    trigger_commands: list[str] = []

    async def handle(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> Optional[FlowResponse]:
        """
        Dispatch to the correct step handler based on ``state.step``.

        Returns None if the step is unknown (caller should treat as fallback).
        """
        # Universal cancel
        if text.lower() in ("cancel", "/cancel", "exit", "quit"):
            await conversation_manager.clear_state(user_id)
            return FlowResponse("Cancelled. Type *help* to see commands.")

        handler_name = self.steps.get(state.step)
        if handler_name is None:
            logger.warning(f"Flow {self.flow_name}: unknown step '{state.step}'")
            await conversation_manager.clear_state(user_id)
            return None

        handler = getattr(self, handler_name, None)
        if handler is None:
            logger.error(f"Flow {self.flow_name}: missing method '{handler_name}'")
            await conversation_manager.clear_state(user_id)
            return None

        return await handler(user_id, user_db_id, text, state)

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        """
        Entry point when the user first triggers this flow.

        Subclasses MUST override this to set initial state and return the first
        prompt.
        """
        raise NotImplementedError

    # Helpers ---------------------------------------------------------------

    async def _set_state(self, user_id: str, step: str, data: dict = None):
        """Convenience wrapper around conversation_manager.set_state."""
        await conversation_manager.set_state(user_id, self.flow_name, step, data)

    async def _update(self, user_id: str, step: str, data_update: dict = None):
        """Convenience wrapper around conversation_manager.update_step."""
        await conversation_manager.update_step(user_id, step, data_update)

    async def _clear(self, user_id: str):
        await conversation_manager.clear_state(user_id)
