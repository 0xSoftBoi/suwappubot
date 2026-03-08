"use client";

import React, { useMemo } from 'react';

interface GradientWavesProps {
  className?: string;
}

export function GradientWaves({ className = '' }: GradientWavesProps) {
  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <svg
        className="absolute w-full h-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradient definitions */}
          <linearGradient id="wave-gradient-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#5E5CE6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#BF5AF2" stopOpacity="0.1" />
          </linearGradient>
          
          <linearGradient id="wave-gradient-2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#30D158" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#64D2FF" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.1" />
          </linearGradient>
          
          <linearGradient id="wave-gradient-3" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#BF5AF2" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#FF375F" stopOpacity="0.1" />
          </linearGradient>

          {/* Blur filter */}
          <filter id="wave-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="40" />
          </filter>
        </defs>

        {/* Wave layer 1 - slow, large wave */}
        <g filter="url(#wave-blur)">
          <path
            fill="url(#wave-gradient-1)"
            d="M0,600 
               C150,650 350,500 500,550 
               C650,600 800,700 1000,650 
               C1200,600 1350,550 1440,600 
               L1440,900 L0,900 Z"
            style={prefersReducedMotion ? {} : {
              animation: 'wave1 25s ease-in-out infinite',
            }}
          />
        </g>

        {/* Wave layer 2 - medium speed */}
        <g filter="url(#wave-blur)">
          <path
            fill="url(#wave-gradient-2)"
            d="M0,700 
               C200,650 400,750 600,700 
               C800,650 1000,600 1200,650 
               C1350,680 1400,750 1440,700 
               L1440,900 L0,900 Z"
            style={prefersReducedMotion ? {} : {
              animation: 'wave2 20s ease-in-out infinite',
            }}
          />
        </g>

        {/* Wave layer 3 - faster, top accent */}
        <g filter="url(#wave-blur)">
          <path
            fill="url(#wave-gradient-3)"
            d="M0,300 
               C200,250 400,350 600,300 
               C800,250 1000,200 1200,250 
               C1350,280 1400,300 1440,280 
               L1440,0 L0,0 Z"
            style={prefersReducedMotion ? {} : {
              animation: 'wave3 30s ease-in-out infinite',
            }}
          />
        </g>
      </svg>

      <style jsx>{`
        @keyframes wave1 {
          0%, 100% {
            transform: translateX(0) translateY(0);
          }
          25% {
            transform: translateX(-30px) translateY(20px);
          }
          50% {
            transform: translateX(0) translateY(40px);
          }
          75% {
            transform: translateX(30px) translateY(20px);
          }
        }

        @keyframes wave2 {
          0%, 100% {
            transform: translateX(0) translateY(0);
          }
          25% {
            transform: translateX(40px) translateY(-30px);
          }
          50% {
            transform: translateX(0) translateY(-60px);
          }
          75% {
            transform: translateX(-40px) translateY(-30px);
          }
        }

        @keyframes wave3 {
          0%, 100% {
            transform: translateX(0) translateY(0);
          }
          33% {
            transform: translateX(-50px) translateY(30px);
          }
          66% {
            transform: translateX(50px) translateY(-30px);
          }
        }
      `}</style>
    </div>
  );
}
