'use client';

import { useEffect, useRef } from 'react';
import { VERTEX_SRC, FRAGMENT_SRC, deriveCardParams, paletteToCssGradient } from '@/lib/cardShader';
import styles from './ReserveCard.module.css';

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  }
  return sh;
}

function linkProgram(gl: WebGLRenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
  }
  return p;
}

export interface ReserveCardProps {
  /** Display handle, without the leading @. Falls back to a placeholder card when empty. */
  handle: string;
  /** Stable seed from the API (or a local placeholder while nothing is reserved yet). */
  seed: number;
  /** Card size variant: the hero preview vs the success screen. */
  variant?: 'hero' | 'success';
  className?: string;
}

/**
 * ReserveCard — the generative name card.
 *
 * WebGL1 shader canvas (see lib/cardShader.ts) seeded from the handle, with a
 * real pointer-tracked 3D tilt on the wrapper. Falls back to a CSS gradient
 * built from the same palette if WebGL is unavailable or the shader fails to
 * compile — this never renders a blank box.
 *
 * Entirely decorative relative to the page's actual content (the @handle,
 * position, etc. are all real text elsewhere), so the whole thing is
 * aria-hidden.
 */
export default function ReserveCard({ handle, seed, variant = 'hero', className = '' }: ReserveCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);

  // Shader render. Re-runs when the seed changes (new handle -> new card).
  useEffect(() => {
    const canvas = canvasRef.current;
    const fallback = fallbackRef.current;
    if (!canvas || !fallback) return;

    const { mode, variation, palette } = deriveCardParams(seed);
    fallback.style.background = paletteToCssGradient(palette);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) {
      fallback.dataset.active = 'true';
      return;
    }

    let raf = 0;
    let program: WebGLProgram | null = null;
    let running = false;

    try {
      program = linkProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
    } catch {
      // Shader compile/link failed on this GPU/driver: fall back rather than
      // showing a blank canvas.
      fallback.dataset.active = 'true';
      return;
    }

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );

    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, 'resolution');
    const uPointer = gl.getUniformLocation(program, 'pointer');
    const uTime = gl.getUniformLocation(program, 'time');
    const uSeed = gl.getUniformLocation(program, 'seed');
    const uMode = gl.getUniformLocation(program, 'mode');
    const uVariation = gl.getUniformLocation(program, 'variation');
    const uColor1 = gl.getUniformLocation(program, 'color1');
    const uColor2 = gl.getUniformLocation(program, 'color2');
    const uColor3 = gl.getUniformLocation(program, 'color3');
    const uColor4 = gl.getUniformLocation(program, 'color4');

    let pointer: [number, number] = [0.5, 0.5];
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    };

    const draw = (tMs: number) => {
      gl.useProgram(program);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform2f(uPointer, pointer[0], pointer[1]);
      gl.uniform1f(uTime, tMs / 1000);
      gl.uniform1f(uSeed, seed % 1000);
      gl.uniform1f(uMode, mode);
      gl.uniform4f(uVariation, variation[0], variation[1], variation[2], variation[3]);
      gl.uniform3f(uColor1, ...palette.color1);
      gl.uniform3f(uColor2, ...palette.color2);
      gl.uniform3f(uColor3, ...palette.color3);
      gl.uniform3f(uColor4, ...palette.color4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);

    // Reduced motion: render exactly one static frame, no rAF loop, no
    // pointer-driven re-render.
    if (reduce) {
      return () => {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      };
    }

    running = true;
    raf = requestAnimationFrame(draw);

    const ro = new ResizeObserver(() => {
      resize();
    });
    ro.observe(canvas);

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = [(e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height];
    };
    const wrap = wrapRef.current;
    wrap?.addEventListener('pointermove', onPointerMove);

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (running) {
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap?.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVis);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [seed]);

  // Pointer-tracked 3D tilt. Disabled on touch (no hover) and reduced motion.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (reduce || coarse) return;

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      const ry = (mx - 0.5) * 16; // rotateY
      const rx = (0.5 - my) * 12; // rotateX
      wrap.style.setProperty('--mx', `${(mx * 100).toFixed(2)}%`);
      wrap.style.setProperty('--my', `${(my * 100).toFixed(2)}%`);
      wrap.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
      wrap.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
    };
    const onLeave = () => {
      wrap.style.setProperty('--rx', '0deg');
      wrap.style.setProperty('--ry', '0deg');
      wrap.style.setProperty('--mx', '50%');
      wrap.style.setProperty('--my', '50%');
    };

    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);
    return () => {
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const displayHandle = handle.trim() || 'yourname';
  const edition = variant === 'success' ? 'SUWAPPU // RESERVED' : 'SUWAPPU // GENESIS';

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${variant === 'success' ? styles.wrapSuccess : ''} ${className}`}
      aria-hidden="true"
    >
      <div className={styles.card}>
        <div className={styles.cardBase} />
        <canvas ref={canvasRef} className={styles.canvas} />
        <div ref={fallbackRef} className={styles.fallback} />
        <div className={styles.foil} />
        <div className={styles.surface} />
        <div className={styles.content}>
          <div className={styles.topline}>
            <span className={styles.mark}>
              <img src="/logo.svg" alt="" aria-hidden="true" />
              suwappu
            </span>
            <span className={styles.editionText}>{edition}</span>
          </div>
          <div className={styles.handle}>@{displayHandle}</div>
          <div className={styles.bottomline}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Identity</span>
              <span className={styles.fieldValue}>Account &amp; Agent</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>One of one</span>
              <span className={styles.fieldValue}>{displayHandle}.suwappu.bot</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
