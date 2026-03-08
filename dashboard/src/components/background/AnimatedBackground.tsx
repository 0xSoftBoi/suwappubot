"use client";

import React, { useMemo, useEffect, useState } from 'react';
import { ParticleSystem } from './ParticleSystem';
import { GradientWaves } from './GradientWaves';
import { GeometricShapes } from './GeometricShapes';
import { BlobMorphing } from './BlobMorphing';

interface AnimatedBackgroundProps {
  variant?: 'full' | 'minimal' | 'particles-only' | 'blobs-only';
  interactive?: boolean;
  className?: string;
}

export function AnimatedBackground({
  variant = 'full',
  interactive = true,
  className = '',
}: AnimatedBackgroundProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Detect mobile and adjust complexity
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Visibility API - pause animations when tab is not visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Don't render heavy animations if not visible or reduced motion
  if (prefersReducedMotion) {
    return (
      <div className={`fixed inset-0 -z-10 bg-black ${className}`}>
        {/* Static gradient background for reduced motion */}
        <div 
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 20% 0%, rgba(10, 132, 255, 0.15) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 100%, rgba(191, 90, 242, 0.1) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 50%, rgba(48, 209, 88, 0.05) 0%, transparent 70%),
              #000000
            `,
          }}
        />
      </div>
    );
  }

  // Minimal variant for performance on slower devices
  if (variant === 'minimal' || (isMobile && variant === 'full')) {
    return (
      <div className={`fixed inset-0 -z-10 bg-black ${className}`}>
        {isVisible && <BlobMorphing />}
      </div>
    );
  }

  // Particles only variant
  if (variant === 'particles-only') {
    return (
      <div className={`fixed inset-0 -z-10 bg-black ${className}`}>
        {isVisible && (
          <ParticleSystem
            particleCount={isMobile ? 25 : 50}
            connectDistance={isMobile ? 80 : 120}
          />
        )}
      </div>
    );
  }

  // Blobs only variant
  if (variant === 'blobs-only') {
    return (
      <div className={`fixed inset-0 -z-10 bg-black ${className}`}>
        {isVisible && <BlobMorphing />}
      </div>
    );
  }

  // Full variant with all effects
  return (
    <div className={`fixed inset-0 -z-10 bg-black overflow-hidden ${className}`}>
      {/* Base gradient */}
      <div 
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, #0D0D0F 0%, #000000 100%)',
        }}
      />

      {/* Blob morphing layer - deepest */}
      {isVisible && <BlobMorphing />}

      {/* Gradient waves layer */}
      {isVisible && <GradientWaves />}

      {/* Geometric shapes layer */}
      {isVisible && <GeometricShapes />}

      {/* Particle system layer - topmost interactive layer */}
      {isVisible && interactive && (
        <ParticleSystem
          particleCount={isMobile ? 30 : 50}
          connectDistance={isMobile ? 80 : 120}
          maxSpeed={0.3}
        />
      )}

      {/* Subtle noise overlay for texture */}
      <div 
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Vignette effect */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.4) 100%)',
        }}
      />
    </div>
  );
}
