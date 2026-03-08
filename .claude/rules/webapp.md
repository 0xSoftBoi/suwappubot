---
paths:
  - "webapp/**/*.ts"
  - "webapp/**/*.tsx"
---

# Webapp Rules (React + Vite + Telegram Mini App)

- Tests: `cd webapp && npm run test`
- All pages wrap in `<AppLayout header={header} activeNav="name">`
- Three states required: loading (`role="status"`), error (`role="alert"`), success
- Bottom padding `pb-20` needed (bottom nav overlaps)
- Data fetching: `@tanstack/react-query` with custom hooks in `webapp/src/hooks/`
- Shared types: Import from `@suwappu/shared` (not local types)
- Haptic feedback: `useHaptic()` for button presses
- Telegram SDK: `useTelegram()` for back button, main button, theme
