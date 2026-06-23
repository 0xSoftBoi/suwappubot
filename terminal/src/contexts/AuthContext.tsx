import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WagmiProvider, useAccount, useSignMessage, useDisconnect } from 'wagmi'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import bs58 from 'bs58'
import { config as wagmiConfig } from '../lib/wagmi'
import { setAuthToken, getAuthToken, clearAuthToken, setAuthMethod } from '../lib/auth'
import { getPhantom, isPhantomAvailable } from '../lib/phantom'
import { api } from '../lib/api'
import {
  isExternalProvider,
  isLedgerConnectorId,
  resolveWalletProviderTag,
} from '../lib/walletProvider'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  userId: number | null
  walletAddress: string | null
  error: string | null
  signIn: () => Promise<void>
  signInWithGoogle: () => void
  // Non-custodial: connect an external wallet (MetaMask / WalletConnect) and
  // prove ownership by signing a SIWE challenge. Opens the connect modal first
  // if no wallet is connected yet.
  signInWithWallet: () => Promise<void>
  // Non-custodial Solana: connect Phantom and prove ownership via SIWS (ed25519).
  signInWithPhantom: () => Promise<void>
  isPhantomAvailable: boolean
  signOut: () => void
  clearError: () => void
  isPasskeySupported: boolean
  isTelegram: boolean
  // The connected external wallet address (wagmi), or null. Distinct from
  // walletAddress, which is the authenticated session's wallet.
  connectedAddress: string | null
  isExternalWallet: boolean
  // True when the external session is a Ledger hardware wallet (subset of external).
  isHardwareWallet: boolean
  // 'evm' | 'solana' | null — which chain the external session's wallet signs on.
  externalChain: 'evm' | 'solana' | null
  // True while a wallet-connect SIWE round-trip (connect → sign → verify) is in
  // flight, so the Header can show a dedicated "Signing…" state on that button.
  isWalletConnecting: boolean
  // Whether the wallet-connect SIWE backend is reachable. Flips to false the
  // first time /auth/turnkey/* answers 404/501/503 so the Header can honestly
  // disable the button with a tooltip instead of letting it silently fail.
  isWalletAuthAvailable: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const PASSKEY_CREDENTIAL_KEY = 'suwappu_passkey_credential_id'
const PASSKEY_USER_HANDLE_KEY = 'suwappu_passkey_user_handle'

// Public provider. wagmi + RainbowKit are mounted HERE (rather than in
// main.tsx) to keep the wallet-connect feature self-contained inside the auth
// module: AuthInner can then call wagmi hooks. The QueryClient that wagmi needs
// is already supplied by the QueryClientProvider above us in main.tsx.
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider>
        <AuthInner>{children}</AuthInner>
      </RainbowKitProvider>
    </WagmiProvider>
  )
}

