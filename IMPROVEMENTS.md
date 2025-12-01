# 🐛 Bug Fixes & Improvements

## 🔴 Critical Bugs

### 1. **Quote Expiration Not Validated**
**Issue**: Quotes expire quickly (often <30s) but no validation before execution
**Location**: `bot/handlers/swap.py:confirm_swap()`, `bot/services/swap_engine.py:execute_swap()`
**Fix**: Add timestamp to `SwapQuote` and validate freshness before execution
```python
# Add to SwapQuote dataclass
timestamp: datetime
expires_in: int  # seconds

# In execute_swap, check:
if (datetime.utcnow() - quote.timestamp).seconds > quote.expires_in:
    raise SwapError("Quote expired. Please get a new quote.")
```

### 2. **No Balance Check Before Swap**
**Issue**: Swaps can be initiated without checking if user has sufficient balance
**Location**: `bot/handlers/swap.py:confirm_swap()`
**Fix**: Add balance validation before swap execution
```python
# Check balance before executing
balance = await wallet_service.get_token_balance(
    wallet_id, quote.from_chain, quote.from_token
)
if balance < Decimal(quote.from_amount_human):
    raise SwapError("Insufficient balance")
```

### 3. **No Gas Estimation Before Swap**
**Issue**: Swaps can fail due to insufficient gas, wasting user's time
**Location**: `bot/services/swap_engine.py:execute_swap()`
**Fix**: Estimate gas and check native token balance before execution
```python
# Estimate gas before swap
gas_estimate = await estimate_gas(quote, wallet_address)
native_balance = await get_native_balance(wallet_address, quote.from_chain)
if native_balance < gas_estimate * 1.2:  # 20% buffer
    raise SwapError("Insufficient gas. Need more ETH/BNB/MATIC")
```

### 4. **Fee Recorded Even If Swap Fails**
**Issue**: Fee is recorded before swap completes, so fees are charged for failed swaps
**Location**: `bot/handlers/swap.py:confirm_swap()`
**Fix**: Move fee recording to after successful swap completion
```python
# Record fee AFTER swap succeeds
if swap_tx.status == SwapStatus.SUBMITTED.value:
    fee_service.record_fee(...)
```

### 5. **Race Condition: Concurrent Swaps**
**Issue**: Multiple swaps can execute simultaneously from same wallet, causing conflicts
**Location**: `bot/services/swap_engine.py:execute_swap()`
**Fix**: Add per-wallet lock to prevent concurrent swaps
```python
from asyncio import Lock
_wallet_locks: Dict[int, Lock] = {}

async def execute_swap(...):
    if wallet_id not in _wallet_locks:
        _wallet_locks[wallet_id] = Lock()
    
    async with _wallet_locks[wallet_id]:
        # Execute swap
```

## 🟡 Important Improvements

### 6. **Transaction Status Polling**
**Issue**: No automatic status updates for pending swaps
**Location**: New service needed
**Fix**: Create background task to poll transaction status
```python
# bot/services/tx_poller.py
async def poll_transaction_status():
    """Poll pending transactions and update status."""
    pending = get_pending_swaps()
    for tx in pending:
        status = await check_tx_status(tx.tx_hash, tx.from_chain)
        if status != tx.status:
            update_swap_status(tx.id, status)
            notify_user(tx.user_id, status)
```

### 7. **Rate Limiting on API Calls**
**Issue**: No rate limiting, can hit API limits and get banned
**Location**: `bot/services/lifi_api.py`, `bot/services/jupiter_api.py`
**Fix**: Add rate limiter decorator
```python
from aiolimiter import AsyncLimiter

lifi_limiter = AsyncLimiter(max_rate=10, time_period=1)  # 10 req/sec

@lifi_limiter
async def get_quote(...):
    ...
```

### 8. **Input Sanitization**
**Issue**: Some user inputs not fully sanitized (amounts, addresses)
**Location**: `bot/utils/validators.py`
**Fix**: Add stricter validation
```python
def validate_amount(amount_str: str) -> Optional[float]:
    # Remove all non-numeric except decimal point
    clean = re.sub(r'[^\d.]', '', amount_str)
    # Check for multiple decimal points
    if clean.count('.') > 1:
        return None
    # Check max precision
    if '.' in clean and len(clean.split('.')[1]) > 18:
        return None
    ...
```

