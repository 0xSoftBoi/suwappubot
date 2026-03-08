"use client";

import React, { forwardRef, SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  options: SelectOption[];
  error?: string;
  selectSize?: 'sm' | 'md';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, error, selectSize = 'md', className, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-1 mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={clsx(
              'w-full appearance-none',
              'bg-white/5 border border-white/10 text-white',
              'transition-all duration-200',
              'focus:outline-none focus:border-system-blue/50 focus:ring-4 focus:ring-system-blue/20',
              selectSize === 'sm' ? 'px-3 py-2 text-xs rounded-lg pr-8' : 'px-4 py-3 text-sm rounded-xl pr-10',
              error && 'border-system-red/50',
              className
            )}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#1A1D26] text-white">
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className={clsx(
            'absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-2',
            selectSize === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
          )} />
        </div>
        {error && (
          <p className="mt-1.5 text-xs text-system-red">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