function AuthInner({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletProvider, setWalletProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPasskeySupported, setIsPasskeySupported] = useState(false)
  const [isTelegram, setIsTelegram] = useState(false)
  const [isWalletConnecting, setIsWalletConnecting] = useState(false)
  const [isWalletAuthAvailable, setIsWalletAuthAvailable] = useState(true)
  const queryClient = useQueryClient()
  const { address: connectedAddress, isConnected, connector } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnectAsync } = useDisconnect()
  const { openConnectModal } = useConnectModal()

  // Data hooks (portfolio, wallet tracker, etc.) fire on mount — before the user
  // signs in — and 401, landing in React Query's error state. Nothing refetches
  // them on its own, so panels stayed stuck on "request failed" after sign-in.
  // Invalidate every query the moment auth succeeds so they refetch with the
  // bearer token; on sign-out, drop the now-unauthorized cached data.
  useEffect(() => {
    void queryClient.invalidateQueries()
  }, [isAuthenticated, queryClient])

  const toBase64Url = (buffer: BufferSource): string => {
    const bytes =
      buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const credentialChallenge = (value: string): Uint8Array<ArrayBuffer> => {
    const encoded = new TextEncoder().encode(value)
    const buffer = new ArrayBuffer(encoded.byteLength)
    const bytes = new Uint8Array(buffer)
    bytes.set(encoded)
    return bytes
  }

  const rpIdForCurrentHost = (): string => {
    if (typeof window === 'undefined') return 'suwappu.bot'
    const host = window.location.hostname
    if (host === 'suwappu.bot' || host.endsWith('.suwappu.bot')) return 'suwappu.bot'
    return host
  }

  // Check existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      setIsPasskeySupported(
        typeof window !== 'undefined' &&
        !!window.PublicKeyCredential &&
        window.isSecureContext,
      )

      // Telegram Mini App: when launched inside Telegram, window.Telegram.WebApp
      // exposes signed initData. Exchange it for a session JWT silently — no
      // passkey/OAuth prompt. This runs BEFORE the passkey/cookie resume below.
      const tgInitData =
        typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : undefined
      if (tgInitData) {
        try {
          window.Telegram?.WebApp?.ready()
          window.Telegram?.WebApp?.expand()
        } catch {
          // SDK methods are best-effort; ignore if unavailable.
        }
        try {
          const result = await api.telegramAuth(tgInitData)
          setAuthToken(result.token, result.expiresAt)
          setUserId(result.userId)
          setWalletAddress(result.walletAddress)
          setIsAuthenticated(true)
          setIsTelegram(true)
          setIsLoading(false)
          return
        } catch (err: unknown) {
          // Fall through to the standard passkey/cookie flow if Telegram auth fails.
          setError(errorDetail(err))
        }
      }

      // OAuth sessions live in an httponly cookie (invisible to document.cookie),
      // so the only authority on whether a session exists is the server. Always
      // attempt getMe() on mount: it sends the cookie via credentials:'include'
      // (OAuth) and the Bearer token if present (passkey). This is what makes a
      // cookie-only OAuth session resume across reloads.
      const token = getAuthToken()
      const returningFromOAuth =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('auth') === 'success'

      // OAuthCallback bounces failed sign-ins back with ?auth_error=<reason>.
      const authError =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('auth_error')
          : null
      if (authError) {
        setError(`Sign-in failed: ${authError.replace(/_/g, ' ')}`)
        const url = new URL(window.location.href)
        url.searchParams.delete('auth_error')
        window.history.replaceState({}, '', url.toString())
      }

      try {
        const me = await api.getMe()
        setUserId(me.userId)
        setWalletAddress(me.walletAddress)
        setWalletProvider(me.walletProvider)
        setIsAuthenticated(true)
      } catch {
        if (token) clearAuthToken()
      } finally {
        // Strip the one-time ?auth=success&provider=… params after handling.
        if (returningFromOAuth && typeof window !== 'undefined') {
          const url = new URL(window.location.href)
          url.searchParams.delete('auth')
          url.searchParams.delete('provider')
          window.history.replaceState({}, '', url.toString())
        }
        setIsLoading(false)
      }
    }
    checkSession()
  }, [])

  const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  const userHandleFromCredential = (value: ArrayBuffer | null): string | undefined => {
    if (!value) return undefined
    return toBase64Url(value)
  }

  const rememberPasskey = (credentialId: string, userHandle?: string) => {
    try {
      localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId)
      if (userHandle) localStorage.setItem(PASSKEY_USER_HANDLE_KEY, userHandle)
    } catch {
      // Non-critical: discoverable passkeys can still reconnect without this hint.
    }
  }

  const rememberedCredential = (): PublicKeyCredentialDescriptor[] | undefined => {
    try {
      const credentialId = localStorage.getItem(PASSKEY_CREDENTIAL_KEY)
      if (!credentialId) return undefined
      return [{ id: fromBase64Url(credentialId), type: 'public-key' }]
    } catch {
      return undefined
    }
  }

  const hasRememberedCredential = (): boolean => {
    try {
      return !!localStorage.getItem(PASSKEY_CREDENTIAL_KEY)
    } catch {
      return false
    }
  }

  const errorDetail = (err: unknown): string => {
    if (err instanceof Error) return err.message
    if (err && typeof err === 'object' && 'detail' in err) {
      return String((err as { detail?: unknown }).detail || 'Sign-in failed')
    }
    return String(err || 'Sign-in failed')
  }

  const errorStatus = (err: unknown): number | undefined => {
    if (err && typeof err === 'object' && 'status' in err) {
      const status = Number((err as { status?: unknown }).status)
      return Number.isFinite(status) ? status : undefined
    }
    return undefined
  }

  const authenticateWithPasskey = useCallback(async () => {
    const init = await api.passkeyAuthenticateInit()
    const allowCredentials = init.allowCredentials?.map((credential) => ({
      id: fromBase64Url(credential.id),
      type: 'public-key' as const,
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })) || rememberedCredential()

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: credentialChallenge(init.challenge),
        rpId: rpIdForCurrentHost(),
        allowCredentials: allowCredentials?.length ? allowCredentials : undefined,
        userVerification: 'preferred',
        timeout: 15000,
      },
    })

    if (!credential || credential.type !== 'public-key') {
      throw new Error('Passkey authentication was cancelled')
    }

    const publicKeyCredential = credential as PublicKeyCredential
    const response = publicKeyCredential.response as AuthenticatorAssertionResponse
    const credentialId = toBase64Url(publicKeyCredential.rawId)
    const userHandle = userHandleFromCredential(response.userHandle)
    rememberPasskey(credentialId, userHandle)
    return api.passkeyAuthenticateComplete({
      credentialId,
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      userHandle,
    })
  }, [])

  const createPasskeyWallet = useCallback(async () => {
    const init = await api.passkeyRegisterInit('Suwappu Terminal')
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: credentialChallenge(init.challenge),
        rp: {
          id: rpIdForCurrentHost(),
          name: init.rpName || 'Suwappu',
        },
        user: {
          id: credentialChallenge(init.userId),
          name: init.userName || 'terminal@suwappu.bot',
          displayName: 'Suwappu Terminal',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'preferred',
        },
        attestation: 'none',
      },
    })

    if (!credential || credential.type !== 'public-key') {
      throw new Error('Passkey creation was cancelled')
    }

    const publicKeyCredential = credential as PublicKeyCredential
    const response = publicKeyCredential.response as AuthenticatorAttestationResponse
    const transports = typeof response.getTransports === 'function' ? response.getTransports() : []
    const credentialId = toBase64Url(publicKeyCredential.rawId)
    const userHandle = toBase64Url(credentialChallenge(init.userId))
    rememberPasskey(credentialId, userHandle)
    return api.passkeyRegisterComplete({
      credentialId,
      attestationObject: toBase64Url(response.attestationObject),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      userHandle,
      transports,
    })
  }, [])

  // Connect an existing passkey first; create a Turnkey wallet if none exists.
  const signIn = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.credentials ||
      typeof window === 'undefined' ||
      !window.PublicKeyCredential
    ) {
      setError('Passkeys are not supported in this browser')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      let result
      if (hasRememberedCredential()) {
        try {
          result = await authenticateWithPasskey()
        } catch (authErr: unknown) {
          const authMessage = errorDetail(authErr)
          const status = errorStatus(authErr)
          if (status === 401 || /cancel|notallowed|no matching passkey/i.test(authMessage)) {
            result = await createPasskeyWallet()
          } else {
            throw authErr
          }
        }
      } else {
        result = await createPasskeyWallet()
      }

      setAuthToken(result.token, result.expiresAt)
      setUserId(result.userId)
      setWalletAddress(result.walletAddress)
      setIsAuthenticated(true)
    } catch (err: unknown) {
      setError(errorDetail(err))
    } finally {
      setIsLoading(false)
    }
  }, [authenticateWithPasskey, createPasskeyWallet])

  // One-tap social login: hand off to the backend OAuth start endpoint, which
  // 302-redirects to Google. After consent, the provider returns to the
  // terminal's /auth/callback/google route (see OAuthCallback), which forwards
  // code+state to the backend; the backend sets the httponly session cookie and
  // redirects back here with ?auth=success, picked up by the mount effect.
  const signInWithGoogle = useCallback(() => {
    if (typeof window === 'undefined') return
    setError(null)
    // Return the user to the page they started from (origin + path), minus any
    // stale query string. Must be on the oauth_redirect_base allowlist.
    const returnUrl = `${window.location.origin}${window.location.pathname}`
    window.location.assign(api.oauthStartUrl('google', returnUrl))
  }, [])

  // Sign-In With Ethereum (SIWE) round-trip against the existing
  // /auth/turnkey/challenge + /auth/turnkey/verify pair: fetch a nonce-bound
  // message, sign it with the connected wallet, exchange the signature for a
  // session JWT. Returns true on success. Honest about backend availability:
  // a 404/501/503 from either endpoint flips isWalletAuthAvailable off so the
  // UI stops offering a path the server can't honour.
  const runWalletSiwe = useCallback(
    async (address: string): Promise<boolean> => {
      try {
        const { message, nonce } = await api.walletChallenge(address)
        // The wallet prompt is the one step that can legitimately be cancelled
        // by the user; everything else is server I/O.
        const signature = await signMessageAsync({ message })
        // Tag hardware-wallet sessions so the backend records "ledger" and the UI
        // can badge it. Still an external (client-signing) provider — see
        // isExternalProvider.
        const providerTag = resolveWalletProviderTag(connector?.id)
        const result = await api.walletVerify(address, signature, nonce, providerTag)
        setAuthToken(result.token, result.expiresAt)
        setAuthMethod('wallet')
        setUserId(result.userId)
        setWalletAddress(address)
        setWalletProvider(providerTag)
        setIsAuthenticated(true)
        return true
      } catch (err: unknown) {
        const status = errorStatus(err)
        if (status === 404 || status === 501 || status === 503) {
          setIsWalletAuthAvailable(false)
          setError('Wallet sign-in is not available on this server yet.')
        } else if (/reject|denied|cancel|user rejected/i.test(errorDetail(err))) {
          setError('Signature request was cancelled.')
        } else {
          setError(errorDetail(err))
        }
        return false
      }
    },
    [signMessageAsync, connector],
  )

  // Set when the user clicks "Connect wallet" while no wallet is connected: we
  // open RainbowKit's modal and let the effect below resume the SIWE step once
  // wagmi reports a connected account (the modal itself returns no address).
  const pendingWalletSignIn = useRef(false)

  const signInWithWallet = useCallback(async () => {
    if (!isWalletAuthAvailable) {
      setError('Wallet sign-in is not available on this server yet.')
      return
    }
    setError(null)
    // Already connected (e.g. session expired but wallet still linked): go
    // straight to the SIWE signature. Otherwise open the connect modal and
    // defer signing to the post-connect effect.
    if (isConnected && connectedAddress) {
      setIsWalletConnecting(true)
      await runWalletSiwe(connectedAddress)
      setIsWalletConnecting(false)
      return
    }
    if (!openConnectModal) {
      setError("Couldn't open the wallet picker — refresh and try again.")
      return
    }
    pendingWalletSignIn.current = true
    setIsWalletConnecting(true)
    openConnectModal()
  }, [isWalletAuthAvailable, isConnected, connectedAddress, openConnectModal, runWalletSiwe])

  // Resume SIWE after the user picks a wallet in the RainbowKit modal. Guarded
  // by the pending ref so a wallet connected for other reasons never triggers a
  // surprise signature prompt.
  useEffect(() => {
    if (!pendingWalletSignIn.current) return
    if (!isConnected || !connectedAddress) return
    pendingWalletSignIn.current = false
    void (async () => {
      await runWalletSiwe(connectedAddress)
      setIsWalletConnecting(false)
    })()
  }, [isConnected, connectedAddress, runWalletSiwe])

  // Connect Phantom and authenticate via Sign-In-With-Solana (ed25519). Same
  // keyless model as the EVM path: the backend recovers nothing — it verifies the
  // signature against the provided pubkey and mints the session JWT.
  const signInWithPhantom = useCallback(async () => {
    const provider = getPhantom()
    if (!provider) {
      setError('Phantom wallet not found. Install the Phantom extension.')
      return
    }
    try {
      setIsLoading(true)
      setError(null)
      const { publicKey } = await provider.connect()
      const address = publicKey.toString()
      const { nonce, message } = await api.solanaChallenge(address)
      const { signature } = await provider.signMessage(new TextEncoder().encode(message), 'utf8')
      const result = await api.solanaVerify(address, bs58.encode(signature), nonce)
      setAuthToken(result.token, result.expiresAt)
      setAuthMethod('wallet')
      setUserId(result.userId)
      setWalletAddress(address)
      setWalletProvider('external')
      setIsAuthenticated(true)
    } catch (err: unknown) {
      setError(errorDetail(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(() => {
    clearAuthToken()
    setIsAuthenticated(false)
    setUserId(null)
    setWalletAddress(null)
    setWalletProvider(null)
    pendingWalletSignIn.current = false
    setIsWalletConnecting(false)
    // Tear down the live wagmi connection so a fresh sign-in re-prompts the
    // wallet picker rather than silently reusing the previous account.
    if (isConnected) void disconnectAsync().catch(() => {})
    // Drop the Phantom (Solana) connection too, so "sign out" fully resets state.
    try {
      void getPhantom()?.disconnect()
    } catch {
      // best-effort; Phantom may not be connected
    }
  }, [isConnected, disconnectAsync])

  const clearError = useCallback(() => setError(null), [])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        userId,
        walletAddress,
        error,
        signIn,
        signInWithGoogle,
        signInWithWallet,
        signInWithPhantom,
        isPhantomAvailable: isPhantomAvailable(),
        signOut,
        clearError,
        isPasskeySupported,
        isTelegram,
        connectedAddress: connectedAddress ?? null,
        // Session-based: a non-custodial session always routes through the
        // client-signing swap path. If the wallet isn't currently connected, that
        // path prompts a reconnect rather than falling back to custodial signing.
        isExternalWallet: isExternalProvider(walletProvider),
        // True for Ledger (and future hardware-wallet) sessions — lets the UI badge
        // the connection and show "confirm on device" copy. Reflects the live
        // connector (so it's true while signing, before auth completes) and the
        // authed provider (so it survives session resume). Subset of external.
        isHardwareWallet: isLedgerConnectorId(connector?.id) || walletProvider === 'ledger',
        // Derive the external session's chain from its address shape: EVM is
        // 0x-hex, Solana is base58. Drives which signing hook the swap panel uses.
        externalChain:
          isExternalProvider(walletProvider) && walletAddress
            ? walletAddress.startsWith('0x')
              ? 'evm'
              : 'solana'
            : null,
        isWalletConnecting,
        isWalletAuthAvailable,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
