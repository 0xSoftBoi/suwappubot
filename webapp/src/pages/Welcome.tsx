import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { BiometricIcon, FaceIdIcon } from '../components/icons'

type AuthStep = 'welcome' | 'create' | 'login' | 'verifying' | 'success'

export function Welcome() {
  const [step, setStep] = useState<AuthStep>('welcome')
  const navigate = useNavigate()
  const { createPasskeyWallet, loginWithPasskey, isLoading, error, clearError } = useAuth()

  const handleCreateWallet = async () => {
    setStep('verifying')
    clearError()
    const success = await createPasskeyWallet()
    if (success) {
      setStep('success')
      navigate('/home')
    } else {
      setStep('create')
    }
  }

  const handleLogin = async () => {
    setStep('verifying')
    clearError()
    const success = await loginWithPasskey()
    if (success) {
      setStep('success')
      navigate('/home')
    } else {
      setStep('login')
    }
  }

  if (step === 'verifying') {
    return (
      <div className="min-h-screen bg-suwappu-bg flex items-center justify-center p-4">
        <div className="p-8 bg-white/70 backdrop-blur-md rounded-suwappu-xxxl shadow-suwappu-4 border border-suwappu-sakura-mid/30 max-w-sm text-center">
          <div className="w-24 h-24 mx-auto mb-6 bg-linear-to-br from-suwappu-sakura-light via-suwappu-rose to-suwappu-magenta-mid rounded-full flex items-center justify-center animate-pulse">
            <FaceIdIcon className="w-14 h-14 text-white" />
          </div>
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
            Authenticating...
          </h3>
          <p className="font-body text-sm text-suwappu-text-secondary">
            Please verify with your biometrics
          </p>
        </div>
      </div>
    )
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-suwappu-bg flex items-center justify-center p-4">
        <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-success/30 max-w-sm text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-linear-to-br from-suwappu-success to-green-400 rounded-full flex items-center justify-center animate-suwappu-heart">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
            Success!
          </h3>
          <p className="font-body text-sm text-suwappu-text-secondary">
            Redirecting to your dashboard...
          </p>
        </div>
      </div>
    )
  }

  if (step === 'create') {
    return (
      <div className="min-h-screen bg-suwappu-bg flex items-center justify-center p-4">
        <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 max-w-md">
          <button
            onClick={() => setStep('welcome')}
            className="mb-4 p-1.5 text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="text-center mb-6">
            <div className="w-20 h-20 mx-auto mb-4 bg-linear-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-full flex items-center justify-center shadow-suwappu-glow">
              <BiometricIcon className="w-10 h-10 text-white" />
            </div>
            <h2 className="font-display text-2xl text-suwappu-magenta-mid mb-2">Create Secure Wallet</h2>
            <p className="font-body text-sm text-suwappu-text-secondary">
              Use Face ID or Touch ID to create a TEE-backed wallet with Turnkey
            </p>
          </div>

          <div className="space-y-3 mb-6">
            {[
              'No password to remember',
              'Hardware-level security',
              'Keys never leave your device',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3 p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
                <svg className="w-5 h-5 text-suwappu-success" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="font-body text-sm text-suwappu-text">{feature}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleCreateWallet}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover disabled:opacity-50"
          >
            <BiometricIcon className="w-5 h-5" />
            Create Wallet
          </button>

          {error && (
            <p className="text-center text-sm text-red-500 mt-3">{error}</p>
          )}

          <p className="text-center text-xs text-suwappu-text-secondary mt-4">
            Powered by Turnkey TEE infrastructure
          </p>
        </div>
      </div>
    )
  }

  if (step === 'login') {
    return (
      <div className="min-h-screen bg-suwappu-bg flex items-center justify-center p-4">
        <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 max-w-sm text-center">
          <button
            onClick={() => setStep('welcome')}
            className="absolute top-4 left-4 p-1.5 text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="w-16 h-16 mx-auto mb-4 bg-linear-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-suwappu-xxl flex items-center justify-center">
            <BiometricIcon className="w-8 h-8 text-white" />
          </div>
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
            Welcome Back
          </h3>
          <p className="font-body text-sm text-suwappu-text-secondary mb-6">
            Use your passkey to sign in
          </p>
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover disabled:opacity-50"
          >
            <BiometricIcon className="w-5 h-5" />
            Login with Passkey
          </button>

          {error && (
            <p className="text-center text-sm text-red-500 mt-3">{error}</p>
          )}

          <button
            onClick={() => setStep('welcome')}
            className="mt-4 text-sm text-suwappu-text-secondary hover:text-suwappu-magenta-mid"
          >
            Back to options
          </button>
        </div>
      </div>
    )
  }

  // Welcome screen
  return (
    <div className="min-h-screen bg-suwappu-bg flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-24 h-24 mb-6 bg-suwappu-gradient rounded-full flex items-center justify-center shadow-suwappu-glow">
          <span className="text-white text-4xl font-bold">S</span>
        </div>

        <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Suwappu</h1>
        <p className="text-suwappu-text-secondary text-center mb-8 max-w-xs">
          Cross-chain swaps made simple. Trade tokens across 7+ chains instantly.
        </p>

        <div className="w-full max-w-sm space-y-3">
          <button
            onClick={() => setStep('create')}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover"
          >
            <BiometricIcon className="w-5 h-5" />
            Create Wallet
          </button>

          <button
            onClick={() => setStep('login')}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white text-suwappu-purple font-heading font-bold rounded-suwappu-pill shadow-suwappu-2 border border-suwappu-sakura-mid/30 transition-all duration-300 hover:bg-suwappu-sakura-light/30"
          >
            <BiometricIcon className="w-5 h-5" />
            Login with Passkey
          </button>
        </div>
      </div>

      <div className="p-4 text-center">
        <p className="text-[10px] text-suwappu-text-secondary">
          By connecting, you agree to our Terms of Service
        </p>
      </div>
    </div>
  )
}
