import secrets
import hmac
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

CSRF_COOKIE_NAME = "suwappu_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        if not csrf_cookie:
            csrf_cookie = secrets.token_urlsafe(32)

        if request.method in CSRF_SAFE_METHODS:
            response = await call_next(request)
            response.set_cookie(
                CSRF_COOKIE_NAME, csrf_cookie,
                httponly=False, secure=True, samesite="lax", path="/",
            )
            return response

        # Skip CSRF for API-key and webhook routes
        if request.headers.get("X-Agent-Key") or request.headers.get("X-Admin-Key"):
            return await call_next(request)
        if request.url.path in ("/telegram/webhook", "/webhook"):
            return await call_next(request)

        # Verify CSRF for webapp/auth routes
        if request.url.path.startswith("/webapp") or request.url.path.startswith("/auth"):
            csrf_header = request.headers.get(CSRF_HEADER_NAME)
            if not csrf_cookie or not csrf_header:
                raise HTTPException(status_code=403, detail="Missing CSRF token")
            if not hmac.compare_digest(csrf_cookie, csrf_header):
                raise HTTPException(status_code=403, detail="Invalid CSRF token")

        response = await call_next(request)
        response.set_cookie(
            CSRF_COOKIE_NAME, csrf_cookie,
            httponly=False, secure=True, samesite="lax", path="/",
        )
        return response
