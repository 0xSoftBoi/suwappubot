# webapp/ — Telegram Mini App rules

Scope: React + Vite app (`src/`), Telegram Mini App integration.

- **This component uses npm, not bun**: `npm ci && npm run dev`,
  `npm run build`, `npm run test -- --run`.
- **Integration tests hit the live dev API** (`devapi.suwappu.bot`) and are
  excluded from CI — run `npm run test:integration` deliberately, not by
  default. Unit tests must not depend on the network.
- API base URL comes from `VITE_API_URL` (see `.env.example`); it points at
  **api-ts**, not the Python bot. Don't hardcode hosts.
- Types shared with api-ts/mobile come from `packages/sdk/src/types.ts` (`@suwappu/sdk`) — change them
  there, not with local copies.
- Telegram Mini App auth uses initData; test flows need a Telegram context or
  the documented dev fallback — don't strip auth checks to make local dev work.
- New pages: copy an existing page in `src/pages/` as the template.
