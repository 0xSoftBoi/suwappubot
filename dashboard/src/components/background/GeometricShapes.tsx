"use client";

import React, { useMemo } from 'react';

interface GeometricShapesProps {
  className?: string;
}

interface Shape {
  id: number;
  type: 'circle' | 'ring' | 'line';
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
  color: string;
  animationDuration: number;
  animationDelay: number;
}

export function GeometricShapes({ className = '' }: GeometricShapesProps) {
  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Generate shapes with deterministic positioning
  const shapes = useMemo<Shape[]>(() => {
    const colors = ['#0A84FF', '#30D158', '#BF5AF2', '#64D2FF', '#FF9F0A'];
    const types: Shape['type'][] = ['circle', 'ring', 'line'];
    
    return Array.from({ length: 15 }, (_, i) => ({
      id: i,
      type: types[i % 3],
      x: ((i * 17) % 100),
      y: ((i * 23) % 100),
      size: 20 + (i * 7) % 80,
      rotation: (i * 37) % 360,
      opacity: 0.05 + (i % 5) * 0.02,
      color: colors[i % colors.length],
      animationDuration: 20 + (i % 5) * 10,
      animationDelay: i * 0.5,
    }));
  }, []);

  const renderShape = (shape: Shape) => {
    const baseStyle = prefersReducedMotion
      ? {}
      : {
          animation: `float-${shape.type} ${shape.animationDuration}s ease-in-out infinite`,
          animationDelay: `${shape.animationDelay}s`,
        };

    switch (shape.type) {
      case 'circle':
        return (
          <div
            key={shape.id}
            className="absolute rounded-full"
            style={{
              left: `${shape.x}%`,
              top: `${shape.y}%`,
              width: shape.size,
              height: shape.size,
              background: `radial-gradient(circle, ${shape.color}40 0%, transparent 70%)`,
              opacity: shape.opacity,
              transform: `translate(-50%, -50%)`,
              ...baseStyle,
            }}
          />
        );

      case 'ring':
        return (
          <div
            key={shape.id}
            className="absolute rounded-full border"
            style={{
              left: `${shape.x}%`,
              top: `${shape.y}%`,
              width: shape.size,
              height: shape.size,
              borderColor: shape.color,
              borderWidth: 1,
              opacity: shape.opacity,
              transform: `translate(-50%, -50%) rotate(${shape.rotation}deg)`,
              ...baseStyle,
            }}
          />
        );

      case 'line':
        return (
          <div
            key={shape.id}
            className="absolute"
            style={{
              left: `${shape.x}%`,
              top: `${shape.y}%`,
              width: shape.size * 2,
              height: 1,
              background: `linear-gradient(90deg, transparent, ${shape.color}, transparent)`,
              opacity: shape.opacity,
              transform: `translate(-50%, -50%) rotate(${shape.rotation}deg)`,
              ...baseStyle,
            }}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {shapes.map(renderShape)}

      <style jsx>{`
        @keyframes float-circle {
          0%, 100% {
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            transform: translate(-50%, calc(-50% - 20px)) scale(1.1);
          }
        }

        @keyframes float-ring {
          0%, 100% {
            transform: translate(-50%, -50%) rotate(0deg) scale(1);
          }
          50% {
            transform: translate(-50%, calc(-50% - 15px)) rotate(180deg) scale(1.05);
          }
        }

        @keyframes float-line {
          0%, 100% {
            transform: translate(-50%, -50%) rotate(var(--rotation)) scaleX(1);
          }
          50% {
            transform: translate(-50%, calc(-50% - 10px)) rotate(calc(var(--rotation) + 10deg)) scaleX(1.2);
          }
        }
      `}</style>
    </div>
  );
}
