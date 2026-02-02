"""Custom exceptions for the bot."""


class SwapError(Exception):
    """Error during swap operations."""

    def __init__(self, message, error_code=None):
        super().__init__(message)
        self.error_code = error_code


class ValidationError(Exception):
    """Error during validation."""

    def __init__(self, message, error_code=None):
        super().__init__(message)
        self.error_code = error_code


class WalletError(Exception):
    """Error during wallet operations."""

    def __init__(self, message, error_code=None):
        super().__init__(message)
        self.error_code = error_code


class APIError(Exception):
    """Error from external API."""

    def __init__(self, message, error_code=None):
        super().__init__(message)
        self.error_code = error_code


class RateLimitError(Exception):
    """Rate limit exceeded."""

    def __init__(self, message=None, error_code=None):
        super().__init__(message or "Rate limit exceeded")
        self.error_code = error_code or "RATE_LIMITED"
