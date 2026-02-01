"use client";

import React, { useEffect, useRef, useMemo } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  color: string;
}

interface ParticleSystemProps {
  particleCount?: number;
  colors?: string[];
  maxSpeed?: number;
  connectDistance?: number;
  className?: string;
}

export function ParticleSystem({
  particleCount = 50,
  colors = ['#0A84FF', '#30D158', '#BF5AF2', '#64D2FF'],
  maxSpeed = 0.3,
  connectDistance = 120,
  className = '',
}: ParticleSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle resize
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      // Reinitialize particles on resize
      initParticles(rect.width, rect.height);
    };

    // Initialize particles
    const initParticles = (width: number, height: number) => {
      particlesRef.current = Array.from({ length: particleCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * maxSpeed,
        vy: (Math.random() - 0.5) * maxSpeed,
        radius: Math.random() * 2 + 1,
        opacity: Math.random() * 0.5 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)],
      }));
    };

    // Handle mouse move
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    // Animation loop
    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      ctx.clearRect(0, 0, width, height);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Update and draw particles
      particles.forEach((particle, i) => {
        // Mouse interaction
        const dx = mouse.x - particle.x;
        const dy = mouse.y - particle.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 150) {
          const force = (150 - dist) / 150;
          particle.vx -= (dx / dist) * force * 0.02;
          particle.vy -= (dy / dist) * force * 0.02;
        }

        // Update position
        particle.x += particle.vx;
        particle.y += particle.vy;

        // Boundary check
        if (particle.x < 0 || particle.x > width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > height) particle.vy *= -1;

        // Keep particles in bounds
        particle.x = Math.max(0, Math.min(width, particle.x));
        particle.y = Math.max(0, Math.min(height, particle.y));

        // Draw particle
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = particle.opacity;
        ctx.fill();

        // Draw connections
        for (let j = i + 1; j < particles.length; j++) {
          const other = particles[j];
          const connDx = particle.x - other.x;
          const connDy = particle.y - other.y;
          const connDist = Math.sqrt(connDx * connDx + connDy * connDy);

          if (connDist < connectDistance) {
            ctx.beginPath();
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = particle.color;
            ctx.globalAlpha = (1 - connDist / connectDistance) * 0.15;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });

      ctx.globalAlpha = 1;
      animationRef.current = requestAnimationFrame(animate);
    };

    // Setup
    handleResize();
    window.addEventListener('resize', handleResize);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [particleCount, colors, maxSpeed, connectDistance, prefersReducedMotion]);

  if (prefersReducedMotion) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-auto ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
