# Turnkey Passkey Auth - Implementation Skill

## Overview
Turnkey passkey authentication for the Suwappu webapp. Users can create wallets with Face ID/Touch ID/Windows Hello and authenticate without passwords.

## Architecture

### Flow
```
1. User clicks "Create Wallet with Passkey"
2. Frontend: passkeyClient.createUserPasskey() → WebAuthn prompt
3. Frontend: POST /webapp/turnkey/register with attestation
4. Backend: TurnkeyService.createSubOrgWithPasskey() → creates sub-org + wallet on Turnkey
5. Backend: Creates user in DB, returns JWT + wallet address
6. Frontend: Stores JWT in localStorage, updates React Query cache
7. Frontend: Navigates to /home
```

### Key Components

**Frontend (`webapp/`)**
- `src/lib/turnkey-client.ts` - Turnkey SDK singleton (`passkeyClient`)
- `src/lib/turnkey-passkey.ts` - `registerPasskey()`, `authenticateWithPasskey()`
- `src/lib/auth.ts` - localStorage helpers for JWT/wallet storage
- `src/App.tsx` - `useCombinedAuth()` hook combines wagmi + localStorage + React Query
- `src/pages/Welcome.tsx` - Auth UI, handles registration/login
- `src/router.tsx` - TanStack Router with `beforeLoad` guards

**Backend (`api-ts/`)**
- `src/routes/webapp.ts` - `/webapp/turnkey/register`, `/webapp/turnkey/sync`
- `src/services/TurnkeyService.ts` - `createSubOrgWithPasskey()`, `isConfigured()`

## Environment Variables

### Frontend (webapp/.env.development)
```
VITE_API_URL=https://api.suwappu.bot
VITE_TURNKEY_ORG_ID=5cf56ed5-5d6b-4290-8edb-f52670162aab
VITE_TURNKEY_RP_ID=devfront.suwappu.bot
VITE_TURNKEY_PROXY_URL=https://api.turnkey.com
```

### Backend (via AWS Secrets Manager)
```
TURNKEY_ORGANIZATION_ID
TURNKEY_API_PUBLIC_KEY
TURNKEY_API_PRIVATE_KEY
TURNKEY_BASE_URL=https://api.turnkey.com
```

## Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/webapp/turnkey/register` | POST | None | Create sub-org + wallet with passkey attestation |
| `/webapp/turnkey/sync` | POST | None | Sync existing Turnkey session, get JWT |
| `/webapp/turnkey/session` | GET | JWT | Validate JWT, return session info |

### Registration Request
```json
{
  "userName": "Suwappu User",
  "challenge": "base64-encoded-challenge",
  "attestation": {
    "credentialId": "base64-credential-id",
    "attestationObject": "base64-attestation",
    "clientDataJson": "base64-client-data",
    "transports": ["AUTHENTICATOR_TRANSPORT_INTERNAL"]
  }
}
```

### Registration Response
```json
{
  "success": true,
  "token": "eyJ...",
  "userId": 10,
  "subOrgId": "743af032-5dea-4e62-b281-e655ab0984f0",
  "walletAddress": "0xD133a6D17841A8840E2DAd7BB8731abF8076E05E",
  "expiresAt": "2026-01-20T06:11:51.000Z"
}
```

## Auth State Management

The `useCombinedAuth()` hook in App.tsx determines auth state:

```typescript
// Priority order:
1. wagmi (MetaMask) - useAccount()
2. localStorage JWT - hasValidSession() + getWalletAddress()
3. React Query cache - ['turnkey', 'session']

// Router context created with:
useMemo([isConnected, isLoading, address, authMethod])
```

After successful registration:
```typescript
// Update React Query cache directly
queryClient.setQueryData(['turnkey', 'session'], {
  isConnected: true,
  address: result.walletAddress,
})
// Invalidate router to re-check beforeLoad guards
await router.invalidate()
// Navigate
navigate({ to: '/home' })
```

## Deployment

### Webapp
```bash
cd webapp

# Build with Turnkey config
docker build \
  --build-arg VITE_API_URL=https://api.suwappu.bot \
  --build-arg VITE_TURNKEY_ORG_ID=5cf56ed5-5d6b-4290-8edb-f52670162aab \
  --build-arg VITE_TURNKEY_RP_ID=devfront.suwappu.bot \
  --build-arg VITE_TURNKEY_PROXY_URL=https://api.turnkey.com \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:development .

# Push and deploy
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:development
AWS_PROFILE=Swappu aws ecs update-service --cluster suwappu-cluster --service suwappu-webapp-dev --force-new-deployment --region us-east-1
```

### API
```bash
cd api-ts

# Build
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest .

# Push and deploy
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest
AWS_PROFILE=Swappu aws ecs update-service --cluster suwappu-cluster --service suwappu-api-ts-prod --force-new-deployment --region us-east-1
```

## Live Endpoints
- **Prod API**: https://api.suwappu.bot (v0.4.0 with Turnkey)
- **Dev Frontend**: https://devfront.suwappu.bot
- **Prod Frontend**: https://app.suwappu.bot

## Known Issues

### Navigation After Registration
After registration succeeds, the app may not auto-navigate to `/home`. The `setQueryData` + `router.invalidate()` approach doesn't always trigger router context recreation.

**Workaround**: Hard refresh after registration

**Potential fixes**:
1. Force component re-render after setQueryData
2. Use window.location.href instead of navigate()
3. Add a key prop to RouterProvider that changes on auth

### Dev API SSL
The `devapi.suwappu.dev` endpoint has an invalid SSL cert. Currently using prod API for both environments.

To fix, add DNS validation record:
- Name: `_9052313a7c1eb7454fd3840616e82aa6.devapi.suwappu.dev`
- Type: CNAME
- Value: `_ed2c30fcf3b442a6c37a35bdfb697d7d.jkddzztszm.acm-validations.aws`

Then add cert to ALB:
```bash
AWS_PROFILE=Swappu aws elbv2 add-listener-certificates \
  --listener-arn <HTTPS_LISTENER_ARN> \
  --certificates CertificateArn=arn:aws:acm:us-east-1:905418423235:certificate/724432c5-b6e4-4e4b-94e1-c8e6e1e3ec6d \
  --region us-east-1
```

## Testing

1. Clear localStorage in DevTools
2. Go to https://devfront.suwappu.bot
3. Click "Create Wallet with Passkey"
4. Complete Face ID/Touch ID prompt
5. Check console for registration result
6. Hard refresh if not redirected
7. Verify wallet address shows in header
