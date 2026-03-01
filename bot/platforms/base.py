"""Platform abstraction layer for multi-platform support."""

from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class Platform(Enum):
    TELEGRAM = "telegram"
    DISCORD = "discord"
    WHATSAPP = "whatsapp"


@dataclass
class PlatformMessage:
    """Platform-agnostic incoming message."""
    user_id: str  # Platform-specific user ID
    platform: Platform
    text: str
    data: dict = field(default_factory=dict)  # Platform-specific data

    # User info
    username: Optional[str] = None
    display_name: Optional[str] = None

    # Context
    channel_id: Optional[str] = None
    is_dm: bool = False


@dataclass
class PlatformButton:
    """Button for interactive messages."""
    label: str
    callback_data: str
    style: str = "primary"  # primary, secondary, danger, success


@dataclass
class PlatformResponse:
    """Platform-agnostic response message."""
    text: str
    buttons: list[PlatformButton] = field(default_factory=list)
    embed_data: Optional[dict] = None  # For rich embeds (Discord)
    parse_mode: str = "Markdown"
    ephemeral: bool = False  # Only visible to the user (Discord)
