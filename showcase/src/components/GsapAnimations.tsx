'use client';

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

/* ---------------------------------------------------------------
   FadeUpStagger — words stagger in from below
   --------------------------------------------------------------- */

interface FadeUpStaggerProps {
  children: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  delay?: number;
  staggerAmount?: number;
}

export function FadeUpStagger({
  children,
  className = '',
  as: Tag = 'h2',
  delay = 0,
  staggerAmount = 0.05,
}: FadeUpStaggerProps) {
  const containerRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!containerRef.current) return;
    const words = containerRef.current.querySelectorAll('.gsap-word');
    gsap.from(words, {
      y: 40,
      opacity: 0,
      stagger: staggerAmount,
      duration: 0.9,
      delay,
      ease: 'elastic.out(1, 0.5)',
    });
  }, { scope: containerRef });

  const words = children.split(' ');

  return (
    // @ts-expect-error dynamic tag
    <Tag ref={containerRef} className={className}>
      {words.map((word, i) => (
        <span key={i} className="gsap-word inline-block mr-[0.25em]">
          {word}
        </span>
      ))}
    </Tag>
  );
}

/* ---------------------------------------------------------------
   TypewriterReveal — character-by-character with cursor
   --------------------------------------------------------------- */

interface TypewriterRevealProps {
  text: string;
  className?: string;
  speed?: number;
  delay?: number;
  showCursor?: boolean;
}

export function TypewriterReveal({
  text,
  className = '',
  speed = 0.03,
  delay = 0,
  showCursor = true,
}: TypewriterRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);

  useGSAP(() => {
    if (!textRef.current || !containerRef.current) return;

    const chars = textRef.current.querySelectorAll('.tw-char');

    gsap.set(chars, { opacity: 0 });

    gsap.to(chars, {
      opacity: 1,
      stagger: speed,
      delay,
      duration: 0.01,
      ease: 'none',
    });

    if (cursorRef.current && showCursor) {
      gsap.to(cursorRef.current, {
        opacity: 0,
        repeat: -1,
        yoyo: true,
        duration: 0.5,
        ease: 'steps(1)',
      });
    }
  }, { scope: containerRef });

  return (
    <div ref={containerRef} className={className}>
      <span ref={textRef}>
        {text.split('').map((char, i) => (
          <span key={i} className="tw-char">
            {char}
          </span>
        ))}
      </span>
      {showCursor && (
        <span ref={cursorRef} className="inline-block w-[2px] h-[1em] bg-current ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   GradientReveal — clip-path wipe with gradient text
   --------------------------------------------------------------- */

interface GradientRevealProps {
  children: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  delay?: number;
  duration?: number;
}

export function GradientReveal({
  children,
  className = '',
  as: Tag = 'h2',
  delay = 0,
  duration = 1,
}: GradientRevealProps) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!ref.current) return;

    gsap.fromTo(
      ref.current,
      { clipPath: 'inset(0 100% 0 0)' },
      {
        clipPath: 'inset(0 0% 0 0)',
        duration: duration * 1.2,
        delay,
        ease: 'back.inOut(1.4)',
      },
    );
  }, { scope: ref });

  return (
    // @ts-expect-error dynamic tag
    <Tag ref={ref} className={`gradient-text ${className}`}>
      {children}
    </Tag>
  );
}
