/* ===== Suwappu Docs Portal - app.js ===== */

// ---------- Endpoint Registry ----------

const ENDPOINTS = {
  authentication: {
    title: "Authentication",
    desc: "Wallet-based auth, passkeys (WebAuthn), OAuth, and JWT session management.",
    endpoints: [
      {
        method: "POST", path: "/auth/turnkey/challenge", auth: "none",
        summary: "Generate wallet auth challenge",
        desc: "Generate a challenge message for wallet-based authentication. The user signs this with their wallet to prove ownership.",
        body: { address: { type: "string", required: true, desc: "Ethereum address (0x...)" } },
        response: `{
  "challenge": "Sign this message to authenticate with Suwappu...",
  "nonce": "a1b2c3d4...",
  "expiresAt": "2025-01-01T00:05:00Z"
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/turnkey/challenge \\
  -H "Content-Type: application/json" \\
  -d '{"address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"}'`,
          python: `import requests

resp = requests.post("https://api.suwappu.bot/auth/turnkey/challenge", json={
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
})
print(resp.json())`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/turnkey/challenge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" })
});
const data = await resp.json();`
        }
      },
      {
        method: "POST", path: "/auth/turnkey/verify", auth: "none",
        summary: "Verify signed challenge",
        desc: "Verify the signed challenge and create a session. Returns a JWT token set as an HTTP-only cookie.",
        body: {
          address: { type: "string", required: true, desc: "Ethereum address" },
          signature: { type: "string", required: true, desc: "Signed challenge message" },
          nonce: { type: "string", required: true, desc: "Nonce from challenge response" }
        },
        response: `{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 42, "address": "0x742d...", "username": "web_0x742d35" },
  "expiresAt": "2025-01-08T00:00:00Z"
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/turnkey/verify \\
  -H "Content-Type: application/json" \\
  -d '{"address":"0x742d...","signature":"0xabc...","nonce":"a1b2c3d4"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/turnkey/verify", json={
    "address": "0x742d...",
    "signature": "0xabc...",
    "nonce": "a1b2c3d4"
})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/turnkey/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: "0x742d...", signature: "0xabc...", nonce: "a1b2c3d4" })
});`
        }
      },
      {
        method: "GET", path: "/auth/me", auth: "jwt",
        summary: "Get current user",
        desc: "Get the currently authenticated user's information from JWT cookie or Bearer token.",
        response: `{
  "authenticated": true,
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "userId": 42,
  "createdAt": "2025-01-01T00:00:00Z"
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/auth/me \\
  -H "Authorization: Bearer eyJhbGciOi..."`,
          python: `resp = requests.get("https://api.suwappu.bot/auth/me",
    headers={"Authorization": "Bearer eyJhbGciOi..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/me", {
  headers: { "Authorization": "Bearer eyJhbGciOi..." }
});`
        }
      },
      {
        method: "POST", path: "/auth/logout", auth: "jwt",
        summary: "Logout (clear session)",
        desc: "Log out the current user by clearing the session cookie.",
        response: `{ "success": true, "message": "Logged out successfully" }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/logout -b "suwappu_auth=eyJ..."`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/logout",
    cookies={"suwappu_auth": "eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/auth/logout", {
  method: "POST", credentials: "include"
});`
        }
      },
      {
        method: "POST", path: "/auth/passkey/register/init", auth: "none",
        summary: "Init passkey registration",
        desc: "Initialize passkey (WebAuthn) registration. Returns a challenge for credential creation.",
        body: {
          email: { type: "string", required: false, desc: "Optional email" },
          displayName: { type: "string", required: false, desc: "Optional display name" }
        },
        response: `{
  "challenge": "dGVzdC1jaGFsbGVuZ2U...",
  "userId": "abc123...",
  "userName": "user@example.com",
  "rpId": "api.suwappu.bot",
  "rpName": "Suwappu",
  "attestation": "none"
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/passkey/register/init \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/passkey/register/init",
    json={"email": "user@example.com"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/passkey/register/init", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "user@example.com" })
});`
        }
      },
      {
        method: "POST", path: "/auth/passkey/register/complete", auth: "none",
        summary: "Complete passkey registration",
        desc: "Complete passkey registration. Verifies the WebAuthn credential and creates user + Turnkey wallet.",
        body: {
          credentialId: { type: "string", required: true, desc: "Base64url credential ID" },
          attestationObject: { type: "string", required: true, desc: "Base64url attestation object" },
          clientDataJSON: { type: "string", required: true, desc: "Base64url client data JSON" },
          transports: { type: "string[]", required: false, desc: "Transport hints (usb, ble, nfc, internal)" }
        },
        response: `{
  "success": true,
  "userId": 42,
  "walletAddress": "0x...",
  "subOrgId": "sub_org_..."
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/passkey/register/complete \\
  -H "Content-Type: application/json" \\
  -d '{"credentialId":"abc...","attestationObject":"def...","clientDataJSON":"ghi..."}'`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/passkey/register/complete",
    json={"credentialId": "abc...", "attestationObject": "def...", "clientDataJSON": "ghi..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/passkey/register/complete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ credentialId: "abc...", attestationObject: "def...", clientDataJSON: "ghi..." })
});`
        }
      },
      {
        method: "POST", path: "/auth/passkey/authenticate/init", auth: "none",
        summary: "Init passkey authentication",
        desc: "Initialize passkey authentication. Returns a challenge for WebAuthn assertion.",
        response: `{
  "challenge": "dGVzdC1jaGFsbGVuZ2U...",
  "rpId": "api.suwappu.bot",
  "allowCredentials": null
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/passkey/authenticate/init`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/passkey/authenticate/init")`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/passkey/authenticate/init", { method: "POST" });`
        }
      },
      {
        method: "POST", path: "/auth/passkey/authenticate/complete", auth: "none",
        summary: "Complete passkey authentication",
        desc: "Complete passkey authentication. Verifies the WebAuthn assertion and returns a session JWT.",
        body: {
          credentialId: { type: "string", required: true, desc: "Base64url credential ID" },
          authenticatorData: { type: "string", required: true, desc: "Base64url authenticator data" },
          clientDataJSON: { type: "string", required: true, desc: "Base64url client data JSON" },
          signature: { type: "string", required: true, desc: "Base64url signature" },
          userHandle: { type: "string", required: false, desc: "Optional user handle" }
        },
        response: `{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "userId": 42,
  "walletAddress": "0x...",
  "expiresAt": "2025-01-08T00:00:00Z"
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/passkey/authenticate/complete \\
  -H "Content-Type: application/json" \\
  -d '{"credentialId":"abc...","authenticatorData":"def...","clientDataJSON":"ghi...","signature":"jkl..."}'`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/passkey/authenticate/complete",
    json={...})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/passkey/authenticate/complete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ credentialId: "abc...", authenticatorData: "def...", clientDataJSON: "ghi...", signature: "jkl..." })
});`
        }
      },
      {
        method: "GET", path: "/auth/oauth/providers", auth: "none",
        summary: "List OAuth providers",
        desc: "Get available OAuth providers and their enabled status.",
        response: `{ "google": true, "twitter": true }`,
        examples: {
          curl: `curl https://api.suwappu.bot/auth/oauth/providers`,
          python: `resp = requests.get("https://api.suwappu.bot/auth/oauth/providers")`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/oauth/providers");`
        }
      },
      {
        method: "GET", path: "/auth/oauth/{provider}/authorize", auth: "none",
        summary: "Start OAuth flow",
        desc: "Start OAuth authorization flow. Redirects to the provider's consent screen. Supports google and twitter.",
        params: {
          provider: { type: "string", required: true, desc: "OAuth provider (google or twitter)" }
        },
        response: `// Redirects to provider's authorization URL`,
        examples: {
          curl: `# Opens in browser
curl -L https://api.suwappu.bot/auth/oauth/google/authorize`,
          python: `# Typically opened in a browser/webview
import webbrowser
webbrowser.open("https://api.suwappu.bot/auth/oauth/google/authorize")`,
          javascript: `window.location.href = "https://api.suwappu.bot/auth/oauth/google/authorize";`
        }
      },
      {
        method: "GET", path: "/auth/oauth/{provider}/callback", auth: "none",
        summary: "OAuth callback",
        desc: "Callback endpoint for OAuth providers. Exchanges authorization code for tokens and creates/links user session.",
        params: {
          provider: { type: "string", required: true, desc: "OAuth provider" }
        },
        response: `{
  "success": true,
  "token": "eyJhbGciOi...",
  "user": { "id": 42, "email": "user@gmail.com" },
  "expiresAt": "2025-01-08T00:00:00Z",
  "is_new_user": false
}`,
        examples: {
          curl: `# Called automatically by OAuth redirect`,
          python: `# Called automatically by OAuth redirect`,
          javascript: `// Called automatically by OAuth redirect`
        }
      },
      {
        method: "POST", path: "/auth/oauth/link", auth: "jwt",
        summary: "Link OAuth to account",
        desc: "Link an OAuth provider to the currently authenticated account. Returns an authorization URL to complete linking.",
        body: { provider: { type: "string", required: true, desc: "Provider to link (google or twitter)" } },
        response: `{
  "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "abc123..."
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/auth/oauth/link \\
  -H "Authorization: Bearer eyJ..." \\
  -H "Content-Type: application/json" \\
  -d '{"provider":"google"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/auth/oauth/link",
    headers={"Authorization": "Bearer eyJ..."},
    json={"provider": "google"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/oauth/link", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "google" })
});`
        }
      },
      {
        method: "DELETE", path: "/auth/oauth/unlink/{provider}", auth: "jwt",
        summary: "Unlink OAuth provider",
        desc: "Unlink an OAuth provider from the current account.",
        params: { provider: { type: "string", required: true, desc: "Provider to unlink" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/auth/oauth/unlink/google \\
  -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/auth/oauth/unlink/google",
    headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/auth/oauth/unlink/google", {
  method: "DELETE",
  headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      },
      {
        method: "GET", path: "/auth/oauth/identities", auth: "jwt",
        summary: "List linked identities",
        desc: "List all OAuth identities linked to the current account.",
        response: `[
  {
    "id": 1,
    "provider": "google",
    "email": "user@gmail.com",
    "name": "John Doe",
    "profile_image": "https://...",
    "is_primary": true,
    "created_at": "2025-01-01T00:00:00Z"
  }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/auth/oauth/identities \\
  -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/auth/oauth/identities",
    headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/auth/oauth/identities", {
  headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      }
    ],
    diagrams: [
      {
        title: "Wallet Challenge/Sign/Verify Flow",
        content: `Client                    API                     Blockchain
  |                        |                          |
  |  POST /auth/turnkey/   |                          |
  |       challenge        |                          |
  |  {address: "0x..."}    |                          |
  |----------------------->|                          |
  |                        |                          |
  |  {challenge, nonce,    |                          |
  |   expiresAt}           |                          |
  |<-----------------------|                          |
  |                        |                          |
  |  wallet.signMessage()  |                          |
  |----------------------------------------------->  |
  |                    signature                      |
  |<-----------------------------------------------  |
  |                        |                          |
  |  POST /auth/turnkey/   |                          |
  |       verify           |  ecrecover(sig) == addr  |
  |  {address, signature,  |------------------------->|
  |   nonce}               |        verified          |
  |----------------------->|<-------------------------|
  |                        |                          |
  |  {token, user,         |                          |
  |   expiresAt}           |                          |
  |  + Set-Cookie          |                          |
  |<-----------------------|                          |`
      },
      {
        title: "Passkey (WebAuthn) Registration Flow",
        content: `Client (Browser)          API                     Turnkey
  |                        |                          |
  |  POST /auth/passkey/   |                          |
  |  register/init         |                          |
  |----------------------->|                          |
  |                        |                          |
  |  {challenge, rpId,     |                          |
  |   userId, userName}    |                          |
  |<-----------------------|                          |
  |                        |                          |
  |  navigator.credentials |                          |
  |  .create({publicKey})  |                          |
  |  (biometric prompt)    |                          |
  |                        |                          |
  |  POST /auth/passkey/   |                          |
  |  register/complete     |  createSubOrg()          |
  |  {credentialId,        |  createWallet()          |
  |   attestationObject,   |------------------------->|
  |   clientDataJSON}      |   {address, subOrgId}    |
  |----------------------->|<-------------------------|
  |                        |                          |
  |  {success, userId,     |                          |
  |   walletAddress}       |                          |
  |  + Set-Cookie (JWT)    |                          |
  |<-----------------------|                          |`
      },
      {
        title: "OAuth Authorization Flow",
        content: `Client                    API                     Provider (Google/Twitter)
  |                        |                          |
  |  GET /auth/oauth/      |                          |
  |  google/authorize      |                          |
  |----------------------->|                          |
  |                        |  Generate PKCE +         |
  |  302 Redirect          |  state token             |
  |<-----------------------|                          |
  |                        |                          |
  |  (User consents at     |                          |
  |   provider)            |                          |
  |----------------------------------------------->  |
  |                        |                          |
  |  GET /auth/oauth/      |  Exchange code +         |
  |  google/callback       |  verify PKCE             |
  |  ?code=xxx&state=yyy   |------------------------->|
  |----------------------->|  {access_token, email}   |
  |                        |<-------------------------|
  |                        |                          |
  |  {token, user,         |  Find/create user        |
  |   expiresAt}           |  Link identity           |
  |  + Set-Cookie (JWT)    |  Create Turnkey wallet   |
  |<-----------------------|                          |`
      }
    ]
  },

  agents: {
    title: "Agent API",
    desc: "AI agent interoperability via the A2A protocol. Authenticate with X-Agent-Key header.",
    endpoints: [
      {
        method: "GET", path: "/tools", auth: "agent",
        summary: "Agent tool discovery",
        desc: "Returns a semantic directory of tools available to AI agents. Agents use this to register Suwappu as a toolset.",
        response: `{
  "provider": "Suwappu Liquidity Bot",
  "description": "High-performance multi-chain trading and wallet management.",
  "tools": [
    {
      "name": "get_portfolio",
      "endpoint": "/users/{user_id}/portfolio",
      "method": "GET",
      "description": "Check multi-chain balances for a user."
    },
    { "name": "get_wallets", "endpoint": "/users/{user_id}/wallets", "method": "GET" },
    { "name": "provision_wallet", "endpoint": "/v1/agent/wallets", "method": "POST" },
    { "name": "execute_command", "endpoint": "/v1/agent/execute", "method": "POST" }
  ]
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/tools \\
  -H "X-Agent-Key: your-agent-key"`,
          python: `resp = requests.get("https://api.suwappu.bot/tools",
    headers={"X-Agent-Key": "your-agent-key"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/tools", {
  headers: { "X-Agent-Key": "your-agent-key" }
});`
        }
      },
      {
        method: "POST", path: "/v1/agent/execute", auth: "agent",
        summary: "Execute natural language trading command",
        desc: "Direct bridge to Suwappu's Natural Language Trading Engine. Agents send raw strings and receive structured execution results.",
        body: {
          text: { type: "string", required: true, desc: 'Trading command (e.g. "buy 0.1 eth on base")' },
          user_id: { type: "integer", required: true, desc: "Target user ID" },
          context: { type: "object", required: false, desc: "Optional context for the command" }
        },
        response: `{
  "status": "success",
  "input": "buy 0.1 eth on base",
  "response": "Swap initiated: 0.1 ETH on Base...",
  "buttons": [],
  "timestamp": "2025-01-01T00:00:00Z"
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/agent/execute \\
  -H "X-Agent-Key: your-agent-key" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"buy 0.1 eth on base","user_id":42}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/agent/execute",
    headers={"X-Agent-Key": "your-agent-key"},
    json={"text": "buy 0.1 eth on base", "user_id": 42})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/agent/execute", {
  method: "POST",
  headers: { "X-Agent-Key": "your-agent-key", "Content-Type": "application/json" },
  body: JSON.stringify({ text: "buy 0.1 eth on base", user_id: 42 })
});`
        }
      },
      {
        method: "POST", path: "/v1/agent/wallets", auth: "agent",
        summary: "Provision a new wallet",
        desc: "Programmatically create a new managed wallet for an agent-managed user.",
        body: {
          user_id: { type: "integer", required: true, desc: "Target user ID" },
          name: { type: "string", required: false, desc: 'Wallet name (default: "Agent Managed Wallet")' },
          chain_type: { type: "string", required: false, desc: '"evm" or "solana" (default: "evm")' }
        },
        response: `{
  "id": 1,
  "userId": 42,
  "name": "Agent Managed Wallet",
  "address": "0x...",
  "chainType": "evm",
  "isActive": true,
  "isDefault": false,
  "createdAt": "2025-01-01T00:00:00Z"
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/agent/wallets \\
  -H "X-Agent-Key: your-agent-key" \\
  -H "Content-Type: application/json" \\
  -d '{"user_id":42,"chain_type":"solana"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/agent/wallets",
    headers={"X-Agent-Key": "your-agent-key"},
    json={"user_id": 42, "chain_type": "solana"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/agent/wallets", {
  method: "POST",
  headers: { "X-Agent-Key": "your-agent-key", "Content-Type": "application/json" },
  body: JSON.stringify({ user_id: 42, chain_type: "solana" })
});`
        }
      },
      {
        method: "GET", path: "/users/{user_id}/wallets", auth: "agent",
        summary: "List user wallets",
        desc: "Retrieve all active wallets for a specific user. Use this to identify target addresses for deposit/swap operations.",
        params: { user_id: { type: "integer", required: true, desc: "Database user ID" } },
        response: `[
  {
    "id": 1,
    "userId": 42,
    "name": "Primary Wallet",
    "address": "0x742d35Cc...",
    "chainType": "evm",
    "isActive": true,
    "isDefault": true,
    "createdAt": "2025-01-01T00:00:00Z"
  }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/users/42/wallets \\
  -H "X-Agent-Key: your-agent-key"`,
          python: `resp = requests.get("https://api.suwappu.bot/users/42/wallets",
    headers={"X-Agent-Key": "your-agent-key"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/users/42/wallets", {
  headers: { "X-Agent-Key": "your-agent-key" }
});`
        }
      },
      {
        method: "GET", path: "/users/{user_id}/portfolio", auth: "agent",
        summary: "Get user portfolio balances",
        desc: "Fetches a real-time consolidated balance sheet for a user across all supported chains. Call this before initiating swaps to verify liquidity.",
        params: { user_id: { type: "integer", required: true, desc: "Database user ID" } },
        response: `{
  "totalUSD": 1234.56,
  "tokens": [
    {
      "id": "ethereum-ETH",
      "token": { "id": "ethereum-ETH", "symbol": "ETH", "name": "ETH", "decimals": 18, "address": "0x...", "chainId": "ethereum" },
      "balance": "1000000000000000000",
      "balanceHuman": 1.0,
      "balanceUSD": 1234.56,
      "chainId": "ethereum"
    }
  ],
  "chains": { "ethereum": 1234.56 }
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/users/42/portfolio \\
  -H "X-Agent-Key: your-agent-key"`,
          python: `resp = requests.get("https://api.suwappu.bot/users/42/portfolio",
    headers={"X-Agent-Key": "your-agent-key"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/users/42/portfolio", {
  headers: { "X-Agent-Key": "your-agent-key" }
});`
        }
      }
    ]
  },

  "mobile-wallets": {
    title: "Wallets (Mobile)",
    desc: "Create and manage wallets. All mobile endpoints require JWT authentication (Bearer token or suwappu_auth cookie).",
    endpoints: [
      {
        method: "POST", path: "/v1/mobile/wallets", auth: "jwt",
        summary: "Create wallet",
        desc: "Create a new EVM or Solana wallet for the authenticated user.",
        body: { chainType: { type: "string", required: false, desc: '"evm" or "solana" (default: "evm")' } },
        response: `{
  "success": true,
  "wallet": {
    "address": "0x...",
    "chainType": "evm",
    "name": "Wallet #2",
    "isDefault": false,
    "provider": "local"
  }
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/wallets \\
  -H "Authorization: Bearer eyJ..." \\
  -H "Content-Type: application/json" \\
  -d '{"chainType":"solana"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/wallets",
    headers={"Authorization": "Bearer eyJ..."},
    json={"chainType": "solana"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/wallets", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ chainType: "solana" })
});`
        }
      },
      {
        method: "PUT", path: "/v1/mobile/wallets/default", auth: "jwt",
        summary: "Set default wallet",
        desc: "Set a wallet as the default for the authenticated user.",
        body: { address: { type: "string", required: true, desc: "Wallet address to set as default" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X PUT https://api.suwappu.bot/v1/mobile/wallets/default \\
  -H "Authorization: Bearer eyJ..." \\
  -H "Content-Type: application/json" \\
  -d '{"address":"0x742d..."}'`,
          python: `resp = requests.put("https://api.suwappu.bot/v1/mobile/wallets/default",
    headers={"Authorization": "Bearer eyJ..."},
    json={"address": "0x742d..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/wallets/default", {
  method: "PUT",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ address: "0x742d..." })
});`
        }
      }
    ]
  },

  "mobile-alerts": {
    title: "Price Alerts",
    desc: "Create and manage price alerts for any token on any supported chain.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/alerts", auth: "jwt",
        summary: "List alerts",
        desc: "Get all price alerts for the authenticated user.",
        response: `[
  {
    "id": 1,
    "tokenSymbol": "ETH",
    "tokenAddress": "0x...",
    "chain": "ethereum",
    "alertType": "price_above",
    "targetPrice": 4000.0,
    "currentPrice": 3500.0,
    "isActive": true,
    "triggered": false,
    "createdAt": "2025-01-01T00:00:00Z"
  }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/alerts -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/alerts",
    headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/alerts", {
  headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      },
      {
        method: "POST", path: "/v1/mobile/alerts", auth: "jwt",
        summary: "Create alert",
        desc: "Create a new price alert.",
        body: {
          tokenSymbol: { type: "string", required: true, desc: "Token symbol (e.g. ETH)" },
          tokenAddress: { type: "string", required: true, desc: "Token contract address" },
          chain: { type: "string", required: true, desc: "Chain name" },
          alertType: { type: "string", required: true, desc: "price_above, price_below, or percent_change" },
          targetPrice: { type: "number", required: false, desc: "Target price (for price_above/below)" },
          percentChange: { type: "number", required: false, desc: "Percent change threshold" }
        },
        response: `{ "success": true, "alertId": 1 }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/alerts \\
  -H "Authorization: Bearer eyJ..." \\
  -H "Content-Type: application/json" \\
  -d '{"tokenSymbol":"ETH","tokenAddress":"0x...","chain":"ethereum","alertType":"price_above","targetPrice":4000}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/alerts",
    headers={"Authorization": "Bearer eyJ..."},
    json={"tokenSymbol": "ETH", "tokenAddress": "0x...", "chain": "ethereum",
           "alertType": "price_above", "targetPrice": 4000})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/alerts", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ tokenSymbol: "ETH", tokenAddress: "0x...", chain: "ethereum", alertType: "price_above", targetPrice: 4000 })
});`
        }
      },
      {
        method: "DELETE", path: "/v1/mobile/alerts/{alert_id}", auth: "jwt",
        summary: "Delete alert",
        desc: "Delete a price alert.",
        params: { alert_id: { type: "integer", required: true, desc: "Alert ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/v1/mobile/alerts/1 -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/v1/mobile/alerts/1",
    headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/alerts/1", {
  method: "DELETE", headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      },
      {
        method: "PUT", path: "/v1/mobile/alerts/{alert_id}/toggle", auth: "jwt",
        summary: "Toggle alert active status",
        desc: "Toggle a price alert on or off.",
        params: { alert_id: { type: "integer", required: true, desc: "Alert ID" } },
        response: `{ "success": true, "isActive": false }`,
        examples: {
          curl: `curl -X PUT https://api.suwappu.bot/v1/mobile/alerts/1/toggle -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.put("https://api.suwappu.bot/v1/mobile/alerts/1/toggle",
    headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/alerts/1/toggle", {
  method: "PUT", headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      }
    ]
  },

  "mobile-orders": {
    title: "Orders & DCA",
    desc: "Limit orders and Dollar Cost Averaging plans.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/orders", auth: "jwt",
        summary: "List limit orders",
        desc: "Get all limit orders for the authenticated user.",
        response: `[
  {
    "id": 1, "orderType": "limit_buy", "fromToken": "USDC", "toToken": "ETH",
    "fromChain": "base", "toChain": "base", "amount": "100",
    "triggerPrice": 3000.0, "status": "pending", "createdAt": "2025-01-01T00:00:00Z"
  }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/orders -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/orders", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/orders", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "POST", path: "/v1/mobile/orders", auth: "jwt",
        summary: "Create limit order",
        desc: "Create a new limit order.",
        body: {
          orderType: { type: "string", required: true, desc: "Order type (e.g. limit_buy)" },
          fromToken: { type: "string", required: true, desc: "Source token symbol" },
          toToken: { type: "string", required: true, desc: "Target token symbol" },
          fromChain: { type: "string", required: true, desc: "Source chain" },
          toChain: { type: "string", required: true, desc: "Target chain" },
          amount: { type: "string", required: true, desc: "Amount in source token" },
          triggerPrice: { type: "number", required: true, desc: "Price to trigger at" },
          slippage: { type: "integer", required: false, desc: "Slippage in bps" },
          expiresInHours: { type: "integer", required: false, desc: "Expiration time in hours" }
        },
        response: `{ "success": true, "orderId": 1 }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/orders \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"orderType":"limit_buy","fromToken":"USDC","toToken":"ETH","fromChain":"base","toChain":"base","amount":"100","triggerPrice":3000}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/orders",
    headers={"Authorization": "Bearer eyJ..."},
    json={"orderType": "limit_buy", "fromToken": "USDC", "toToken": "ETH",
           "fromChain": "base", "toChain": "base", "amount": "100", "triggerPrice": 3000})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/orders", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ orderType: "limit_buy", fromToken: "USDC", toToken: "ETH", fromChain: "base", toChain: "base", amount: "100", triggerPrice: 3000 })
});`
        }
      },
      {
        method: "DELETE", path: "/v1/mobile/orders/{order_id}", auth: "jwt",
        summary: "Cancel limit order",
        params: { order_id: { type: "integer", required: true, desc: "Order ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/v1/mobile/orders/1 -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/v1/mobile/orders/1", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/orders/1", { method: "DELETE", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/dca", auth: "jwt",
        summary: "List DCA plans",
        desc: "Get all DCA (Dollar Cost Averaging) plans for the authenticated user.",
        response: `[
  {
    "id": 1, "fromToken": "USDC", "toToken": "ETH", "fromChain": "base", "toChain": "base",
    "amountPerExecution": "50", "intervalHours": 24, "executionCount": 5,
    "maxExecutions": 30, "status": "active", "nextExecution": "2025-01-02T00:00:00Z"
  }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/dca -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/dca", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/dca", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "POST", path: "/v1/mobile/dca", auth: "jwt",
        summary: "Create DCA plan",
        body: {
          fromToken: { type: "string", required: true, desc: "Source token" },
          toToken: { type: "string", required: true, desc: "Target token" },
          fromChain: { type: "string", required: true, desc: "Source chain" },
          toChain: { type: "string", required: true, desc: "Target chain" },
          amountPerExecution: { type: "string", required: true, desc: "Amount per buy" },
          intervalHours: { type: "integer", required: true, desc: "Hours between executions" },
          maxExecutions: { type: "integer", required: false, desc: "Max number of executions" },
          maxTotalAmount: { type: "string", required: false, desc: "Max total amount to spend" }
        },
        response: `{ "success": true, "dcaId": 1 }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/dca \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"fromToken":"USDC","toToken":"ETH","fromChain":"base","toChain":"base","amountPerExecution":"50","intervalHours":24}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/dca",
    headers={"Authorization": "Bearer eyJ..."},
    json={"fromToken": "USDC", "toToken": "ETH", "fromChain": "base",
           "toChain": "base", "amountPerExecution": "50", "intervalHours": 24})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/dca", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ fromToken: "USDC", toToken: "ETH", fromChain: "base", toChain: "base", amountPerExecution: "50", intervalHours: 24 })
});`
        }
      },
      {
        method: "PUT", path: "/v1/mobile/dca/{dca_id}/pause", auth: "jwt",
        summary: "Pause DCA plan",
        params: { dca_id: { type: "integer", required: true, desc: "DCA plan ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X PUT https://api.suwappu.bot/v1/mobile/dca/1/pause -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.put("https://api.suwappu.bot/v1/mobile/dca/1/pause", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/dca/1/pause", { method: "PUT", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "PUT", path: "/v1/mobile/dca/{dca_id}/resume", auth: "jwt",
        summary: "Resume DCA plan",
        params: { dca_id: { type: "integer", required: true, desc: "DCA plan ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X PUT https://api.suwappu.bot/v1/mobile/dca/1/resume -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.put("https://api.suwappu.bot/v1/mobile/dca/1/resume", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/dca/1/resume", { method: "PUT", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "DELETE", path: "/v1/mobile/dca/{dca_id}", auth: "jwt",
        summary: "Cancel DCA plan",
        params: { dca_id: { type: "integer", required: true, desc: "DCA plan ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/v1/mobile/dca/1 -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/v1/mobile/dca/1", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/dca/1", { method: "DELETE", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      }
    ]
  },

  "mobile-points": {
    title: "Points & XP",
    desc: "Gamification system with XP, levels, milestones, rewards, and leaderboard.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/points", auth: "jwt",
        summary: "Get points/XP/level",
        desc: "Get the authenticated user's points, XP, level, and streak information.",
        response: `{
  "xp": 1250, "level": 5, "tier": "Silver",
  "streak": 3, "longestStreak": 7,
  "nextLevelXp": 2000, "rank": 42
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/points -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/points", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/points", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "POST", path: "/v1/mobile/points/checkin", auth: "jwt",
        summary: "Daily check-in",
        desc: "Perform daily check-in to earn XP and maintain streak.",
        response: `{ "success": true, "xpEarned": 50, "streak": 4, "bonus": false }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/points/checkin -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/points/checkin", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/points/checkin", { method: "POST", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/points/milestones", auth: "jwt",
        summary: "Get milestones",
        response: `[
  { "id": "first_swap", "title": "First Swap", "xpReward": 100, "completed": true },
  { "id": "10_swaps", "title": "10 Swaps", "xpReward": 500, "completed": false, "progress": 7 }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/points/milestones -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/points/milestones", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/points/milestones", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/points/rewards", auth: "jwt",
        summary: "Get available rewards",
        response: `[
  { "id": "fee_discount_10", "title": "10% Fee Discount", "cost": 1000, "available": true }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/points/rewards -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/points/rewards", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/points/rewards", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "POST", path: "/v1/mobile/points/rewards/{reward_id}/redeem", auth: "jwt",
        summary: "Redeem reward",
        params: { reward_id: { type: "string", required: true, desc: "Reward ID" } },
        response: `{ "success": true, "remaining_xp": 250 }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/points/rewards/fee_discount_10/redeem -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/points/rewards/fee_discount_10/redeem", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/points/rewards/fee_discount_10/redeem", { method: "POST", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/points/leaderboard", auth: "jwt",
        summary: "Leaderboard",
        desc: "Get top users by XP.",
        response: `{
  "leaderboard": [
    { "rank": 1, "username": "whale_42", "xp": 50000, "level": 25, "tier": "Diamond" }
  ],
  "myRank": 42
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/points/leaderboard -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/points/leaderboard", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/points/leaderboard", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/points/history", auth: "jwt",
        summary: "Points history",
        desc: "Get points/XP transaction history.",
        response: `[
  { "type": "swap_xp", "amount": 25, "description": "Swap on Base", "createdAt": "2025-01-01T00:00:00Z" }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/points/history -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/points/history", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/points/history", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      }
    ]
  },

  "mobile-referrals": {
    title: "Referrals",
    desc: "Referral program with tracking, stats, and reward claims.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/referral/code", auth: "jwt",
        summary: "Get referral code",
        response: `{ "code": "SUWAP42", "link": "https://t.me/SuwappuBot?start=ref_SUWAP42" }`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/referral/code -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/referral/code", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/referral/code", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/referral/stats", auth: "jwt",
        summary: "Referral stats",
        response: `{ "totalReferred": 12, "activeReferred": 8, "totalEarnings": "45.50", "pendingRewards": "5.25" }`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/referral/stats -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/referral/stats", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/referral/stats", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/referral/list", auth: "jwt",
        summary: "List referrals",
        response: `[
  { "username": "user_123", "joinedAt": "2025-01-01T00:00:00Z", "swapCount": 5, "volumeUsd": 1250.0 }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/referral/list -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/referral/list", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/referral/list", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/referral/rewards", auth: "jwt",
        summary: "Referral rewards",
        response: `[
  { "id": 1, "amount": "2.50", "token": "USDC", "chain": "base", "status": "claimable", "from": "user_123" }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/referral/rewards -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/referral/rewards", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/referral/rewards", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      }
    ]
  },

  "mobile-copy": {
    title: "Copy Trading",
    desc: "Follow top traders and automatically copy their trades.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/copy-trading/leaderboard", auth: "jwt",
        summary: "Trader leaderboard",
        desc: "Get top traders ranked by performance score.",
        response: `[
  {
    "userId": 1, "username": "alpha_trader", "rankScore": 95.2,
    "pnlPercent": 142.5, "winRate": 78.3, "totalTrades": 250,
    "followers": 42, "isFollowing": false
  }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/copy-trading/leaderboard -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/copy-trading/leaderboard", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/copy-trading/leaderboard", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/copy-trading/trader/{trader_id}", auth: "jwt",
        summary: "Trader profile",
        params: { trader_id: { type: "integer", required: true, desc: "Trader user ID" } },
        response: `{
  "userId": 1, "username": "alpha_trader", "pnlPercent": 142.5,
  "winRate": 78.3, "avgTradeSize": "500", "favoriteChains": ["base", "solana"],
  "recentTrades": [{ "token": "ETH", "type": "buy", "pnl": 12.5 }]
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/copy-trading/trader/1 -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/copy-trading/trader/1", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/copy-trading/trader/1", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "POST", path: "/v1/mobile/copy-trading/follow/{trader_id}", auth: "jwt",
        summary: "Follow trader",
        params: { trader_id: { type: "integer", required: true, desc: "Trader user ID" } },
        body: {
          copyMode: { type: "string", required: false, desc: '"notify" or "auto" (default: "notify")' },
          copyType: { type: "string", required: false, desc: '"fixed_amount" or "percentage"' },
          copyAmount: { type: "string", required: false, desc: "Fixed amount per trade" },
          copyPercentage: { type: "number", required: false, desc: "Percentage of trader's position" },
          maxPerTrade: { type: "string", required: false, desc: "Max amount per copied trade" },
          dailyLimit: { type: "string", required: false, desc: "Max daily spend" }
        },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/copy-trading/follow/1 \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"copyMode":"auto","copyType":"fixed_amount","copyAmount":"50","maxPerTrade":"200"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/copy-trading/follow/1",
    headers={"Authorization": "Bearer eyJ..."},
    json={"copyMode": "auto", "copyType": "fixed_amount", "copyAmount": "50"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/copy-trading/follow/1", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ copyMode: "auto", copyType: "fixed_amount", copyAmount: "50" })
});`
        }
      },
      {
        method: "DELETE", path: "/v1/mobile/copy-trading/follow/{trader_id}", auth: "jwt",
        summary: "Unfollow trader",
        params: { trader_id: { type: "integer", required: true, desc: "Trader user ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/v1/mobile/copy-trading/follow/1 -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/v1/mobile/copy-trading/follow/1", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/copy-trading/follow/1", { method: "DELETE", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/copy-trading/follows", auth: "jwt",
        summary: "My follows",
        desc: "Get list of traders the user is following.",
        response: `[
  { "traderId": 1, "username": "alpha_trader", "copyMode": "auto", "copyAmount": "50", "totalCopied": "250", "pnl": 32.5 }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/copy-trading/follows -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/copy-trading/follows", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/copy-trading/follows", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/copy-trading/trades", auth: "jwt",
        summary: "Copy trade history",
        response: `[
  { "id": 1, "traderId": 1, "traderUsername": "alpha_trader", "token": "ETH", "amount": "50", "pnl": 5.25, "copiedAt": "2025-01-01T00:00:00Z" }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/copy-trading/trades -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/copy-trading/trades", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/copy-trading/trades", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      }
    ]
  },

  "mobile-sniping": {
    title: "Sniping",
    desc: "Token launch sniping with MEV protection and Jito tips.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/sniping/orders", auth: "jwt",
        summary: "List snipe orders",
        response: `[
  { "id": 1, "tokenAddress": "So1...", "platform": "raydium", "mode": "instant",
    "amountSol": "0.5", "status": "pending", "useMevProtection": true }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/sniping/orders -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/sniping/orders", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/sniping/orders", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "POST", path: "/v1/mobile/sniping/orders", auth: "jwt",
        summary: "Create snipe order",
        body: {
          tokenAddress: { type: "string", required: false, desc: "Token address (optional for auto-snipe)" },
          platform: { type: "string", required: false, desc: '"raydium", "pumpfun", or "any" (default: "any")' },
          mode: { type: "string", required: false, desc: '"instant" or "conditional" (default: "instant")' },
          amountSol: { type: "string", required: true, desc: "Amount of SOL to spend" },
          slippage: { type: "integer", required: false, desc: "Slippage in bps" },
          jitoTipLamports: { type: "integer", required: false, desc: "Jito tip in lamports" },
          useMevProtection: { type: "boolean", required: false, desc: "Enable MEV protection (default: true)" }
        },
        response: `{ "success": true, "orderId": 1 }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/mobile/sniping/orders \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"tokenAddress":"So1...","amountSol":"0.5","useMevProtection":true}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/mobile/sniping/orders",
    headers={"Authorization": "Bearer eyJ..."},
    json={"tokenAddress": "So1...", "amountSol": "0.5", "useMevProtection": True})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/sniping/orders", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ tokenAddress: "So1...", amountSol: "0.5", useMevProtection: true })
});`
        }
      },
      {
        method: "DELETE", path: "/v1/mobile/sniping/orders/{order_id}", auth: "jwt",
        summary: "Cancel snipe order",
        params: { order_id: { type: "integer", required: true, desc: "Order ID" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/v1/mobile/sniping/orders/1 -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/v1/mobile/sniping/orders/1", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/mobile/sniping/orders/1", { method: "DELETE", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/sniping/config", auth: "jwt",
        summary: "Get snipe config",
        response: `{
  "quickAmounts": [0.1, 0.5, 1.0], "defaultSlippage": 500,
  "defaultJitoTip": 10000, "autoSnipeEnabled": false, "maxAutoSnipePerDay": 5
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/sniping/config -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/sniping/config", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/sniping/config", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "PUT", path: "/v1/mobile/sniping/config", auth: "jwt",
        summary: "Update snipe config",
        body: {
          quickAmounts: { type: "number[]", required: false, desc: "Quick amount presets" },
          defaultSlippage: { type: "integer", required: false, desc: "Default slippage in bps" },
          defaultJitoTip: { type: "integer", required: false, desc: "Default Jito tip in lamports" },
          autoSnipeEnabled: { type: "boolean", required: false, desc: "Enable auto-snipe" },
          maxAutoSnipePerDay: { type: "integer", required: false, desc: "Max auto-snipes per day" }
        },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X PUT https://api.suwappu.bot/v1/mobile/sniping/config \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"defaultSlippage":300,"autoSnipeEnabled":true}'`,
          python: `resp = requests.put("https://api.suwappu.bot/v1/mobile/sniping/config",
    headers={"Authorization": "Bearer eyJ..."},
    json={"defaultSlippage": 300, "autoSnipeEnabled": True})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/sniping/config", {
  method: "PUT",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ defaultSlippage: 300, autoSnipeEnabled: true })
});`
        }
      }
    ]
  },

  "mobile-tokens": {
    title: "Token Discovery",
    desc: "Token price data, trending tokens, gainers, and search.",
    endpoints: [
      {
        method: "GET", path: "/v1/mobile/token/{chain}/{address}/price", auth: "jwt",
        summary: "Token price (OHLCV)",
        desc: "Get OHLCV price data for a token.",
        params: {
          chain: { type: "string", required: true, desc: "Chain name (e.g. ethereum, solana)" },
          address: { type: "string", required: true, desc: "Token contract address" }
        },
        queryParams: { timeframe: { type: "string", required: false, desc: "1h, 1d, 1w, 1m, 1y (default: 1d)" } },
        response: `{
  "symbol": "ETH", "name": "Ethereum", "price": 3500.0,
  "change24h": 2.5, "volume24h": 1500000000,
  "ohlcv": [{ "t": 1704067200, "o": 3400, "h": 3550, "l": 3380, "c": 3500, "v": 50000 }]
}`,
        examples: {
          curl: `curl "https://api.suwappu.bot/v1/mobile/token/ethereum/0x.../price?timeframe=1d" \\
  -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/token/ethereum/0x.../price",
    params={"timeframe": "1d"}, headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/token/ethereum/0x.../price?timeframe=1d", {
  headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      },
      {
        method: "GET", path: "/v1/mobile/discover/trending", auth: "jwt",
        summary: "Trending tokens",
        queryParams: {
          chain: { type: "string", required: false, desc: 'Filter by chain (default: "all")' },
          limit: { type: "integer", required: false, desc: "Number of results (default: 50)" }
        },
        response: `[
  { "symbol": "PEPE", "name": "Pepe", "chain": "ethereum", "price": 0.00001,
    "change24h": 25.3, "volume24h": 500000000, "marketCap": 5000000000 }
]`,
        examples: {
          curl: `curl "https://api.suwappu.bot/v1/mobile/discover/trending?chain=solana&limit=20" \\
  -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/discover/trending",
    params={"chain": "solana", "limit": 20}, headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/discover/trending?chain=solana&limit=20", {
  headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      },
      {
        method: "GET", path: "/v1/mobile/discover/gainers", auth: "jwt",
        summary: "Top gainers",
        queryParams: { timeframe: { type: "string", required: false, desc: '"24h" (default)' } },
        response: `[
  { "symbol": "BONK", "chain": "solana", "price": 0.00002, "change24h": 85.2 }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/mobile/discover/gainers -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/discover/gainers", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/discover/gainers", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/mobile/discover/search", auth: "jwt",
        summary: "Search tokens",
        queryParams: { q: { type: "string", required: true, desc: "Search query (min 2 chars)" } },
        response: `[
  { "symbol": "ETH", "name": "Ethereum", "chain": "ethereum", "address": "0x...", "price": 3500.0 }
]`,
        examples: {
          curl: `curl "https://api.suwappu.bot/v1/mobile/discover/search?q=eth" -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/mobile/discover/search",
    params={"q": "eth"}, headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/mobile/discover/search?q=eth", {
  headers: { "Authorization": "Bearer eyJ..." }
});`
        }
      }
    ]
  },

  settings: {
    title: "User Settings",
    desc: "Profile, preferences, push notifications, and trading stats. Requires JWT authentication.",
    endpoints: [
      {
        method: "GET", path: "/v1/me", auth: "jwt",
        summary: "Get profile",
        desc: "Get authenticated user's full profile, preferences, and wallet list.",
        response: `{
  "user": { "id": 42, "telegramId": 123456, "username": "trader_bob", "firstName": "Bob", "lastName": null },
  "preferences": { "defaultSlippage": 100, "notificationsEnabled": true, "twoFaEnabled": false, "twoFaThreshold": 100 },
  "wallets": [
    { "address": "0x...", "name": "Primary", "chainType": "evm", "provider": "local", "isDefault": true, "linkedAt": "2025-01-01T00:00:00" }
  ]
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/me -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/me", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/me", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "PUT", path: "/v1/me/preferences", auth: "jwt",
        summary: "Update preferences",
        body: {
          defaultSlippage: { type: "integer", required: false, desc: "Default slippage in bps" },
          notificationsEnabled: { type: "boolean", required: false, desc: "Enable notifications" },
          twoFaEnabled: { type: "boolean", required: false, desc: "Enable 2FA" },
          twoFaThreshold: { type: "integer", required: false, desc: "2FA threshold in USD" }
        },
        response: `{
  "success": true,
  "preferences": { "defaultSlippage": 200, "notificationsEnabled": true, "twoFaEnabled": true, "twoFaThreshold": 50 }
}`,
        examples: {
          curl: `curl -X PUT https://api.suwappu.bot/v1/me/preferences \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"defaultSlippage":200,"twoFaEnabled":true}'`,
          python: `resp = requests.put("https://api.suwappu.bot/v1/me/preferences",
    headers={"Authorization": "Bearer eyJ..."},
    json={"defaultSlippage": 200, "twoFaEnabled": True})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/me/preferences", {
  method: "PUT",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ defaultSlippage: 200, twoFaEnabled: true })
});`
        }
      },
      {
        method: "POST", path: "/v1/me/push-token", auth: "jwt",
        summary: "Register push token",
        desc: "Register an Expo push token for push notifications.",
        body: { token: { type: "string", required: true, desc: "Expo push token (ExponentPushToken[...])" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/v1/me/push-token \\
  -H "Authorization: Bearer eyJ..." -H "Content-Type: application/json" \\
  -d '{"token":"ExponentPushToken[...]"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/v1/me/push-token",
    headers={"Authorization": "Bearer eyJ..."},
    json={"token": "ExponentPushToken[...]"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/me/push-token", {
  method: "POST",
  headers: { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  body: JSON.stringify({ token: "ExponentPushToken[...]" })
});`
        }
      },
      {
        method: "DELETE", path: "/v1/me/push-token", auth: "jwt",
        summary: "Unregister push token",
        desc: "Remove push token to disable push notifications.",
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/v1/me/push-token -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/v1/me/push-token", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `await fetch("https://api.suwappu.bot/v1/me/push-token", { method: "DELETE", headers: { "Authorization": "Bearer eyJ..." } });`
        }
      },
      {
        method: "GET", path: "/v1/me/stats", auth: "jwt",
        summary: "Trading stats",
        desc: "Get user's trading statistics (volume, PnL, tier).",
        response: `{
  "totalSwaps": 125, "totalVolume": 50000, "totalFees": 250,
  "totalGas": 125, "realizedPnl": 3500, "tier": "Silver"
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/v1/me/stats -H "Authorization: Bearer eyJ..."`,
          python: `resp = requests.get("https://api.suwappu.bot/v1/me/stats", headers={"Authorization": "Bearer eyJ..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/v1/me/stats", { headers: { "Authorization": "Bearer eyJ..." } });`
        }
      }
    ]
  },

  webapp: {
    title: "Telegram WebApp",
    desc: "Endpoints for the Telegram Mini App. Authenticated via X-Telegram-Init-Data header (HMAC-SHA256 validated).",
    endpoints: [
      {
        method: "POST", path: "/webapp/validate", auth: "telegram",
        summary: "Validate initData",
        desc: "Validate Telegram Mini App initData. Returns the authenticated Telegram user.",
        response: `{
  "valid": true,
  "user": {
    "id": 123456, "first_name": "Bob", "last_name": null,
    "username": "trader_bob", "language_code": "en",
    "photo_url": "https://...", "is_premium": true
  }
}`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/webapp/validate \\
  -H "X-Telegram-Init-Data: query_id=AAE..."`,
          python: `resp = requests.post("https://api.suwappu.bot/webapp/validate",
    headers={"X-Telegram-Init-Data": "query_id=AAE..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/webapp/validate", {
  method: "POST",
  headers: { "X-Telegram-Init-Data": window.Telegram.WebApp.initData }
});`
        }
      },
      {
        method: "GET", path: "/webapp/users/me/portfolio", auth: "telegram",
        summary: "Get portfolio",
        desc: "Get user portfolio with token balances and USD values.",
        response: `{
  "totalUsdValue": 1234.56,
  "tokens": [
    { "symbol": "ETH", "name": "Ethereum", "address": "0x...", "chain": "ethereum",
      "balance": "1.0", "usdValue": 3500.0, "logoUrl": null }
  ],
  "lastUpdated": "2025-01-01T00:00:00Z"
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/webapp/users/me/portfolio \\
  -H "X-Telegram-Init-Data: query_id=AAE..."`,
          python: `resp = requests.get("https://api.suwappu.bot/webapp/users/me/portfolio",
    headers={"X-Telegram-Init-Data": "query_id=AAE..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/webapp/users/me/portfolio", {
  headers: { "X-Telegram-Init-Data": window.Telegram.WebApp.initData }
});`
        }
      },
      {
        method: "GET", path: "/webapp/users/me/swaps", auth: "telegram",
        summary: "Swap history",
        desc: "Get swap history with pagination.",
        queryParams: {
          limit: { type: "integer", required: false, desc: "Number of results (default: 20)" },
          offset: { type: "integer", required: false, desc: "Pagination offset (default: 0)" }
        },
        response: `[
  {
    "id": "1", "fromChain": "ethereum", "toChain": "base",
    "fromToken": "ETH", "toToken": "USDC", "fromAmount": "1.0",
    "toAmount": "3500", "status": "completed", "txHash": "0x...",
    "createdAt": "2025-01-01T00:00:00Z"
  }
]`,
        examples: {
          curl: `curl "https://api.suwappu.bot/webapp/users/me/swaps?limit=10" \\
  -H "X-Telegram-Init-Data: query_id=AAE..."`,
          python: `resp = requests.get("https://api.suwappu.bot/webapp/users/me/swaps",
    params={"limit": 10},
    headers={"X-Telegram-Init-Data": "query_id=AAE..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/webapp/users/me/swaps?limit=10", {
  headers: { "X-Telegram-Init-Data": window.Telegram.WebApp.initData }
});`
        }
      },
      {
        method: "GET", path: "/webapp/users/me/wallets", auth: "telegram",
        summary: "List wallets",
        response: `[
  { "address": "0x...", "chainType": "evm", "linkedAt": "2025-01-01T00:00:00", "provider": "local", "name": "Primary" }
]`,
        examples: {
          curl: `curl https://api.suwappu.bot/webapp/users/me/wallets -H "X-Telegram-Init-Data: query_id=AAE..."`,
          python: `resp = requests.get("https://api.suwappu.bot/webapp/users/me/wallets", headers={"X-Telegram-Init-Data": "query_id=AAE..."})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/webapp/users/me/wallets", { headers: { "X-Telegram-Init-Data": window.Telegram.WebApp.initData } });`
        }
      },
      {
        method: "POST", path: "/webapp/wallets/default", auth: "telegram",
        summary: "Get or create default wallet",
        desc: "Get or create a default wallet for the Telegram user. Auto-creates via Turnkey if available.",
        body: {
          chainType: { type: "string", required: false, desc: '"evm" or "solana" (default: "evm")' },
          name: { type: "string", required: false, desc: "Optional wallet name" }
        },
        response: `{ "success": true, "address": "0x...", "chain": "evm", "message": "Default wallet created" }`,
        examples: {
          curl: `curl -X POST https://api.suwappu.bot/webapp/wallets/default \\
  -H "X-Telegram-Init-Data: query_id=AAE..." \\
  -H "Content-Type: application/json" \\
  -d '{"chainType":"evm"}'`,
          python: `resp = requests.post("https://api.suwappu.bot/webapp/wallets/default",
    headers={"X-Telegram-Init-Data": "query_id=AAE..."},
    json={"chainType": "evm"})`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/webapp/wallets/default", {
  method: "POST",
  headers: { "X-Telegram-Init-Data": window.Telegram.WebApp.initData, "Content-Type": "application/json" },
  body: JSON.stringify({ chainType: "evm" })
});`
        }
      },
      {
        method: "DELETE", path: "/webapp/wallets/{address}", auth: "telegram",
        summary: "Unlink wallet",
        desc: "Deactivate (soft delete) a wallet.",
        params: { address: { type: "string", required: true, desc: "Wallet address to unlink" } },
        response: `{ "success": true }`,
        examples: {
          curl: `curl -X DELETE https://api.suwappu.bot/webapp/wallets/0x... \\
  -H "X-Telegram-Init-Data: query_id=AAE..."`,
          python: `resp = requests.delete("https://api.suwappu.bot/webapp/wallets/0x...",
    headers={"X-Telegram-Init-Data": "query_id=AAE..."})`,
          javascript: `await fetch("https://api.suwappu.bot/webapp/wallets/0x...", {
  method: "DELETE",
  headers: { "X-Telegram-Init-Data": window.Telegram.WebApp.initData }
});`
        }
      }
    ]
  },

  webhooks: {
    title: "Webhooks",
    desc: "Webhook endpoints for Telegram and WhatsApp integrations.",
    endpoints: [
      {
        method: "POST", path: "/telegram/webhook", auth: "webhook",
        summary: "Telegram webhook",
        desc: "Handle incoming Telegram updates. Authenticated via X-Telegram-Bot-Api-Secret-Token header.",
        response: `{ "status": "ok" }`,
        examples: {
          curl: `# Configured automatically by the bot via set_webhook()
# Not intended for direct calls`,
          python: `# Configured automatically by the bot`,
          javascript: `// Configured automatically by the bot`
        }
      },
      {
        method: "GET", path: "/webhook", auth: "none",
        summary: "WhatsApp webhook verification",
        desc: "Verify webhook subscription from Meta. Returns the challenge string on successful verification.",
        queryParams: {
          "hub.mode": { type: "string", required: true, desc: "subscribe" },
          "hub.verify_token": { type: "string", required: true, desc: "Verification token" },
          "hub.challenge": { type: "string", required: true, desc: "Challenge to return" }
        },
        response: `"challenge_string"`,
        examples: {
          curl: `# Called by Meta during webhook setup
curl "https://api.suwappu.bot/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE"`,
          python: `# Called automatically by Meta during webhook setup`,
          javascript: `// Called automatically by Meta during webhook setup`
        }
      },
      {
        method: "POST", path: "/webhook", auth: "none",
        summary: "WhatsApp incoming messages",
        desc: "Handle incoming WhatsApp messages. Rate limited to 30 requests per minute per sender.",
        response: `{ "status": "ok" }`,
        examples: {
          curl: `# Called by Meta when messages arrive
# Not intended for direct calls`,
          python: `# Called automatically by Meta`,
          javascript: `// Called automatically by Meta`
        }
      }
    ]
  },

  discovery: {
    title: "Discovery",
    desc: "Service discovery endpoints for health checks, AI plugins, and agent cards.",
    endpoints: [
      {
        method: "GET", path: "/health", auth: "none",
        summary: "Health check",
        desc: "Service health check for load balancers, monitoring, and orchestration.",
        response: `{
  "status": "healthy",
  "service": "suwappu-api",
  "database": "connected"
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/health`,
          python: `resp = requests.get("https://api.suwappu.bot/health")`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/health");`
        }
      },
      {
        method: "GET", path: "/.well-known/ai-plugin.json", auth: "none",
        summary: "AI plugin manifest",
        desc: "Standard OpenAI/ChatGPT plugin discovery manifest.",
        response: `{
  "schema_version": "v1",
  "name_for_human": "Suwappu",
  "name_for_model": "suwappu",
  "description_for_human": "Cross-chain DEX trading bot",
  "api": { "type": "openapi", "url": "/openapi.json" }
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/.well-known/ai-plugin.json`,
          python: `resp = requests.get("https://api.suwappu.bot/.well-known/ai-plugin.json")`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/.well-known/ai-plugin.json");`
        }
      },
      {
        method: "GET", path: "/agent-card.json", auth: "none",
        summary: "A2A Agent Card",
        desc: "Returns the A2A Agent Card for decentralized agent discovery.",
        response: `{
  "name": "Suwappu",
  "description": "Cross-chain liquidity infrastructure for AI agents",
  "url": "https://api.suwappu.bot",
  "capabilities": ["swap", "portfolio", "wallet"]
}`,
        examples: {
          curl: `curl https://api.suwappu.bot/agent-card.json`,
          python: `resp = requests.get("https://api.suwappu.bot/agent-card.json")`,
          javascript: `const resp = await fetch("https://api.suwappu.bot/agent-card.json");`
        }
      }
    ]
  }
};


// ---------- Rendering ----------

const AUTH_LABELS = {
  none: { text: "No Auth", cls: "none" },
  agent: { text: "X-Agent-Key", cls: "agent" },
  jwt: { text: "JWT Bearer", cls: "jwt" },
  admin: { text: "X-Admin-Key", cls: "admin" },
  telegram: { text: "Telegram initData", cls: "telegram" },
  webhook: { text: "Secret Token", cls: "webhook" }
};

function renderEndpointCard(ep, idx) {
  const authInfo = AUTH_LABELS[ep.auth] || AUTH_LABELS.none;
  const id = `ep-${ep.method}-${ep.path}`.replace(/[^a-zA-Z0-9]/g, '-');

  let paramsHTML = '';
  const allParams = { ...(ep.params || {}), ...(ep.queryParams || {}) };
  if (Object.keys(allParams).length) {
    paramsHTML = `<div class="sub-label">Parameters</div>
    <table class="params-table"><thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead><tbody>`;
    for (const [name, p] of Object.entries(allParams)) {
      paramsHTML += `<tr><td>${name} ${p.required ? '<span class="param-required">*</span>' : ''}</td>
        <td><span class="param-type">${p.type}</span></td><td>${p.desc}</td></tr>`;
    }
    paramsHTML += `</tbody></table>`;
  }

  let bodyHTML = '';
  if (ep.body) {
    bodyHTML = `<div class="sub-label">Request Body</div>
    <table class="params-table"><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>`;
    for (const [name, p] of Object.entries(ep.body)) {
      bodyHTML += `<tr><td>${name} ${p.required ? '<span class="param-required">*</span>' : ''}</td>
        <td><span class="param-type">${p.type}</span></td><td>${p.desc}</td></tr>`;
    }
    bodyHTML += `</tbody></table>`;
  }

  const tabId = `tabs-${id}-${idx}`;

  let examplesHTML = '';
  if (ep.examples) {
    examplesHTML = `
    <div class="sub-label">Code Examples</div>
    <div class="tabs" data-tabs="${tabId}">
      <button class="tab-btn active" data-tab="curl">cURL</button>
      <button class="tab-btn" data-tab="python">Python</button>
      <button class="tab-btn" data-tab="javascript">JavaScript</button>
    </div>
    <div class="tab-panel active" data-tabs="${tabId}" data-tab="curl">
      <div class="code-block"><pre>${escapeHtml(ep.examples.curl)}</pre><button class="code-copy" onclick="copyCode(this)">Copy</button></div>
    </div>
    <div class="tab-panel" data-tabs="${tabId}" data-tab="python">
      <div class="code-block"><pre>${escapeHtml(ep.examples.python)}</pre><button class="code-copy" onclick="copyCode(this)">Copy</button></div>
    </div>
    <div class="tab-panel" data-tabs="${tabId}" data-tab="javascript">
      <div class="code-block"><pre>${escapeHtml(ep.examples.javascript)}</pre><button class="code-copy" onclick="copyCode(this)">Copy</button></div>
    </div>`;
  }

  let responseHTML = '';
  if (ep.response) {
    responseHTML = `<div class="sub-label">Response</div>
    <div class="code-block"><pre>${escapeHtml(ep.response)}</pre><button class="code-copy" onclick="copyCode(this)">Copy</button></div>`;
  }

  // Try-it-out
  let tryItHTML = '';
  if (ep.auth === 'none' || ep.auth === 'agent' || ep.auth === 'jwt') {
    tryItHTML = `
    <div class="try-it" data-method="${ep.method}" data-path="${ep.path}" data-auth="${ep.auth}">
      <button class="try-it-toggle" onclick="toggleTryIt(this)">&#9654; Try it out</button>
      <div class="try-it-body">
        ${ep.auth !== 'none' ? `<div class="try-input-group">
          <label>${ep.auth === 'agent' ? 'X-Agent-Key' : 'Bearer Token'}</label>
          <input type="text" class="try-auth" placeholder="${ep.auth === 'agent' ? 'your-agent-key' : 'eyJhbGciOi...'}">
        </div>` : ''}
        ${ep.params ? Object.entries(ep.params).map(([n, p]) =>
          `<div class="try-input-group"><label>${n} ${p.required ? '*' : ''}</label><input type="text" class="try-param" data-name="${n}" placeholder="${p.type}"></div>`
        ).join('') : ''}
        ${ep.queryParams ? Object.entries(ep.queryParams).map(([n, p]) =>
          `<div class="try-input-group"><label>${n} ${p.required ? '*' : ''}</label><input type="text" class="try-query" data-name="${n}" placeholder="${p.type}"></div>`
        ).join('') : ''}
        ${ep.body ? `<div class="try-input-group"><label>Request Body (JSON)</label><textarea class="try-body" placeholder='${JSON.stringify(Object.fromEntries(Object.entries(ep.body).map(([k]) => [k, ""])), null, 2)}'></textarea></div>` : ''}
        <button class="try-send-btn" onclick="sendTryIt(this)">&#9654; Send Request</button>
        <div class="try-response"></div>
      </div>
    </div>`;
  }

  return `
  <div class="endpoint-card" data-search="${ep.method} ${ep.path} ${ep.summary || ''} ${ep.desc || ''}">
    <div class="endpoint-header" onclick="toggleEndpoint(this)">
      <span class="method-badge ${ep.method.toLowerCase()}">${ep.method}</span>
      <span class="endpoint-path">${ep.path}</span>
      <span class="endpoint-summary">${ep.summary || ''}</span>
      <span class="endpoint-chevron">&#9656;</span>
    </div>
    <div class="endpoint-body">
      <span class="auth-badge ${authInfo.cls}">${authInfo.text}</span>
      ${ep.desc ? `<div class="endpoint-desc">${ep.desc}</div>` : ''}
      ${paramsHTML}
      ${bodyHTML}
      ${responseHTML}
      ${examplesHTML}
      ${tryItHTML}
    </div>
  </div>`;
}

function renderSection(key, data) {
  let html = `<h1 class="section-title">${data.title}</h1>`;
  html += `<p class="section-desc">${data.desc}</p>`;

  if (data.diagrams) {
    for (const d of data.diagrams) {
      html += `<h3>${d.title}</h3><div class="sequence-diagram">${escapeHtml(d.content)}</div>`;
    }
  }

  for (let i = 0; i < data.endpoints.length; i++) {
    html += renderEndpointCard(data.endpoints[i], i);
  }
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
  const main = document.getElementById('main-content');

  // Render all sections
  for (const [key, data] of Object.entries(ENDPOINTS)) {
    const section = document.createElement('div');
    section.className = 'section';
    section.id = `section-${key}`;
    section.innerHTML = renderSection(key, data);
    main.appendChild(section);
  }

  // Setup sidebar links
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      const section = link.dataset.section;
      navigateTo(section);
      closeSidebar();
    });
  });

  // Setup hash routing
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1) || 'overview';
    navigateTo(hash);
  });

  // Initial route
  const initial = location.hash.slice(1) || 'overview';
  navigateTo(initial);

  // Setup tabs delegation
  main.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      const tabsId = e.target.parentElement.dataset.tabs;
      const tab = e.target.dataset.tab;
      document.querySelectorAll(`[data-tabs="${tabsId}"].tab-btn`).forEach(b => b.classList.remove('active'));
      document.querySelectorAll(`[data-tabs="${tabsId}"].tab-panel`).forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      document.querySelector(`.tab-panel[data-tabs="${tabsId}"][data-tab="${tab}"]`).classList.add('active');
    }
  });

  // Dark mode
  const saved = localStorage.getItem('suwappu-docs-theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('theme-toggle').textContent = '\u2600';
  }

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Search
  document.getElementById('search').addEventListener('input', handleSearch);

  // Mobile hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
});


