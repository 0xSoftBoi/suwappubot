'use client';

import { useEffect, useRef } from 'react';

/**
 * ChainSphereGL — the hero object, on the GPU.
 *
 * The canvas-2D version projected and depth-sorted 3600 points in JS on every
 * frame. That sort was the actual cost, not the drawing. Here the vertex
 * shader does the rotation and projection in parallel and back-facing points
 * are discarded outright, so no sort exists at all.
 *
 * Raw WebGL2 rather than three.js: this is one object on a marketing page, and
 * three.js is 150KB+ tree-shaken against roughly nothing here. Vercel made the
 * same trade when they replaced their three.js globe with COBE.
 *
 * Two layers. WebGL draws the lit body and the point cloud. A 2D overlay draws
 * the chain labels and the multi-stage route, because text in WebGL costs far
 * more than it is worth and the route is only a few dozen segments.
 */

const DOTS = 3600;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Real chains, pinned to fixed lat/lon so the graph is stable. */
const ANCHORS: Array<[string, number, number]> = [
  ['Ethereum', 34, 12], ['Base', 12, 58], ['Arbitrum', -8, 104],
  ['Optimism', 26, 150], ['Solana', -30, 196], ['Polygon', 8, 242],
  ['BSC', -18, 288], ['Avalanche', 40, 322], ['Tron', -44, 68],
  ['Starknet', 52, 200], ['HyperEVM', -12, 340], ['Tempo', 20, 262],
];

/** Multi-stage journeys: swap on the source chain, bridge, swap again. */
type Leg = { kind: 'swap' | 'bridge'; venue: string; note: string };
export type Journey = {
  fromChain: string; fromToken: string;
  toChain: string; toToken: string;
  legs: [Leg, Leg, Leg];
};

export const JOURNEYS: Journey[] = [
  {
    fromChain: 'Base', fromToken: 'USDC', toChain: 'Tron', toToken: 'USDT',
    legs: [
      { kind: 'swap', venue: 'Base DEX', note: 'USDC to bridge asset' },
      { kind: 'bridge', venue: 'best bridge', note: 'Base to Tron' },
      { kind: 'swap', venue: 'SunSwap', note: 'to USDT on Tron' },
    ],
  },
  {
    fromChain: 'Base', fromToken: 'USDC', toChain: 'Solana', toToken: 'SOL',
    legs: [
      { kind: 'swap', venue: 'Base DEX', note: 'USDC to bridge asset' },
      { kind: 'bridge', venue: 'best bridge', note: 'Base to Solana' },
      { kind: 'swap', venue: 'Jupiter', note: 'to SOL on Solana' },
    ],
  },
  {
    fromChain: 'Tron', fromToken: 'USDT', toChain: 'Solana', toToken: 'USDC',
    legs: [
      { kind: 'swap', venue: 'SunSwap', note: 'USDT to bridge asset' },
      { kind: 'bridge', venue: 'best bridge', note: 'Tron to Solana' },
      { kind: 'swap', venue: 'Jupiter', note: 'to USDC on Solana' },
    ],
  },
];

const VERT = `#version 300 es
precision highp float;

in vec3 aPos;

uniform float uSpin;
uniform float uTilt;
uniform vec2  uCenter;     // px
uniform float uRadius;     // px
uniform vec2  uViewport;   // px
uniform float uDpr;

out float vLambert;
out float vDepth;

void main() {
  // Rotate about Y, then tilt, so the body reads as a sphere not a disc.
  float c = cos(uSpin), s = sin(uSpin);
  vec3 p = vec3(aPos.x * c + aPos.z * s, aPos.y, -aPos.x * s + aPos.z * c);
  float ct = cos(uTilt), st = sin(uTilt);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);

  // Cull the far hemisphere in the shader. This is what replaces the JS
  // depth sort entirely: there is nothing to order if it is never drawn.
  if (p.z <= 0.04) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  float k = 3.2 / (3.2 - p.z);           // perspective
  vec2 px = uCenter + vec2(p.x, -p.y) * uRadius * k;

  gl_Position = vec4((px / uViewport) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  gl_PointSize = max(1.0, 0.95 * k * 0.62 * uDpr * 2.0);

  // Lambert against a fixed up-left key, the same light the body uses.
  vLambert = max(0.0, dot(normalize(p), normalize(vec3(-0.42, 0.44, 0.79))));
  vDepth = p.z;
}`;

const FRAG = `#version 300 es
precision highp float;

in float vLambert;
in float vDepth;
uniform vec3 uAccent;
out vec4 outColor;

// Ordered dither. Near-black gradients band badly at 8-bit, and this is the
// cheap fix.
float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) / 255.0;
}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;                       // round sprite
  float edge = smoothstep(0.25, 0.10, r);      // soft rim
  float lum = 0.10 + vLambert * 0.92;
  outColor = vec4(uAccent * lum + dither(gl_FragCoord.xy), edge * lum);
}`;

