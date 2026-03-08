---
description: "Add a new webapp page or feature (React + Vite + Telegram Mini App)"
context: fork
---

# New Webapp Page

## Step-by-Step

### 1. Create Page Component

Create `webapp/src/pages/<Name>.tsx`:

```tsx
import { AppLayout, AppHeader } from '../components/layout'
import { useFeatureData } from '../hooks/useFeatureData'

export function Feature() {
  const { data, isLoading, error } = useFeatureData()

  const header = <AppHeader title="Feature" />

  if (isLoading) {
    return (
      <AppLayout header={header} activeNav="feature">
        <div className="p-3 pb-20" role="status" aria-live="polite">
          <p>Loading...</p>
        </div>
      </AppLayout>
    )
  }

  if (error) {
    return (
      <AppLayout header={header} activeNav="feature">
        <div className="p-3 pb-20" role="alert" aria-live="assertive">
          <p>Something went wrong. Please try again.</p>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={header} activeNav="feature">
      <div className="p-3 pb-20">
        {/* Page content */}
      </div>
    </AppLayout>
  )
}
```

### 2. Create Data-Fetching Hook

Create `webapp/src/hooks/useFeatureData.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FeatureData } from '@suwappu/shared'

export function useFeatureData() {
  return useQuery<FeatureData>({
    queryKey: ['feature'],
    queryFn: () => api.get('/webapp/feature/data'),
  })
}
```

### 3. Handle Loading / Error / Success States

Every page must handle three states:
- **Loading**: Show skeleton or spinner with `role="status"` and `aria-live="polite"`
- **Error**: Show error message with `role="alert"` and `aria-live="assertive"`
- **Success**: Render the data

### 4. Use Shared Types

Import types from the shared package:

```typescript
import type { SwapToken, UserPortfolio } from '@suwappu/shared'
```

Types in `packages/shared/` are shared across api-ts, webapp, and mobile. If you need a new type, add it there.

### 5. Add Route Entry

Add the route to `webapp/src/App.tsx` (or wherever routes are configured):

```tsx
import { Feature } from './pages/Feature'

// In the router config:
<Route path="/feature" element={<Feature />} />
```

### 6. Haptic Feedback

Use `useHaptic()` for user actions (button presses, confirmations):

```typescript
import { useHaptic } from '../hooks/useHaptic'

function MyComponent() {
  const haptic = useHaptic()

  const handleClick = () => {
    haptic.impact('light')  // or 'medium', 'heavy'
    // ... action
  }
}
```

### 7. Write Tests

Create `webapp/src/pages/__tests__/Feature.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Feature } from '../Feature'

// Mock the hook
vi.mock('../../hooks/useFeatureData', () => ({
  useFeatureData: () => ({
    data: { /* mock data */ },
    isLoading: false,
    error: null,
  }),
}))

describe('Feature', () => {
  it('renders feature data', () => {
    render(<Feature />)
    expect(screen.getByText('Feature')).toBeInTheDocument()
  })
})
```

## Gotchas

- **Telegram Mini App SDK**: Use `useTelegram()` hook for Telegram-specific features (back button, main button, theme)
- **AppLayout + AppHeader**: Always wrap pages in these for consistent navigation and styling
- **Loading states**: Users on mobile see every flash — always show proper loading skeletons
- **`role` and `aria-live`**: Required for accessibility. Use `polite` for loading, `assertive` for errors
- **`pb-20`**: Bottom padding is needed because the bottom nav overlaps content
- **Shared types**: Don't duplicate types — import from `@suwappu/shared`. Changes there affect api-ts, webapp, and mobile

## Reference Files

- `webapp/src/pages/Swap.tsx` — complex page with multiple states
- `webapp/src/hooks/useSwapForm.ts` — complex data-fetching hook
- `webapp/src/hooks/useTelegram.ts` — Telegram Mini App SDK integration
- `webapp/src/hooks/useHaptic.ts` — haptic feedback hook
- `webapp/src/components/layout/` — `AppLayout`, `AppHeader`
- `packages/shared/` — shared TypeScript types
