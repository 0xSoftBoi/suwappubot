---
description: "Write tests for a feature (Python pytest / TypeScript Vitest)"
---

# Writing Tests

## Python Tests (pytest + pytest-asyncio)

### Test File Location

Place tests in `tests/` following the naming convention `test_<feature>.py`.

### Basic Async Test

```python
import pytest
from unittest.mock import MagicMock, AsyncMock, patch

@pytest.mark.asyncio
async def test_feature_handler(mock_telegram_update, mock_telegram_context):
    """Test the feature command handler."""
    from bot.handlers.feature import feature_handler

    mock_user = MagicMock()
    mock_user.id = 1
    mock_user.telegram_id = 123456789

    with patch("bot.handlers.feature.get_session") as mock_gs:
        session = MagicMock()
        session.query.return_value.filter.return_value.first.return_value = mock_user
        mock_gs.return_value.__enter__ = MagicMock(return_value=session)
        mock_gs.return_value.__exit__ = MagicMock(return_value=None)

        await feature_handler(mock_telegram_update, mock_telegram_context)

    mock_telegram_update.message.reply_text.assert_called_once()
```

### Key Fixtures (from `tests/conftest.py`)

```python
mock_telegram_update    # Mock Telegram Update with user ID 123456789
mock_telegram_context   # Mock Telegram Context with empty user_data
mock_db_session         # Mock SQLAlchemy session
mock_user               # Mock User object (TOS accepted)
mock_wallet             # Mock Wallet object
sample_quote_data       # Sample swap quote dict
sample_swap_state       # Sample swap flow state dict
```

### Mocking `get_session()` Context Manager

```python
with patch("bot.handlers.feature.get_session") as mock_gs:
    session = MagicMock()
    # Set up query chain
    session.query.return_value.filter.return_value.first.return_value = mock_user
    mock_gs.return_value.__enter__ = MagicMock(return_value=session)
    mock_gs.return_value.__exit__ = MagicMock(return_value=None)
```

### Mocking External APIs

```python
# Mock Li.Fi API
with patch("bot.services.swap_engine.httpx.AsyncClient") as mock_client:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"estimate": {...}}
    mock_client.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)

# Mock wallet service
with patch("bot.handlers.swap.wallet_service") as mock_ws:
    mock_ws.get_balances_by_address = AsyncMock(return_value={"ethereum": {"ETH": 1.0}})
```

### Running Python Tests

```bash
pytest tests/                              # All tests
pytest tests/test_feature.py -v            # Single file
pytest tests/test_feature.py::test_name -v # Single test
pytest tests/ --cov=bot --cov=api          # With coverage
```

## TypeScript Tests (Vitest + @testing-library/react)

### Test File Location

Place tests next to the code or in `__tests__/` subdirectories:
- `webapp/src/hooks/__tests__/useFeature.test.ts`
- `webapp/src/pages/__tests__/Feature.test.tsx`

### Component Test

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Feature } from '../Feature'

// Mock hooks
vi.mock('../../hooks/useFeatureData', () => ({
  useFeatureData: () => ({
    data: { items: [{ id: 1, name: 'Test' }] },
    isLoading: false,
    error: null,
  }),
}))

describe('Feature', () => {
  it('renders data', () => {
    render(<Feature />)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.mocked(useFeatureData).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    render(<Feature />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
```

### Hook Test

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useFeatureData } from '../useFeatureData'

describe('useFeatureData', () => {
  it('fetches data', async () => {
    const { result } = renderHook(() => useFeatureData())
    await waitFor(() => expect(result.current.data).toBeDefined())
  })
})
```

### Running TypeScript Tests

```bash
cd webapp
bun run test                  # Unit tests
bun run test:integration      # Integration tests
bun run test:all              # All tests
bun run test:coverage         # With coverage
```

## Common Patterns

### Testing Error Conditions

```python
@pytest.mark.asyncio
async def test_feature_no_user(mock_telegram_update, mock_telegram_context):
    with patch("bot.handlers.feature.get_session") as mock_gs:
        session = MagicMock()
        session.query.return_value.filter.return_value.first.return_value = None
        mock_gs.return_value.__enter__ = MagicMock(return_value=session)
        mock_gs.return_value.__exit__ = MagicMock(return_value=None)

        await feature_handler(mock_telegram_update, mock_telegram_context)

    mock_telegram_update.message.reply_text.assert_called_with("Please /start first.")
```

### Integration Test (Multi-Step Flow)

See `tests/test_swap_flow_integration.py` for a full example of testing a conversation handler with multiple state transitions.

## Reference Files

- `tests/conftest.py` — all shared fixtures
- `tests/test_swap_flow_integration.py` — integration test example
- `webapp/src/hooks/__tests__/` — hook test examples
- `webapp/src/pages/__tests__/` — component test examples
