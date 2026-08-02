"""Input sanitization and validation utilities."""

import re
import html
import logging
from typing import Optional, Tuple
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)


# Constants
MAX_MESSAGE_LENGTH = 4096
MAX_AMOUNT_LENGTH = 50
MAX_ADDRESS_LENGTH = 100
MAX_PRIVATE_KEY_LENGTH = 200
MAX_TOKEN_SYMBOL_LENGTH = 20


class SanitizationError(Exception):
    """Raised when input fails sanitization."""

    pass


class InputSanitizer:
    """Sanitize and validate user inputs."""

    @staticmethod
    def sanitize_text(
        text: str,
        max_length: int = MAX_MESSAGE_LENGTH,
        strip: bool = True,
        escape_html: bool = True,
    ) -> str:
        """
        Sanitize general text input.

        Args:
            text: Input text
            max_length: Maximum allowed length
            strip: Strip whitespace
            escape_html: Escape HTML characters

        Returns:
            Sanitized text

        Raises:
            SanitizationError: If input is invalid
        """
        if not text:
            return ""

        if not isinstance(text, str):
            text = str(text)

        if strip:
            text = text.strip()

        if len(text) > max_length:
            raise SanitizationError(f"Input too long (max {max_length} characters)")

        if escape_html:
            text = html.escape(text)

        return text

    @staticmethod
    def sanitize_amount(amount_str: str) -> Tuple[Decimal, str]:
        """
        Sanitize and parse amount input.

        Args:
            amount_str: Amount as string (e.g., "100", "50.5", "1,000.00")

        Returns:
            Tuple of (Decimal amount, cleaned string)

        Raises:
            SanitizationError: If amount is invalid
        """
        if not amount_str:
            raise SanitizationError("Amount is required")

        if len(amount_str) > MAX_AMOUNT_LENGTH:
            raise SanitizationError("Amount too long")

        # Remove all non-numeric except decimal point
        clean = re.sub(r"[^\d.]", "", amount_str.strip())

        # Check for multiple decimal points
        if clean.count(".") > 1:
            raise SanitizationError("Invalid amount format (multiple decimal points)")

        # Check for empty result
        if not clean or clean == ".":
            raise SanitizationError("Invalid amount")

        # Parse as Decimal
        try:
            amount = Decimal(clean)
        except InvalidOperation:
            raise SanitizationError("Invalid amount format")

        # Validate
        if amount <= 0:
            raise SanitizationError("Amount must be greater than zero")

        if amount > Decimal("1000000000000"):  # 1 trillion max
            raise SanitizationError("Amount too large")

        # Check precision (max 18 decimals)
        if "." in clean:
            decimals = len(clean.split(".")[1])
            if decimals > 18:
                raise SanitizationError("Too many decimal places (max 18)")

        return amount, clean

    @staticmethod
    def sanitize_address(
        address: str,
        address_type: str = "evm",
    ) -> str:
        """
        Sanitize blockchain address.

        Args:
            address: Wallet address
            address_type: "evm" or "solana"

        Returns:
            Sanitized address

        Raises:
            SanitizationError: If address is invalid
        """
        if not address:
            raise SanitizationError("Address is required")

        address = address.strip()

        if len(address) > MAX_ADDRESS_LENGTH:
            raise SanitizationError("Address too long")

        if address_type == "evm":
            # EVM address validation
            if not re.match(r"^0x[a-fA-F0-9]{40}$", address):
                raise SanitizationError("Invalid EVM address format")

            # Normalize to checksum address
            return address  # Could add checksum validation

        elif address_type == "solana":
            # Solana address validation (base58)
            if not re.match(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$", address):
                raise SanitizationError("Invalid Solana address format")

            return address

        raise SanitizationError(f"Unknown address type: {address_type}")

    @staticmethod
    def sanitize_private_key(
        key: str,
        key_type: str = "evm",
    ) -> str:
        """
        Sanitize private key input.

        Args:
            key: Private key
            key_type: "evm" or "solana"

        Returns:
            Sanitized private key

        Raises:
            SanitizationError: If key is invalid
        """
        if not key:
            raise SanitizationError("Private key is required")

        key = key.strip()

        if len(key) > MAX_PRIVATE_KEY_LENGTH:
            raise SanitizationError("Private key too long")

        if key_type == "evm":
            # Remove 0x prefix if present
            if key.startswith("0x"):
                key = key[2:]

            # Must be 64 hex characters
            if not re.match(r"^[a-fA-F0-9]{64}$", key):
                raise SanitizationError("Invalid EVM private key format")

            return key

        elif key_type == "solana":
            # Solana private keys are base58 encoded
            if not re.match(r"^[1-9A-HJ-NP-Za-km-z]{64,88}$", key):
                raise SanitizationError("Invalid Solana private key format")

            return key

        raise SanitizationError(f"Unknown key type: {key_type}")

    @staticmethod
    def sanitize_token_symbol(symbol: str) -> str:
        """
        Sanitize token symbol.

        Args:
            symbol: Token symbol (e.g., "ETH", "USDC")

        Returns:
            Sanitized uppercase symbol

        Raises:
            SanitizationError: If symbol is invalid
        """
        if not symbol:
            raise SanitizationError("Token symbol is required")

        symbol = symbol.strip().upper()

        if len(symbol) > MAX_TOKEN_SYMBOL_LENGTH:
            raise SanitizationError("Token symbol too long")

        # Only alphanumeric
        if not re.match(r"^[A-Z0-9]+$", symbol):
            raise SanitizationError("Invalid token symbol (alphanumeric only)")

        return symbol

    @staticmethod
    def sanitize_chain_name(chain: str) -> str:
        """
        Sanitize chain name.

        Args:
            chain: Chain name (e.g., "ethereum", "polygon")

        Returns:
            Sanitized lowercase chain name

        Raises:
            SanitizationError: If chain is invalid
        """
        if not chain:
            raise SanitizationError("Chain name is required")

        chain = chain.strip().lower()

        if len(chain) > 50:
            raise SanitizationError("Chain name too long")

        # Only lowercase alphanumeric and underscores
        if not re.match(r"^[a-z0-9_]+$", chain):
            raise SanitizationError("Invalid chain name")

        return chain

    @staticmethod
    def sanitize_slippage(slippage_str: str) -> int:
        """
        Sanitize slippage input.

        Args:
            slippage_str: Slippage as string (e.g., "0.5", "1%")

        Returns:
            Slippage in basis points (50 = 0.5%)

        Raises:
            SanitizationError: If slippage is invalid
        """
        if not slippage_str:
            raise SanitizationError("Slippage is required")

        # Remove % symbol and whitespace
        clean = slippage_str.strip().replace("%", "").strip()

        try:
            slippage_pct = Decimal(clean)
        except InvalidOperation:
            raise SanitizationError("Invalid slippage format")

        # Convert to basis points
        slippage_bps = int(slippage_pct * 100)

        # Validate range
        if slippage_bps < 1:
            raise SanitizationError("Slippage must be at least 0.01%")

        if slippage_bps > 5000:  # 50%
            raise SanitizationError("Slippage cannot exceed 50%")

        return slippage_bps

    @staticmethod
    def sanitize_telegram_username(username: str) -> str:
        """
        Sanitize Telegram username.

        Args:
            username: Telegram username

        Returns:
            Sanitized username (without @)

        Raises:
            SanitizationError: If username is invalid
        """
        if not username:
            return ""

        username = username.strip()

        # Remove @ prefix
        if username.startswith("@"):
            username = username[1:]

        if not username:
            return ""

        # Telegram usernames: 5-32 chars, alphanumeric + underscore
        if len(username) < 5 or len(username) > 32:
            raise SanitizationError("Invalid Telegram username length")

        if not re.match(r"^[a-zA-Z][a-zA-Z0-9_]{4,31}$", username):
            raise SanitizationError("Invalid Telegram username format")

        return username


# Global instance
sanitizer = InputSanitizer()
