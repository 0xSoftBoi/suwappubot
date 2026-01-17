"use client";

import React, { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-gradient-to-r from-system-blue to-blue-600 
    text-white font-semibold
    shadow-glow-blue
    hover:from-blue-500 hover:to-blue-500
    active:scale-[0.98]
  `,
  secondary: `
    bg-white/5 
    text-white 
    border border-white/10
    hover:bg-white/10 hover:border-white/20
    active:scale-[0.98]
  `,
  ghost: `
    bg-transparent 
    text-gray-300 
    hover:text-white hover:bg-white/5
    active:bg-white/10
  `,
  danger: `
    bg-system-red/10 
    text-system-red 
    border border-system-red/20
    hover:bg-system-red/20
    active:scale-[0.98]
  `,
  success: `
    bg-system-green/10 
    text-system-green 
    border border-system-green/20
    hover:bg-system-green/20
    active:scale-[0.98]
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs rounded-lg min-h-[32px]',
  md: 'px-5 py-3 text-sm rounded-xl min-h-[44px]',
  lg: 'px-8 py-4 text-base rounded-xl min-h-[52px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={clsx(
          // Base styles
          'inline-flex items-center justify-center gap-2',
          'font-medium',
          'transition-all duration-200 ease-out-expo',
          'focus:outline-none focus-visible:ring-4 focus-visible:ring-system-blue/40',
          // Variant styles
          variantStyles[variant],
          // Size styles
          sizeStyles[size],
          // Width
          fullWidth && 'w-full',
          // Disabled state
          isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          // Custom className
          className
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          leftIcon && <span className="flex-shrink-0">{leftIcon}</span>
        )}
        <span>{children}</span>
        {!isLoading && rightIcon && (
          <span className="flex-shrink-0">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