### 9. **Quote Freshness Tracking**
**Issue**: No way to know how old a quote is
**Location**: `bot/services/swap_engine.py:SwapQuote`
**Fix**: Add timestamp to quote
```python
@dataclass
class SwapQuote:
    ...
    timestamp: datetime = field(default_factory=datetime.utcnow)
    expires_in: int = 30  # seconds
```

### 10. **Slippage Protection Validation**
**Issue**: No validation that slippage tolerance is reasonable
**Location**: `bot/handlers/swap.py:confirm_swap()`
**Fix**: Warn/block extreme slippage
```python
if slippage > 10.0:  # 10%
    await query.answer("⚠️ High slippage! Are you sure?", show_alert=True)
```

### 11. **Database Connection Pool Exhaustion**
**Issue**: Many concurrent requests could exhaust connection pool
**Location**: `database/db.py`
**Fix**: Add connection pool monitoring and limits
```python
# Add pool size monitoring
def get_pool_stats():
    return {
        "size": engine.pool.size(),
        "checked_in": engine.pool.checkedin(),
        "overflow": engine.pool.overflow(),
    }
```

### 12. **Missing Transaction Rollback**
**Issue**: Some operations don't properly rollback on error
**Location**: Multiple handlers
**Fix**: Ensure all database operations use context manager
```python
# Always use get_session() context manager
with get_session() as session:
    try:
        # operations
    except Exception:
        # session.rollback() is automatic in context manager
        raise
```

## 🟢 Performance Improvements

### 13. **Parallel Balance Fetching**
**Issue**: Balance fetching is sequential
**Location**: `bot/services/wallet.py:get_all_balances()`
**Status**: ✅ Already implemented with `asyncio.gather`

### 14. **Cache Quote Results**
**Issue**: Same quotes requested multiple times
**Location**: `bot/services/swap_engine.py:get_quote()`
**Fix**: Add short-term cache (5-10 seconds)
```python
from bot.utils.cache import cache

@cache(ttl_seconds=5)
async def get_quote(...):
    # Cache key includes: from_chain, to_chain, from_token, to_token, amount
    ...
```

### 15. **Batch Database Queries**
**Issue**: Multiple individual queries instead of batch
**Location**: Various handlers
**Fix**: Use `session.query().filter().in_()` for batch operations
```python
# Instead of:
for user_id in user_ids:
    user = session.query(User).filter(User.id == user_id).first()

# Use:
users = session.query(User).filter(User.id.in_(user_ids)).all()
```

### 16. **Lazy Loading Prevention**
**Issue**: SQLAlchemy lazy loading can cause N+1 queries
**Location**: Models with relationships
**Fix**: Use `joinedload` or `selectinload`
```python
from sqlalchemy.orm import joinedload

wallets = session.query(Wallet).options(
    joinedload(Wallet.user)
).all()
```

## 🔒 Security Improvements

### 17. **Private Key Exposure Risk**
**Issue**: Private keys stored in memory during swap execution
**Location**: `bot/services/swap_engine.py:execute_swap()`
**Fix**: Clear from memory immediately after use
```python
try:
    # Use key
finally:
    # Clear from memory
    wallet_data["encrypted_private_key"] = None
    del wallet_data
```

### 18. **SQL Injection Prevention**
**Issue**: Raw SQL queries (if any)
**Location**: Check all database queries
**Status**: ✅ Using SQLAlchemy ORM (safe)

### 19. **Input Length Limits**
**Issue**: No limits on input length (DoS risk)
**Location**: All handlers
**Fix**: Add max length validation
```python
MAX_MESSAGE_LENGTH = 4096
MAX_AMOUNT_LENGTH = 50

if len(user_input) > MAX_MESSAGE_LENGTH:
    raise ValueError("Input too long")
```

