"use client";

import React, { forwardRef, InputHTMLAttributes, ReactNode, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

type InputSize = 'sm' | 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  inputSize?: InputSize;
}

const sizeStyles: Record<InputSize, { input: string; label: string }> = {
  sm: {
    input: 'px-3 py-2 text-sm rounded-lg',
    label: 'text-xs mb-1.5',
  },
  md: {
    input: 'px-4 py-3 text-sm rounded-xl',
    label: 'text-sm mb-2',
  },
  lg: {
    input: 'px-5 py-4 text-base rounded-xl',
    label: 'text-base mb-2',
  },
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      inputSize = 'md',
      type = 'text',
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';

    return (
      <div className="w-full">
        {label && (
          <label
            className={clsx(
              'block font-medium text-gray-1',
              sizeStyles[inputSize].label
            )}
          >
            {label}
          </label>
        )}
        
        <div className="relative">
          {/* Left icon */}
          {leftIcon && (
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-2">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            type={isPassword && showPassword ? 'text' : type}
            disabled={disabled}
            className={clsx(
              // Base styles
              'w-full',
              'bg-white/5',
              'border border-white/10',
              'text-white',
              'placeholder:text-gray-2',
              'transition-all duration-200 ease-out-expo',
              // Focus styles
              'focus:outline-none',
              'focus:border-system-blue/50',
              'focus:bg-white/[0.08]',
              'focus:ring-4',
              'focus:ring-system-blue/20',
              // Size styles
              sizeStyles[inputSize].input,
              // Icon padding
              leftIcon && 'pl-11',
              (rightIcon || isPassword) && 'pr-11',
              // Error state
              error && [
                'border-system-red/50',
                'focus:border-system-red/50',
                'focus:ring-system-red/20',
              ],
              // Disabled state
              disabled && 'opacity-50 cursor-not-allowed',
              // Custom className
              className
            )}
            {...props}
          />

          {/* Right icon or password toggle */}
          {(rightIcon || isPassword) && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              {isPassword ? (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-gray-2 hover:text-white transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <span className="text-gray-2">{rightIcon}</span>
              )}
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-1.5 mt-2 text-system-red">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {/* Helper text */}
        {helperText && !error && (
          <p className="mt-2 text-xs text-gray-2">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// Textarea component
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className, disabled, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-1 mb-2">
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          disabled={disabled}
          className={clsx(
            // Base styles
            'w-full',
            'px-4 py-3',
            'bg-white/5',
            'border border-white/10',
            'rounded-xl',
            'text-white text-sm',
            'placeholder:text-gray-2',
            'transition-all duration-200 ease-out-expo',
            'resize-y min-h-[100px]',
            // Focus styles
            'focus:outline-none',
            'focus:border-system-blue/50',
            'focus:bg-white/[0.08]',
            'focus:ring-4',
            'focus:ring-system-blue/20',
            // Error state
            error && [
              'border-system-red/50',
              'focus:border-system-red/50',
              'focus:ring-system-red/20',
            ],
            // Disabled state
            disabled && 'opacity-50 cursor-not-allowed',
            // Custom className
            className
          )}
          {...props}
        />

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-1.5 mt-2 text-system-red">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {/* Helper text */}
        {helperText && !error && (
          <p className="mt-2 text-xs text-gray-2">{helperText}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
