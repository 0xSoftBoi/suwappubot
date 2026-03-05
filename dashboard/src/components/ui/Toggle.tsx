"use client";

import React from 'react';
import { clsx } from 'clsx';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled = false }: ToggleProps) {
  return (
    <label className={clsx(
      'flex items-center justify-between gap-4',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    )}>
      {(label || description) && (
        <div className="flex-1">
          {label && <span className="text-sm font-medium text-white">{label}</span>}
          {description && <p className="text-xs text-gray-2 mt-0.5">{description}</p>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={clsx(
          'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200',
          'focus:outline-none focus-visible:ring-4 focus-visible:ring-system-blue/40',
          checked ? 'bg-system-blue' : 'bg-white/10',
          disabled && 'pointer-events-none'
        )}
      >
        <span
          className={clsx(
            'inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
            'mt-0.5'
          )}
        />
      </button>
    </label>
  );
}
