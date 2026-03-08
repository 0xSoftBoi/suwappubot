"use client";

import React, { useState } from 'react';
import { X, Wallet, Loader2, Fingerprint, Key } from 'lucide-react';

interface CreateWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (chainType: 'evm' | 'solana', name: string) => Promise<void>;
  onCreatePasskey: (chainType: 'evm' | 'solana', name: string) => Promise<void>;
  hasPasskey?: boolean;
}

export function CreateWalletModal({
  isOpen,
  onClose,
  onCreateLocal,
  onCreatePasskey,
  hasPasskey = false,
}: CreateWalletModalProps) {
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [walletType, setWalletType] = useState<'local' | 'passkey'>('local');
  const [chainType, setChainType] = useState<'evm' | 'solana'>('evm');
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Please enter a wallet name');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      if (walletType === 'passkey') {
        await onCreatePasskey(chainType, name.trim());
      } else {
        await onCreateLocal(chainType, name.trim());
      }
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create wallet');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setStep('type');
    setWalletType('local');
    setChainType('evm');
    setName('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-[#12141A] rounded-2xl border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold">Create Wallet</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'type' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-6">
                Choose how you want to secure your new wallet
              </p>

              {/* Wallet type options */}
              <button
                onClick={() => {
                  setWalletType('local');
                  setStep('details');
                }}
                className="w-full p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center flex-shrink-0">
                    <Key size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Standard Wallet</h3>
                    <p className="text-sm text-gray-400">
                      Encrypted private key stored securely. Best for programmatic access.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setWalletType('passkey');
                  setStep('details');
                }}
                className="w-full p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center flex-shrink-0">
                    <Fingerprint size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Passkey Wallet</h3>
                    <p className="text-sm text-gray-400">
                      Secured by Face ID, Touch ID, or Windows Hello. Maximum security.
                    </p>
                    {!hasPasskey && (
                      <p className="text-xs text-yellow-400 mt-2">
                        Requires passkey authentication
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </div>
          )}

          {step === 'details' && (
            <div className="space-y-6">
              {/* Back button */}
              <button
                onClick={() => setStep('type')}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                ← Back to wallet type
              </button>

              {/* Chain selection */}
              <div>
                <label className="block text-sm font-medium mb-3">
                  Select Chain
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setChainType('evm')}
                    className={`p-4 rounded-xl border transition-all duration-200 ${
                      chainType === 'evm'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-2xl mb-2">⟠</div>
                    <div className="font-medium">EVM</div>
                    <div className="text-xs text-gray-400">
                      ETH, Polygon, Base...
                    </div>
                  </button>
                  <button
                    onClick={() => setChainType('solana')}
                    className={`p-4 rounded-xl border transition-all duration-200 ${
                      chainType === 'solana'
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-2xl mb-2">◎</div>
                    <div className="font-medium">Solana</div>
                    <div className="text-xs text-gray-400">
                      SOL, SPL tokens
                    </div>
                  </button>
                </div>
              </div>

              {/* Wallet name */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Wallet Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`My ${chainType === 'evm' ? 'EVM' : 'Solana'} Wallet`}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Create button */}
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Wallet size={20} />
                    Create {walletType === 'passkey' ? 'Passkey' : ''} Wallet
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
