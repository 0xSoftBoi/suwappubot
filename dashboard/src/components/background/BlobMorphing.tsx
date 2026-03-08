"use client";

import React, { useMemo } from 'react';

interface BlobMorphingProps {
  className?: string;
}

export function BlobMorphing({ className = '' }: BlobMorphingProps) {
  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {/* Primary blob - Blue/Purple */}
      <svg
        className="absolute"
        style={{
          top: '-10%',
          left: '-5%',
          width: '60%',
          height: '60%',
          opacity: 0.4,
          filter: 'blur(60px)',
        }}
        viewBox="0 0 500 500"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="blob-gradient-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0A84FF" />
            <stop offset="100%" stopColor="#BF5AF2" />
          </linearGradient>
        </defs>
        <path
          fill="url(#blob-gradient-1)"
          style={prefersReducedMotion ? {} : {
            animation: 'morph1 25s ease-in-out infinite',
          }}
        >
          <animate
            attributeName="d"
            dur="25s"
            repeatCount="indefinite"
            values="
              M440,320Q420,390,350,420Q280,450,200,440Q120,430,80,360Q40,290,70,210Q100,130,180,90Q260,50,340,80Q420,110,450,190Q480,270,440,320Z;
              M420,340Q380,430,290,450Q200,470,130,410Q60,350,60,260Q60,170,130,110Q200,50,290,60Q380,70,430,160Q480,250,420,340Z;
              M450,310Q440,370,380,420Q320,470,240,460Q160,450,100,390Q40,330,50,250Q60,170,120,110Q180,50,270,50Q360,50,420,120Q480,190,450,310Z;
              M440,320Q420,390,350,420Q280,450,200,440Q120,430,80,360Q40,290,70,210Q100,130,180,90Q260,50,340,80Q420,110,450,190Q480,270,440,320Z
            "
          />
        </path>
      </svg>

      {/* Secondary blob - Green/Teal */}
      <svg
        className="absolute"
        style={{
          bottom: '-15%',
          right: '-10%',
          width: '50%',
          height: '50%',
          opacity: 0.35,
          filter: 'blur(50px)',
        }}
        viewBox="0 0 500 500"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="blob-gradient-2" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#30D158" />
            <stop offset="100%" stopColor="#64D2FF" />
          </linearGradient>
        </defs>
        <path
          fill="url(#blob-gradient-2)"
          style={prefersReducedMotion ? {} : {
            animation: 'morph2 30s ease-in-out infinite',
          }}
        >
          <animate
            attributeName="d"
            dur="30s"
            repeatCount="indefinite"
            values="
              M420,300Q400,360,350,400Q300,440,230,440Q160,440,110,390Q60,340,60,270Q60,200,100,140Q140,80,210,60Q280,40,350,70Q420,100,440,180Q460,260,420,300Z;
              M430,310Q400,380,330,420Q260,460,180,440Q100,420,70,350Q40,280,70,210Q100,140,160,90Q220,40,300,50Q380,60,430,130Q480,200,430,310Z;
              M410,320Q370,400,290,430Q210,460,140,410Q70,360,60,280Q50,200,100,140Q150,80,230,60Q310,40,380,90Q450,140,440,230Q430,320,410,320Z;
              M420,300Q400,360,350,400Q300,440,230,440Q160,440,110,390Q60,340,60,270Q60,200,100,140Q140,80,210,60Q280,40,350,70Q420,100,440,180Q460,260,420,300Z
            "
          />
        </path>
      </svg>

      {/* Tertiary blob - Purple/Pink accent */}
      <svg
        className="absolute"
        style={{
          top: '40%',
          right: '20%',
          width: '35%',
          height: '35%',
          opacity: 0.25,
          filter: 'blur(40px)',
        }}
        viewBox="0 0 500 500"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="blob-gradient-3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#BF5AF2" />
            <stop offset="100%" stopColor="#FF375F" />
          </linearGradient>
        </defs>
        <path
          fill="url(#blob-gradient-3)"
          style={prefersReducedMotion ? {} : {
            animation: 'morph3 35s ease-in-out infinite',
          }}
        >
          <animate
            attributeName="d"
            dur="35s"
            repeatCount="indefinite"
            values="
              M400,300Q370,370,300,400Q230,430,160,390Q90,350,80,270Q70,190,120,130Q170,70,250,60Q330,50,390,110Q450,170,430,250Q410,330,400,300Z;
              M410,310Q380,380,310,410Q240,440,170,400Q100,360,90,280Q80,200,130,140Q180,80,260,70Q340,60,400,120Q460,180,440,260Q420,340,410,310Z;
              M390,290Q360,350,300,380Q240,410,170,370Q100,330,90,260Q80,190,120,130Q160,70,240,60Q320,50,380,100Q440,150,430,230Q420,310,390,290Z;
              M400,300Q370,370,300,400Q230,430,160,390Q90,350,80,270Q70,190,120,130Q170,70,250,60Q330,50,390,110Q450,170,430,250Q410,330,400,300Z
            "
          />
        </path>
      </svg>

      <style jsx>{`
        @keyframes morph1 {
          0%, 100% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(1.05) rotate(5deg); }
          50% { transform: scale(0.95) rotate(-5deg); }
          75% { transform: scale(1.02) rotate(3deg); }
        }

        @keyframes morph2 {
          0%, 100% { transform: scale(1) rotate(0deg); }
          33% { transform: scale(1.1) rotate(-8deg); }
          66% { transform: scale(0.9) rotate(8deg); }
        }

        @keyframes morph3 {
          0%, 100% { transform: scale(1) translate(0, 0); }
          25% { transform: scale(1.15) translate(20px, -20px); }
          50% { transform: scale(0.85) translate(-20px, 20px); }
          75% { transform: scale(1.05) translate(10px, 10px); }
        }
      `}</style>
    </div>
  );
}
