"""Custom exceptions for the bot."""


class SwapError(Exception):
    """Error during swap operations."""
    pass


class ValidationError(Exception):
    """Error during validation."""
    pass


class WalletError(Exception):
    """Error during wallet operations."""
    pass


class APIError(Exception):
    """Error from external API."""
    pass


class RateLimitError(Exception):
    """Rate limit exceeded."""
    pass