// ---------- Navigation ----------

function navigateTo(section) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));

  const el = document.getElementById(`section-${section}`);
  if (el) {
    el.classList.add('active');
    location.hash = section;
  } else {
    document.getElementById('section-overview').classList.add('active');
    location.hash = 'overview';
  }

  const link = document.querySelector(`.sidebar-link[data-section="${section}"]`);
  if (link) link.classList.add('active');

  // Clear search
  document.getElementById('search').value = '';
  document.querySelectorAll('.endpoint-card').forEach(c => c.style.display = '');
  document.querySelectorAll('.no-results').forEach(n => n.remove());
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}


// ---------- Interactions ----------

function toggleEndpoint(header) {
  header.parentElement.classList.toggle('open');
}

function toggleTryIt(btn) {
  btn.parentElement.classList.toggle('open');
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const btn = document.getElementById('theme-toggle');
  if (current === 'dark') {
    html.removeAttribute('data-theme');
    localStorage.setItem('suwappu-docs-theme', 'light');
    btn.textContent = '\u263E';
  } else {
    html.setAttribute('data-theme', 'dark');
    localStorage.setItem('suwappu-docs-theme', 'dark');
    btn.textContent = '\u2600';
  }
}


// ---------- Search ----------

function handleSearch() {
  const query = document.getElementById('search').value.toLowerCase().trim();

  if (!query) {
    document.querySelectorAll('.endpoint-card').forEach(c => c.style.display = '');
    document.querySelectorAll('.no-results').forEach(n => n.remove());
    return;
  }

  // Show all sections
  document.querySelectorAll('.section').forEach(s => s.classList.add('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));

  let found = 0;
  document.querySelectorAll('.endpoint-card').forEach(card => {
    const text = card.dataset.search.toLowerCase();
    if (text.includes(query)) {
      card.style.display = '';
      found++;
    } else {
      card.style.display = 'none';
    }
  });

  // Hide sections with no visible cards
  document.querySelectorAll('.section').forEach(s => {
    if (s.id === 'section-overview') {
      s.classList.remove('active');
      return;
    }
    const visible = s.querySelectorAll('.endpoint-card:not([style*="display: none"])');
    if (visible.length === 0) {
      s.classList.remove('active');
    }
  });

  document.querySelectorAll('.no-results').forEach(n => n.remove());
  if (found === 0) {
    const msg = document.createElement('div');
    msg.className = 'no-results';
    msg.textContent = `No endpoints matching "${query}"`;
    document.getElementById('main-content').appendChild(msg);
  }
}


// ---------- Copy ----------

function copyCode(btn) {
  const pre = btn.previousElementSibling;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}


// ---------- Try-it-out ----------

async function sendTryIt(btn) {
  const container = btn.closest('.try-it');
  const method = container.dataset.method;
  let path = container.dataset.path;
  const auth = container.dataset.auth;
  const responseDiv = container.querySelector('.try-response');

  btn.disabled = true;
  btn.textContent = 'Sending...';
  responseDiv.innerHTML = '';

  // Build URL
  const baseUrl = location.origin;
  container.querySelectorAll('.try-param').forEach(input => {
    if (input.value) {
      path = path.replace(`{${input.dataset.name}}`, encodeURIComponent(input.value));
    }
  });

  const queryParts = [];
  container.querySelectorAll('.try-query').forEach(input => {
    if (input.value) queryParts.push(`${input.dataset.name}=${encodeURIComponent(input.value)}`);
  });

  let url = baseUrl + path;
  if (queryParts.length) url += '?' + queryParts.join('&');

  // Headers
  const headers = { 'Content-Type': 'application/json' };
  const authInput = container.querySelector('.try-auth');
  if (authInput && authInput.value) {
    if (auth === 'agent') headers['X-Agent-Key'] = authInput.value;
    else if (auth === 'jwt') headers['Authorization'] = `Bearer ${authInput.value}`;
  }

  // Body
  const opts = { method, headers };
  const bodyTextarea = container.querySelector('.try-body');
  if (bodyTextarea && bodyTextarea.value.trim()) {
    opts.body = bodyTextarea.value.trim();
  }

  try {
    const resp = await fetch(url, opts);
    const text = await resp.text();
    let formatted;
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      formatted = text;
    }

    responseDiv.innerHTML = `
      <div class="try-response-status ${resp.ok ? 'success' : 'error'}">${resp.status} ${resp.statusText}</div>
      <div class="code-block"><pre>${escapeHtml(formatted)}</pre><button class="code-copy" onclick="copyCode(this)">Copy</button></div>
    `;
  } catch (err) {
    responseDiv.innerHTML = `<div class="try-response-status error">Error: ${escapeHtml(err.message)}</div>`;
  }

  btn.disabled = false;
  btn.textContent = '\u25B6 Send Request';
}