const BODY_VERT = `#version 300 es
precision highp float;
in vec2 aQuad;
uniform vec2 uCenter, uViewport;
uniform float uRadius;
out vec2 vLocal;
void main() {
  vLocal = aQuad;
  vec2 px = uCenter + aQuad * uRadius;
  vec2 clip = (px / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const BODY_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec3 uAccent;
out vec4 outColor;
float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) / 255.0;
}
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  // Lit from up-left, matching the point shading.
  float lit = clamp(1.0 - length(vLocal - vec2(-0.32, -0.34)) * 0.9, 0.0, 1.0);
  vec3 base = mix(vec3(0.043, 0.035, 0.031), vec3(0.18, 0.125, 0.07), lit * lit);
  // Fresnel rim: the professional version of faking brightness by depth.
  float fres = pow(smoothstep(0.82, 1.0, r), 1.6);
  vec3 col = base + uAccent * fres * 0.16;
  outColor = vec4(col + dither(gl_FragCoord.xy), 0.96);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  }
  return p;
}

export default function ChainSphereGL({
  className = '',
  accent = [0.965, 0.663, 0.235] as [number, number, number],
}: {
  className?: string;
  accent?: [number, number, number];
}) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const glc = glRef.current, ovc = overlayRef.current;
    if (!glc || !ovc) return;

    const gl = glc.getContext('webgl2', {
      antialias: true, alpha: true, premultipliedAlpha: false,
    });
    const ctx = ovc.getContext('2d');
    // If WebGL2 is unavailable the overlay still draws labels and the route,
    // so the section degrades rather than going blank.
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, running = false, w = 0, h = 0, dpr = 1;

    /* ── GPU setup ─────────────────────────────────────────── */
    let progPts: WebGLProgram | null = null, progBody: WebGLProgram | null = null;
    let vaoPts: WebGLVertexArrayObject | null = null, vaoBody: WebGLVertexArrayObject | null = null;

    if (gl) {
      try {
        progBody = program(gl, BODY_VERT, BODY_FRAG);
        progPts = program(gl, VERT, FRAG);

        // Fibonacci lattice, uploaded once. It never changes, so the CPU
        // never touches these positions again.
        const pts = new Float32Array(DOTS * 3);
        for (let i = 0; i < DOTS; i++) {
          const y = 1 - (i / (DOTS - 1)) * 2;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const th = i * GOLDEN;
          pts[i * 3] = Math.cos(th) * r;
          pts[i * 3 + 1] = y;
          pts[i * 3 + 2] = Math.sin(th) * r;
        }
        vaoPts = gl.createVertexArray();
        gl.bindVertexArray(vaoPts);
        const bp = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bp);
        gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
        const locPos = gl.getAttribLocation(progPts, 'aPos');
        gl.enableVertexAttribArray(locPos);
        gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);

        vaoBody = gl.createVertexArray();
        gl.bindVertexArray(vaoBody);
        const bq = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bq);
        gl.bufferData(gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const locQ = gl.getAttribLocation(progBody, 'aQuad');
        gl.enableVertexAttribArray(locQ);
        gl.vertexAttribPointer(locQ, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        // Additive blending: overlapping points accumulate brightness and
        // there is no transparency sort to get wrong.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      } catch {
        progPts = progBody = null;   // fall through to overlay-only
      }
    }

    /* ── Geometry shared with the overlay ───────────────────── */
    const TILT = 0.12;
    const toVec = (lat: number, lon: number) => {
      const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
      return { x: Math.cos(a) * Math.cos(b), y: Math.sin(a), z: Math.cos(a) * Math.sin(b) };
    };
    const ANCHOR_V = ANCHORS.map(([n, la, lo]) => ({ n, ...toVec(la, lo) }));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);   // capped: 3x is a fill-rate trap
      w = glc.clientWidth; h = glc.clientHeight;
      if (!w || !h) return;
      for (const c of [glc, ovc]) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gl?.viewport(0, 0, glc.width, glc.height);
    };

    const draw = (t: number) => {
      if (!w || !h) return;
      const R = Math.min(w, h) * 0.355;
      const cx = w * 0.5, cy = h * 0.5;
      const spin = reduce ? 0.6 : t * 0.00009;

      /* GPU: body then points. */
      if (gl && progBody && progPts) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(progBody);
        gl.uniform2f(gl.getUniformLocation(progBody, 'uCenter'), cx * dpr, cy * dpr);
        gl.uniform2f(gl.getUniformLocation(progBody, 'uViewport'), glc.width, glc.height);
        gl.uniform1f(gl.getUniformLocation(progBody, 'uRadius'), R * dpr);
        gl.uniform3fv(gl.getUniformLocation(progBody, 'uAccent'), accent);
        gl.bindVertexArray(vaoBody);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.useProgram(progPts);
        gl.uniform1f(gl.getUniformLocation(progPts, 'uSpin'), spin);
        gl.uniform1f(gl.getUniformLocation(progPts, 'uTilt'), TILT);
        gl.uniform2f(gl.getUniformLocation(progPts, 'uCenter'), cx * dpr, cy * dpr);
        gl.uniform1f(gl.getUniformLocation(progPts, 'uRadius'), R * dpr);
        gl.uniform2f(gl.getUniformLocation(progPts, 'uViewport'), glc.width, glc.height);
        gl.uniform1f(gl.getUniformLocation(progPts, 'uDpr'), dpr);
        gl.uniform3fv(gl.getUniformLocation(progPts, 'uAccent'), accent);
        gl.bindVertexArray(vaoPts);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, DOTS);
        gl.bindVertexArray(null);
      }

      /* Overlay: labels and the multi-stage route. */
      ctx.clearRect(0, 0, w, h);
      const rot = (v: { x: number; y: number; z: number }) => {
        const c = Math.cos(spin), s = Math.sin(spin);
        const x = v.x * c + v.z * s, z0 = -v.x * s + v.z * c;
        const ct = Math.cos(TILT), st = Math.sin(TILT);
        return { x, y: v.y * ct - z0 * st, z: v.y * st + z0 * ct };
      };
      const proj = (v: { x: number; y: number; z: number }) => {
        const k = 3.2 / (3.2 - v.z);
        return { x: cx + v.x * R * k, y: cy - v.y * R * k, k, z: v.z };
      };

      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      const A = (o: number) => `rgba(246,169,60,${o})`;
      const D = (o: number) => `rgba(255,255,255,${o})`;

      const per = 7200;
      const jIdx = reduce ? 0 : Math.floor(t / per) % JOURNEYS.length;
      const jp = reduce ? 0.5 : ((t % per) / per);
      const J = JOURNEYS[jIdx];
      const byName = (n: string) => ANCHOR_V.find((v) => v.n === n) ?? ANCHOR_V[0];
      const S = byName(J.fromChain), E = byName(J.toChain);
      const stage = jp < 0.28 ? 0 : jp < 0.72 ? 1 : 2;
      const bridgeU = Math.max(0, Math.min(1, (jp - 0.28) / 0.44));

      const dotp = Math.max(-1, Math.min(1, S.x * E.x + S.y * E.y + S.z * E.z));
      const omega = Math.acos(dotp) || 0.0001;
      const arcPt = (u: number) => {
        const s1 = Math.sin((1 - u) * omega) / Math.sin(omega);
        const s2 = Math.sin(u * omega) / Math.sin(omega);
        const lift = 1 + 0.24 * Math.sin(Math.PI * u);
        return rot({
          x: (S.x * s1 + E.x * s2) * lift,
          y: (S.y * s1 + E.y * s2) * lift,
          z: (S.z * s1 + E.z * s2) * lift,
        });
      };

      ctx.beginPath();
      for (let i = 0; i <= 56; i++) {
        const q = proj(arcPt(i / 56));
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.strokeStyle = A(0.28); ctx.lineWidth = 1; ctx.stroke();

      if (stage >= 1) {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const q = proj(arcPt((i / 40) * bridgeU));
          i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.strokeStyle = A(0.85); ctx.lineWidth = 1.9; ctx.stroke();
        const head = proj(arcPt(bridgeU));
        ctx.beginPath(); ctx.arc(head.x, head.y, 3.2, 0, 6.284);
        ctx.fillStyle = A(1); ctx.fill();
      }

      const pulse = (v: typeof S, on: boolean) => {
        const q = proj(rot(v));
        ctx.beginPath(); ctx.arc(q.x, q.y, on ? 9 : 5.5, 0, 6.284);
        ctx.strokeStyle = A(on ? 0.75 : 0.3);
        ctx.lineWidth = on ? 1.8 : 1; ctx.stroke();
      };
      pulse(S, stage === 0);
      pulse(E, stage === 2);

      // Labels, front face only, suppressed where two would collide.
      const placed: Array<{ x: number; y: number }> = [];
      const front = ANCHOR_V.map((v) => {
        const r = rot(v); return { n: v.n, ...proj(r), zz: r.z };
      }).filter((p) => p.zz > 0).sort((a, b) => a.zz - b.zz);

      for (const p of front) {
        const fade = Math.min(1, p.zz * 2.2);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.8 * p.k * 0.8, 0, 6.284);
        ctx.fillStyle = A(0.55 * fade + 0.25); ctx.fill();
        const clash = placed.some((q) => Math.abs(q.x - p.x) < 62 && Math.abs(q.y - p.y) < 14);
        if (clash) continue;
        placed.push({ x: p.x, y: p.y - 12 });
        ctx.textAlign = 'center';
        ctx.fillStyle = D(0.16 + 0.3 * fade);
        ctx.fillText(p.n, p.x, p.y - 12);
      }

      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(glc);

    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    }, { threshold: 0 });
    io.observe(glc);

    // Stop burning frames in a background tab.
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); }
      else if (running && !reduce) raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [accent]);

  return (
    <div className={`csgl ${className}`} aria-hidden="true">
      <canvas ref={glRef} className="csgl__gl" />
      <canvas ref={overlayRef} className="csgl__overlay" />
    </div>
  );
}
