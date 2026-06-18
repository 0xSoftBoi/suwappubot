import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Turnkey Account/Passkey Auth',
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'suwappu',
      values: [
        { name: 'suwappu', value: '#FFFBFC' },
        { name: 'dark', value: '#1A1625' },
      ],
    },
  },
}

export default meta
type Story = StoryObj

// Biometric icon
function BiometricIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
    </svg>
  )
}

// Face ID icon
function FaceIdIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9h.01M15 9h.01M9 15c.83.67 2.17 1.33 3 1.33s2.17-.66 3-1.33M3.5 9V5.5A2 2 0 015.5 3.5H9M15 3.5h3.5a2 2 0 012 2V9M20.5 15v3.5a2 2 0 01-2 2H15M9 20.5H5.5a2 2 0 01-2-2V15" />
    </svg>
  )
}

// Touch ID icon
function TouchIdIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39-2.57 0-4.66 1.97-4.66 4.39 0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-1.59-.44-2.63-1.03-3.72-2.1-1.4-1.39-2.17-3.24-2.17-5.22 0-1.62 1.38-2.94 3.08-2.94 1.7 0 3.08 1.32 3.08 2.94 0 1.07.93 1.94 2.08 1.94s2.08-.87 2.08-1.94c0-3.77-3.25-6.83-7.25-6.83-2.84 0-5.44 1.58-6.61 4.03-.39.81-.59 1.76-.59 2.8 0 .78.07 2.01.67 3.61.1.26-.03.55-.29.64-.26.1-.55-.04-.64-.29-.49-1.31-.73-2.61-.73-3.96 0-1.2.23-2.29.68-3.24 1.33-2.79 4.28-4.6 7.51-4.6 4.55 0 8.25 3.51 8.25 7.83 0 1.62-1.38 2.94-3.08 2.94s-3.08-1.32-3.08-2.94c0-1.07-.93-1.94-2.08-1.94s-2.08.87-2.08 1.94c0 1.71.66 3.31 1.87 4.51.95.94 1.86 1.46 3.27 1.85.27.07.42.35.35.61-.05.23-.26.38-.47.38z" />
    </svg>
  )
}

export const CreatePasskeyButton: Story = {
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-suwappu-purple to-suwappu-magenta-mid text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
      <BiometricIcon className="w-6 h-6" />
      Create Secure Wallet
    </button>
  ),
}

export const LoginWithPasskey: Story = {
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-white text-suwappu-purple font-heading font-bold rounded-suwappu-pill shadow-suwappu-2 border border-suwappu-sakura-mid/30 transition-all duration-300 hover:bg-suwappu-sakura-light/30 hover:shadow-suwappu-3">
      <BiometricIcon className="w-6 h-6" />
      Login with Passkey
    </button>
  ),
}

export const BiometricOptions: Story = {
  render: () => (
    <div className="flex gap-4">
      <button className="flex flex-col items-center gap-2 p-6 bg-white rounded-suwappu-xxl shadow-suwappu-2 border border-suwappu-sakura-mid/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-suwappu-3 hover:border-suwappu-magenta-mid/50 w-32">
        <div className="w-14 h-14 bg-gradient-to-br from-suwappu-sakura-light to-suwappu-rose rounded-suwappu-xl flex items-center justify-center">
          <FaceIdIcon className="w-8 h-8 text-suwappu-purple-deep" />
        </div>
        <span className="font-heading font-semibold text-suwappu-text text-sm">Face ID</span>
      </button>

      <button className="flex flex-col items-center gap-2 p-6 bg-white rounded-suwappu-xxl shadow-suwappu-2 border border-suwappu-sakura-mid/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-suwappu-3 hover:border-suwappu-magenta-mid/50 w-32">
        <div className="w-14 h-14 bg-gradient-to-br from-suwappu-cyan to-suwappu-blue rounded-suwappu-xl flex items-center justify-center">
          <TouchIdIcon className="w-8 h-8 text-suwappu-navy" />
        </div>
        <span className="font-heading font-semibold text-suwappu-text text-sm">Touch ID</span>
      </button>
    </div>
  ),
}

