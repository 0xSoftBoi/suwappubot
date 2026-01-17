# Suwappu Telegram Mini App

A Telegram Web App for viewing portfolio and swap history.

## Tech Stack

- **Vite** - Build tool
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **@twa-dev/sdk** - Telegram WebApp SDK
- **@tanstack/react-query** - Data fetching

## Development

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
VITE_API_URL=http://localhost:8000  # Backend API URL
```

## Project Structure

```
webapp/
├── src/
│   ├── components/     # React components
│   │   ├── Navigation.tsx
│   │   ├── Portfolio.tsx
│   │   ├── TokenBalance.tsx
│   │   ├── SwapHistory.tsx
│   │   └── SwapCard.tsx
│   ├── hooks/          # React hooks
│   │   ├── useTelegram.ts
│   │   ├── usePortfolio.ts
│   │   └── useSwapHistory.ts
│   ├── lib/            # Utilities
│   │   ├── telegram.ts  # Telegram SDK wrapper
│   │   └── api.ts       # API client
│   ├── types/          # TypeScript types
│   │   └── api.ts
│   ├── App.tsx         # Main app component
│   ├── main.tsx        # Entry point
│   └── index.css       # Global styles
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## Telegram Integration

The app uses the [Telegram WebApp API](https://core.telegram.org/bots/webapps) for:

- **User context** - Get user info (id, name, photo)
- **Theme sync** - Match Telegram's dark/light mode
- **Haptic feedback** - Native feel on mobile
- **Main button** - Bottom action button
- **Back button** - Navigation

### Authentication

The app sends `initData` to the backend via `X-Telegram-Init-Data` header. The backend validates this using HMAC with the bot token.

## Testing in Development

1. Use [@BotFather](https://t.me/botfather) to create a test bot
2. Set the bot's menu button to your dev URL (use ngrok for HTTPS)
3. Open the bot in Telegram and tap the menu button

Or use the Telegram WebApp test mode in browser dev tools.

## Deployment

The app is deployed to Vercel automatically via GitHub Actions when pushing to `main`.

Production URL: `https://suwappu.vercel.app`
