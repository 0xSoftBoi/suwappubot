"use client";

import React from 'react';
import { Save, CheckCircle, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Input } from '@/components/ui/Input';
import { usePreferences } from '@/hooks/usePreferences';
import { useAuth } from '@/contexts/AuthContext';
import { clsx } from 'clsx';

const slippagePresets = [0.5, 1, 3];

export function SettingsTab() {
  const { preferences, setPreferences, save, isSaving, isDirty, error, saveSuccess } = usePreferences();
  const { wallets } = useAuth();

  const activeSlippage = slippagePresets.includes(preferences.slippage) ? preferences.slippage : 'custom';

  return (
    <div className="max-w-2xl space-y-6">
      {/* Slippage Tolerance */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle>Slippage Tolerance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400 mb-4">
            Maximum price difference you&apos;re willing to accept during a swap.
          </p>
          <div className="flex flex-wrap gap-2">
            {slippagePresets.map((pct) => (
              <button
                key={pct}
                onClick={() => setPreferences({ slippage: pct, customSlippage: '' })}
                className={clsx(
                  'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                  activeSlippage === pct
                    ? 'bg-system-blue/10 text-system-blue border border-system-blue/20'
                    : 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10'
                )}
              >
                {pct}%
              </button>
            ))}
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Custom"
                value={preferences.customSlippage}
                onChange={(e) => {
                  const val = e.target.value;
                  setPreferences({
                    customSlippage: val,
                    slippage: val ? parseFloat(val) : 1,
                  });
                }}
                className={clsx(
                  'w-24 px-3 py-2 rounded-xl text-sm bg-white/5 border text-white placeholder:text-gray-500 focus:outline-none focus:border-system-blue/50',
                  activeSlippage === 'custom' ? 'border-system-blue/20' : 'border-white/10'
                )}
                min="0.1"
                max="50"
                step="0.1"
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <Toggle
            checked={preferences.notifications}
            onChange={(v) => setPreferences({ notifications: v })}
            label="Enable Notifications"
            description="Receive alerts for swap completions, price changes, and order fills."
          />
        </CardContent>
      </Card>

      {/* Two-Factor Authentication */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={preferences.twoFactorEnabled}
            onChange={(v) => setPreferences({ twoFactorEnabled: v })}
            label="Two-Factor Confirmation"
            description="Require additional confirmation for swaps above the threshold."
          />
          {preferences.twoFactorEnabled && (
            <div className="ml-0 sm:ml-4 pt-2">
              <Input
                label="Threshold Amount (USD)"
                type="number"
                value={preferences.twoFactorThreshold}
                onChange={(e) => setPreferences({ twoFactorThreshold: e.target.value })}
                placeholder="1000"
                inputSize="sm"
                helperText="Swaps above this value will require 2FA confirmation."
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Wallets */}
      <Card variant="elevated">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Linked Wallets</CardTitle>
          <a
            href="/wallets"
            className="text-sm text-system-blue hover:text-system-blue/80 flex items-center gap-1 transition-colors"
          >
            Manage <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </CardHeader>
        <CardContent>
          {wallets.length === 0 ? (
            <p className="text-sm text-gray-400">No wallets linked yet.</p>
          ) : (
            <div className="space-y-2">
              {wallets.map((wallet) => (
                <div
                  key={wallet.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                      {wallet.chainType === 'evm' ? 'EV' : 'SO'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{wallet.name}</p>
                      <p className="text-xs text-gray-400 font-mono">
                        {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {wallet.isDefault && (
                      <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-system-green/10 text-system-green">
                        Default
                      </span>
                    )}
                    <span className="text-xs text-gray-400 uppercase">{wallet.chainType}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          isLoading={isSaving}
          disabled={!isDirty}
          leftIcon={saveSuccess ? <CheckCircle size={18} /> : <Save size={18} />}
          variant={saveSuccess ? 'success' : 'primary'}
        >
          {saveSuccess ? 'Saved' : 'Save Settings'}
        </Button>
        {error && <span className="text-sm text-system-red">{error}</span>}
      </div>
    </div>
  );
}