### 20. **Rate Limiting Per User**
**Issue**: No per-user rate limiting
**Location**: Handlers
**Fix**: Add user-level rate limiter
```python
from collections import defaultdict
from datetime import datetime, timedelta

_user_requests: Dict[int, List[datetime]] = defaultdict(list)

def check_user_rate_limit(user_id: int, max_per_minute: int = 10):
    now = datetime.utcnow()
    user_requests[user_id] = [
        req for req in _user_requests[user_id]
        if now - req < timedelta(minutes=1)
    ]
    if len(_user_requests[user_id]) >= max_per_minute:
        raise RateLimitError("Too many requests")
    _user_requests[user_id].append(now)
```

## 📊 Monitoring & Observability

### 21. **Failed Swap Alerting**
**Issue**: No alerts when swaps fail repeatedly
**Location**: New service
**Fix**: Create alert system
```python
# Track failure rate
if failure_rate > 0.1:  # 10%
    send_alert(f"High swap failure rate: {failure_rate}")
```

### 22. **Performance Metrics**
**Issue**: No tracking of swap execution times
**Location**: `bot/services/swap_engine.py`
**Fix**: Add timing decorator
```python
import time
from functools import wraps

def track_performance(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        start = time.time()
        try:
            result = await func(*args, **kwargs)
            duration = time.time() - start
            log_metric(f"{func.__name__}_duration", duration)
            return result
        except Exception as e:
            log_metric(f"{func.__name__}_error", 1)
            raise
    return wrapper
```

### 23. **Database Query Logging**
**Issue**: No visibility into slow queries
**Location**: `database/db.py`
**Fix**: Add query timing
```python
@event.listens_for(Engine, "before_cursor_execute")
def receive_before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    conn.info.setdefault('query_start_time', []).append(time.time())

@event.listens_for(Engine, "after_cursor_execute")
def receive_after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    total = time.time() - conn.info['query_start_time'].pop(-1)
    if total > 1.0:  # Log slow queries
        logger.warning(f"Slow query ({total:.2f}s): {statement[:100]}")
```

## 🎨 UX Improvements

### 24. **Progress Updates During Swap**
**Issue**: User sees "Executing swap..." with no updates
**Location**: `bot/handlers/swap.py:confirm_swap()`
**Fix**: Send periodic updates
```python
# Update message every 5 seconds
await query.edit_message_text("⏳ Executing swap... (Step 1/3)")
await asyncio.sleep(5)
await query.edit_message_text("⏳ Executing swap... (Step 2/3)")
```

### 25. **Better Error Messages**
**Issue**: Generic error messages don't help users
**Location**: `bot/utils/errors.py`
**Status**: ✅ Already implemented, but can be improved

### 26. **Swap History Pagination**
**Issue**: All swaps shown at once (can be slow)
**Location**: `bot/handlers/history.py`
**Fix**: Add pagination
```python
# Show 10 swaps per page
swaps = get_user_swaps(user_id, limit=10, offset=page * 10)
```

### 27. **Confirmation Timeout**
**Issue**: Users can confirm swaps hours after quote expires
**Location**: `bot/handlers/swap.py:confirm_swap()`
**Fix**: Add timeout check
```python
quote_age = (datetime.utcnow() - quote.timestamp).seconds
if quote_age > 60:  # 1 minute
    await query.edit_message_text("❌ Quote expired. Please start over.")
    return ConversationHandler.END
```

## 🧪 Testing & Quality

### 28. **Unit Tests Missing**
**Issue**: No automated tests
**Location**: New `tests/` directory
**Fix**: Add pytest tests
```python
# tests/test_swap_engine.py
async def test_quote_expiration():
    quote = SwapQuote(..., timestamp=datetime.utcnow() - timedelta(seconds=31))
    with pytest.raises(SwapError, match="expired"):
        await swap_engine.execute_swap(quote, ...)
```

### 29. **Integration Tests**
**Issue**: No end-to-end tests
**Location**: New `tests/integration/`
**Fix**: Add integration tests with testnet

### 30. **Type Hints Missing**
**Issue**: Some functions missing type hints
**Location**: Various files
**Fix**: Add comprehensive type hints
```python
from typing import Optional, List, Dict, Tuple

async def execute_swap(
    quote: SwapQuote,
    wallet_id: int,
    user_id: int,
) -> Optional[SwapTransaction]:
    ...
```

