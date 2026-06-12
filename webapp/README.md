# Suwappu Webapp 🌸

> [← Back to main README](../README.md)

Telegram Mini App for cross-chain swaps, portfolio tracking, and wallet management.

**Live:** https://app.suwappu.bot

## Quick Start

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Open http://localhost:5173
```

## Tech Stack

| Tool | Purpose |
|------|---------|
| **Vite** | Build tool & dev server |
| **React 18** | UI framework |
| **TypeScript** | Type safety |
| **Tailwind CSS** | Styling |
| **Framer Motion** | Animations |
| **TanStack Query** | Data fetching & caching |
| **@twa-dev/sdk** | Telegram WebApp SDK |
| **Storybook** | Component development |

## Project Structure

```
webapp/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── ui/              # Base UI primitives
│   │   ├── auth/            # Auth flow components
│   │   ├── cards/           # Card variants
│   │   ├── icons/           # SVG icons
│   │   ├── layout/          # Layout components
│   │   ├── swap/            # Swap-specific components
│   │   └── tiers/           # Tier/membership components
│   ├── pages/               # Route pages
│   │   ├── Home.tsx         # Landing/dashboard
│   │   ├── Swap.tsx         # Swap interface
│   │   ├── Wallet.tsx       # Wallet management
│   │   ├── Portfolio.tsx    # Holdings view
│   │   ├── Settings.tsx     # User settings
│   │   └── Welcome.tsx      # Onboarding flow
│   ├── hooks/               # React hooks
│   ├── lib/                 # Utilities & API client
│   ├── contexts/            # React contexts
│   ├── theme/               # Design tokens
│   ├── types/               # TypeScript types
│   └── stories/             # Storybook stories
├── .storybook/              # Storybook config
└── dist/                    # Production build
```

## Design System

We use a **Kawaii-inspired** design system with sakura theme.

### Colors

```tsx
// Primary - Sakura/Magenta palette
'sakura-light': '#FFD1DC'
'sakura-mid': '#FFB7C5'
'magenta': '#E91E8C'
'rose': '#F8A5C2'
'purple': '#6C3483'
'purple-deep': '#4A235A'

// Secondary - Sky/Ocean
'sky': '#E8F4FD'
'cyan': '#B3E5FC'
'navy': '#1A237E'
'ocean': '#0D1B4C'

// Semantic
'success': '#A8E6A3'
'warning': '#FFE4A0'
'error': '#F8A0A0'
```

### Using Design Tokens

```tsx
// Tailwind classes with suwappu prefix
<div className="bg-suwappu-sakura-light text-suwappu-text">
  <button className="bg-suwappu-gradient shadow-suwappu-button rounded-suwappu-pill">
    Swap
  </button>
</div>
```

### Telegram Theme Integration

The app syncs with Telegram's theme (dark/light mode):

```tsx
// Telegram CSS variables auto-applied
<div className="bg-tg-bg text-tg-text">
  <button className="bg-tg-button text-tg-button-text">
    Action
  </button>
</div>
```

## Development

### Environment Variables

```bash
# .env.development
VITE_API_URL=https://devapi.suwappu.bot

# .env.production
VITE_API_URL=https://api.suwappu.bot
```

### Running Storybook

```bash
bun run storybook
# Opens http://localhost:6006
```

### Testing in Telegram

1. Use [BotFather](https://t.me/botfather) to set your dev URL as the menu button
2. Use [ngrok](https://ngrok.com) for HTTPS: `ngrok http 5173`
3. Open the bot in Telegram → tap menu button

Or use browser dev tools with Telegram WebApp mock.

### Build & Preview

```bash
# Production build
bun run build

# Preview locally
bun run preview
```

## Key Components

### Pages

| Page | Route | Description |
|------|-------|-------------|
| `Welcome` | `/welcome` | Onboarding, wallet connection |
| `Home` | `/` | Dashboard with quick actions |
| `Swap` | `/swap` | Token swap interface |
| `Wallet` | `/wallet` | Wallet & address management |
| `Portfolio` | `/portfolio` | Holdings & history |
| `Settings` | `/settings` | Preferences, notifications |

### UI Components

- **QuickActions** - Grid of action buttons (Swap, Send, etc.)
- **ChainSelector** - Multi-chain dropdown
- **StatusBadge** - Transaction status indicators
- **NotificationBanner** - Alert/info banners
- **SettingsDrawer** - Slide-out settings panel

## API Integration

API client in `src/lib/api.ts` handles:
- Auth via Telegram `initData` header
- Portfolio data
- Swap quotes & execution
- Transaction history

```tsx
// Example: fetching portfolio
const { data } = useQuery({
  queryKey: ['portfolio'],
  queryFn: () => api.getPortfolio(),
})
```

## Deployment

Deployed via GitHub Actions to AWS ECS (Docker + nginx).

| Environment | URL | Branch |
|-------------|-----|--------|
| Production | https://app.suwappu.bot | `main` |
| Development | https://devfront.suwappu.bot | `dev` |

### Manual Deploy

Push to `main` or `dev` branch - CI handles the rest.

## Contributing

1. Create feature branch from `main`
2. Follow existing patterns & use design tokens
3. Add Storybook stories for new components
4. Test in Telegram before PR
5. PR with screenshots/recordings

### Code Style

- Functional components with hooks
- TypeScript strict mode
- Tailwind for styling (no inline styles)
- Framer Motion for animations

---

Questions? Ask in the team chat or check [TURNKEY_AUTH_SKILL.md](./TURNKEY_AUTH_SKILL.md) for auth details.
