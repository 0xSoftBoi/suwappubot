"use client";

import { useState, useEffect, useCallback } from 'react';

export interface Preferences {
  slippage: number;
  customSlippage: string;
  notifications: boolean;
  twoFactorEnabled: boolean;
  twoFactorThreshold: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  slippage: 1,
  customSlippage: '',
  notifications: true,
  twoFactorEnabled: false,
  twoFactorThreshold: '1000',
};

interface PreferencesResult {
  preferences: Preferences;
  setPreferences: (prefs: Partial<Preferences>) => void;
  save: () => Promise<void>;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  error: string | null;
  saveSuccess: boolean;
}

export function usePreferences(): PreferencesResult {
  const [preferences, setPreferencesState] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [savedPreferences, setSavedPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/preferences');
        if (res.ok) {
          const data = await res.json();
          const merged = { ...DEFAULT_PREFERENCES, ...data };
          setPreferencesState(merged);
          setSavedPreferences(merged);
        }
      } catch {
        // Use defaults on failure
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const setPreferences = useCallback((partial: Partial<Preferences>) => {
    setSaveSuccess(false);
    setPreferencesState((prev) => ({ ...prev, ...partial }));
  }, []);

  const save = useCallback(async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);

      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!res.ok) throw new Error('Failed to save preferences');

      setSavedPreferences(preferences);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  }, [preferences]);

  const isDirty = JSON.stringify(preferences) !== JSON.stringify(savedPreferences);

  return {
    preferences,
    setPreferences,
    save,
    isLoading,
    isSaving,
    isDirty,
    error,
    saveSuccess,
  };
}