## 📝 Documentation

### 31. **API Documentation**
**Issue**: No API docs for services
**Location**: All service files
**Fix**: Add docstrings with examples
```python
"""
Execute a swap based on a quote.

Args:
    quote: SwapQuote from get_quote()
    wallet_id: User's wallet ID
    user_id: Database user ID

Returns:
    SwapTransaction record

Raises:
    SwapError: If swap fails

Example:
    >>> quote = await swap_engine.get_quote(...)
    >>> tx = await swap_engine.execute_swap(quote, wallet_id, user_id)
"""
```

## 🚀 Quick Wins (Easy to Implement)

1. ✅ Add quote expiration check (30 min)
2. ✅ Add balance check before swap (30 min)
3. ✅ Move fee recording after success (15 min)
4. ✅ Add input length limits (15 min)
5. ✅ Add swap confirmation timeout (15 min)
6. ✅ Add per-wallet lock (20 min)
7. ✅ Add gas estimation check (30 min)
8. ✅ Add rate limiting decorator (1 hour)
9. ✅ Add transaction status polling (2 hours)
10. ✅ Add performance tracking (1 hour)

**Total Estimated Time**: ~6-7 hours for quick wins

---

## 📱 iOS App Improvements

### 32. **Centralized App Configuration**
**Issue**: API URLs/feature flags are hardcoded in Swift.
**Fix**: Add `Config.plist` (or `.xcconfig`) and load via a `ConfigService` so dev/staging/prod can be toggled without code changes.
```swift
struct AppConfig {
    static let apiBaseURL: String = {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String else {
            fatalError("Missing API_BASE_URL")
        }
        return value
    }()
}
```

### 33. **Dependency Injection for Services**
**Issue**: ViewModels depend on singletons (`APIService.shared`), making tests harder.
**Fix**: Inject services via initializers/protocols and provide mocks in tests.
```swift
protocol APIServiceProtocol { func login(...) async throws -> AuthResponse }
final class AuthViewModel {
    private let apiService: APIServiceProtocol
    init(apiService: APIServiceProtocol = APIService.shared) { ... }
}
```

### 34. **State Restoration**
**Issue**: App forgets selected tab, wallet, or swap progress after relaunch.
**Fix**: Use `SceneStorage`/`AppStorage` to persist lightweight UI state and resume flows automatically.

### 35. **Accessibility & Dynamic Type**
**Issue**: Minimal UI lacks accessibility labels and Dynamic Type support.
**Fix**: Add `.accessibilityLabel`, `.accessibilityHint`, and use adaptive fonts so VoiceOver and large text work flawlessly.

### 36. **Offline / Retry Layer**
**Issue**: Network failures immediately surface as errors.
**Fix**: Wrap API calls with retry/backoff and show an “Offline – will retry” banner so swaps resume once the device reconnects.

### 37. **Background Task Handling**
**Issue**: Swap polling stops when the app is backgrounded.
**Fix**: Register `BGAppRefreshTask` or push notifications to continue polling and notify users on completion even if the app is closed.

### 38. **Security Hardening**
**Issue**: Wallet data/private keys need stronger protection.
**Fix**:
- Block screenshots on sensitive screens
- Store keys via Secure Enclave when possible
- Add jailbreak/root detection and warn users

### 39. **Analytics / Telemetry**
**Issue**: No visibility into mobile funnel (quote → swap success) or failure hotspots.
**Fix**: Add privacy-conscious analytics for key events (swap attempt, completion, errors) to guide product decisions.

### 40. **Snapshot & UI Tests**
**Issue**: Minimalist design could regress without detection.
**Fix**: Add snapshot tests (e.g., Point-Free SnapshotTesting) and extend XCTest UI coverage for swap flow, wallet import, etc.

### 41. **Modularization**
**Issue**: Single target increases build times and limits reuse.
**Fix**: Split into modules (`Core`, `Services`, `UIComponents`). Enables faster builds and code sharing with future Android/web clients.