export const PasskeyCard: Story = {
  render: () => (
    <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 max-w-md">
      <div className="text-center mb-6">
        <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-full flex items-center justify-center shadow-suwappu-glow">
          <BiometricIcon className="w-10 h-10 text-white" />
        </div>
        <h2 className="font-display text-2xl text-suwappu-magenta-mid mb-2">Create Secure Wallet</h2>
        <p className="font-body text-sm text-suwappu-text-secondary">
          Use Face ID or Touch ID to create a TEE-backed wallet with Turnkey
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3 p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
          <svg className="w-5 h-5 text-suwappu-success" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="font-body text-sm text-suwappu-text">No password to remember</span>
        </div>
        <div className="flex items-center gap-3 p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
          <svg className="w-5 h-5 text-suwappu-success" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="font-body text-sm text-suwappu-text">Hardware-level security</span>
        </div>
        <div className="flex items-center gap-3 p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
          <svg className="w-5 h-5 text-suwappu-success" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="font-body text-sm text-suwappu-text">Keys never leave your device</span>
        </div>
      </div>

      <button className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-suwappu-purple to-suwappu-magenta-mid text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        <BiometricIcon className="w-5 h-5" />
        Create Wallet
      </button>

      <p className="text-center text-xs text-suwappu-text-secondary mt-4">
        Powered by Turnkey TEE infrastructure
      </p>
    </div>
  ),
}

export const VerificationPrompt: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-glass backdrop-blur-md rounded-suwappu-xxxl shadow-suwappu-4 border border-suwappu-sakura-mid/30 max-w-sm text-center">
      <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-suwappu-sakura-light via-suwappu-rose to-suwappu-magenta-mid rounded-full flex items-center justify-center animate-pulse">
        <FaceIdIcon className="w-14 h-14 text-white" />
      </div>
      <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
        Verify Your Identity
      </h3>
      <p className="font-body text-sm text-suwappu-text-secondary mb-6">
        Please use Face ID or Touch ID to confirm
      </p>
      <div className="flex items-center justify-center gap-2 text-suwappu-magenta-mid">
        <div className="w-2 h-2 rounded-full bg-suwappu-magenta-mid animate-suwappu-bounce" style={{ animationDelay: '0s' }} />
        <div className="w-2 h-2 rounded-full bg-suwappu-magenta-mid animate-suwappu-bounce" style={{ animationDelay: '0.15s' }} />
        <div className="w-2 h-2 rounded-full bg-suwappu-magenta-mid animate-suwappu-bounce" style={{ animationDelay: '0.3s' }} />
      </div>
    </div>
  ),
}

export const SuccessState: Story = {
  render: () => (
    <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-success/30 max-w-sm text-center">
      <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-suwappu-success to-green-400 rounded-full flex items-center justify-center animate-suwappu-heart">
        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
        Wallet Created!
      </h3>
      <p className="font-body text-sm text-suwappu-text-secondary mb-4">
        Your secure wallet is ready to use
      </p>
      <div className="p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg mb-4">
        <code className="font-mono text-sm text-suwappu-purple-deep">0x7a3b...9f2e</code>
      </div>
      <button className="w-full px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        Continue
      </button>
    </div>
  ),
}

export const NotSupportedMessage: Story = {
  render: () => (
    <div className="p-6 bg-suwappu-warning/20 border border-suwappu-warning/40 rounded-suwappu-xxl max-w-sm">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h4 className="font-heading font-bold text-orange-800 mb-1">Passkeys Not Supported</h4>
          <p className="font-body text-sm text-orange-700">
            Your browser doesn't support passkeys. Try using Safari on iOS or Chrome on Android.
          </p>
        </div>
      </div>
    </div>
  ),
}

export const PasskeyLoginFlow: Story = {
  render: () => {
    const [step, setStep] = useState<'idle' | 'verifying' | 'success'>('idle')

    const handleLogin = () => {
      setStep('verifying')
      setTimeout(() => setStep('success'), 2000)
    }

    if (step === 'verifying') {
      return (
        <div className="p-8 bg-suwappu-glass backdrop-blur-md rounded-suwappu-xxxl shadow-suwappu-4 border border-suwappu-sakura-mid/30 max-w-sm text-center">
          <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-suwappu-sakura-light via-suwappu-rose to-suwappu-magenta-mid rounded-full flex items-center justify-center animate-pulse">
            <BiometricIcon className="w-14 h-14 text-white" />
          </div>
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
            Authenticating...
          </h3>
          <p className="font-body text-sm text-suwappu-text-secondary">
            Please verify with your biometrics
          </p>
        </div>
      )
    }

    if (step === 'success') {
      return (
        <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-success/30 max-w-sm text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-suwappu-success to-green-400 rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
            Welcome Back!
          </h3>
          <p className="font-body text-sm text-suwappu-text-secondary">
            Successfully authenticated
          </p>
        </div>
      )
    }

    return (
      <div className="p-8 bg-white rounded-suwappu-xxxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 max-w-sm text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-suwappu-xxl flex items-center justify-center">
          <BiometricIcon className="w-8 h-8 text-white" />
        </div>
        <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
          Welcome to Suwappu
        </h3>
        <p className="font-body text-sm text-suwappu-text-secondary mb-6">
          Use your passkey to sign in
        </p>
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover"
        >
          <BiometricIcon className="w-5 h-5" />
          Login with Passkey
        </button>
      </div>
    )
  },
}
