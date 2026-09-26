'use client';

import { useEffect, useRef } from 'react';
import styles from './orb.module.css';

export type OrbState = 'idle' | 'thinking' | 'success' | 'error';

/**
 * LivingOrbGL — a fragment-shaded "AI presence" orb.
 *
 * One full-screen triangle, one fragment shader: a soft spherical volume lit
 * from a pointer-following direction, domain-warped fbm noise flowing across
 * its surface, a fresnel rim, and an inner glow. No geometry, no meshes —
 * everything is signed-distance + noise math per pixel, the same approach
 * ChainSphereGL/DepthSurfaceGL use for the rest of the page's GL surfaces.
 *
 * `state` drives uniform targets (flow speed, rim brightness, pulse,
 * saturation, brightness) which are eased ~800ms rather than snapped, so
 * state changes read as mood shifts, not cuts. `success` additionally fires
 * a one-shot bloom envelope on the transition edge.
 */

const VERT = `#version 300 es
precision highp float;
// Full-screen triangle from gl_VertexID — no buffer needed.
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uFlow;        // noise flow speed
uniform float uRim;         // fresnel rim strength
uniform float uPulseAmp;    // pulse amplitude on top of base scale
uniform float uPulseFreq;   // pulse frequency (rad/s)
uniform float uScale;       // base radius scale (breathing / bloom)
uniform float uBrightness;
uniform float uSaturation;
uniform vec2 uLight;        // light dir offset from pointer, [-1,1]
uniform vec3 uAccent;
uniform vec3 uAccentBright;
uniform vec3 uAccentDeep;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.52;
  }
  return v;
}

// Domain-warped fbm: flow the sampling coordinate through a first pass of
// noise so the surface reads as slowly churning gas, not a static texture.
float warped(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.6)), fbm(p + vec2(5.2, -t * 0.5)));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(t * 0.22, -t * 0.31)),
                fbm(p + 3.4 * q + vec2(-t * 0.18, t * 0.27)));
  return fbm(p + 3.2 * r);
}

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, s);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float pulse = 1.0 + uPulseAmp * sin(uTime * uPulseFreq);
  float radius = 0.30 * uScale * pulse;

  float d = length(uv);
  float sphereMask = smoothstep(radius, radius - 0.015, d);

  // Halo: soft, wide falloff with no hard edge, extends well past the sphere.
  float halo = smoothstep(radius * 3.6, radius * 0.7, d);
  halo = pow(halo, 1.6);

  if (d > radius * 3.6) {
    outColor = vec4(0.0);
    return;
  }

  // Fake a hemisphere normal for lighting inside the sphere mask.
  float nz = sqrt(max(0.0, radius * radius - d * d)) / max(radius, 0.0001);
  vec3 normal = normalize(vec3(uv, nz * 0.9));
  vec3 lightDir = normalize(vec3(uLight * 0.6 + vec2(-0.35, 0.42), 0.82));
  float lambert = max(0.0, dot(normal, lightDir));

  float fres = pow(1.0 - max(0.0, nz), 2.2) * uRim;

  vec2 flowUv = uv * 3.1 + vec2(0.5, 0.3);
  float n = warped(flowUv, uTime * uFlow);

  vec3 base = mix(uAccentDeep, uAccent, lambert);
  base = mix(base, uAccentBright, smoothstep(0.55, 0.95, n) * (0.35 + 0.5 * lambert));
  // Warm rose + cream highlights threaded through the noise field.
  vec3 rose = vec3(0.94, 0.55, 0.52);
  vec3 cream = vec3(1.0, 0.96, 0.88);
  base = mix(base, rose, smoothstep(0.75, 0.92, n) * 0.22);
  float hi = smoothstep(0.6, 0.68, lambert) * smoothstep(0.82, 0.97, n);
  base += cream * hi * 0.5;

  // Inner glow: brightens toward the core, independent of the noise field.
  float innerGlow = smoothstep(radius, 0.0, d) * 0.35;
  base += uAccentBright * innerGlow;

  base += uAccentBright * fres;
  base *= uBrightness;
  base = saturate3(base, uSaturation);

  vec3 haloColor = saturate3(uAccent, uSaturation) * uBrightness;
  vec3 color = mix(haloColor * 0.5, base, sphereMask);
  float alpha = max(sphereMask, halo * 0.5);

  outColor = vec4(color * alpha, alpha);
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

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  }
  return p;
}

type Params = {
  flow: number;
  rim: number;
  pulseAmp: number;
  pulseFreq: number;
  scale: number;
  brightness: number;
  saturation: number;
};

const TARGETS: Record<OrbState, Params> = {
  idle: { flow: 0.35, rim: 0.55, pulseAmp: 0.03, pulseFreq: 0.2 * Math.PI * 2, scale: 1.0, brightness: 1.0, saturation: 1.0 },
  thinking: { flow: 1.15, rim: 0.95, pulseAmp: 0.05, pulseFreq: 0.55 * Math.PI * 2, scale: 1.02, brightness: 1.18, saturation: 1.08 },
  success: { flow: 0.42, rim: 0.8, pulseAmp: 0.02, pulseFreq: 0.22 * Math.PI * 2, scale: 1.0, brightness: 1.12, saturation: 1.12 },
  error: { flow: 0.22, rim: 0.32, pulseAmp: 0.015, pulseFreq: 0.15 * Math.PI * 2, scale: 0.97, brightness: 0.6, saturation: 0.18 },
};

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0.95, 0.46, 0.22];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export default function LivingOrbGL({ state }: { state: OrbState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return; // static CSS fallback handles this case entirely

    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    let prog: WebGLProgram | null = null;
    try {
      prog = link(gl, VERT, FRAG);
    } catch {
      return; // fall through to CSS fallback
    }
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uLoc = (name: string) => gl.getUniformLocation(prog!, name);
    const locResolution = uLoc('uResolution');
    const locTime = uLoc('uTime');
    const locFlow = uLoc('uFlow');
    const locRim = uLoc('uRim');
    const locPulseAmp = uLoc('uPulseAmp');
    const locPulseFreq = uLoc('uPulseFreq');
    const locScale = uLoc('uScale');
    const locBrightness = uLoc('uBrightness');
    const locSaturation = uLoc('uSaturation');
    const locLight = uLoc('uLight');
    const locAccent = uLoc('uAccent');
    const locAccentBright = uLoc('uAccentBright');
    const locAccentDeep = uLoc('uAccentDeep');

    const cs = getComputedStyle(document.documentElement);
    const accent = hexToRgb(cs.getPropertyValue('--sw-accent') || '#f6a93c');
    const accentBright = hexToRgb(cs.getPropertyValue('--sw-accent-bright') || '#ffcf85');
    const accentDeep = hexToRgb(cs.getPropertyValue('--sw-accent-deep') || '#8a3a10');

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    // Current eased params, lerped toward the state's target every frame.
    const current: Params = { ...TARGETS.idle };
    const pointer = { x: 0, y: 0 };
    let raf = 0, running = false;
    let start = performance.now();
    let last = start;
    let bloomAt = -1; // timestamp of the last transition into 'success'
    let prevState: OrbState = stateRef.current;

    const onPointerMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    window.addEventListener('pointermove', onPointerMove);

    const draw = (t: number) => {
      const dt = Math.max(0, Math.min(0.05, (t - last) / 1000));
      last = t;
      const elapsed = (t - start) / 1000;

      const state = stateRef.current;
      if (state !== prevState) {
        if (state === 'success') bloomAt = t;
        prevState = state;
      }

      const target = TARGETS[state];
      const rate = 1 - Math.exp(-dt / 0.8); // ~800ms ease
      (Object.keys(target) as Array<keyof Params>).forEach((k) => {
        current[k] += (target[k] - current[k]) * rate;
      });

      let scale = current.scale;
      let brightness = current.brightness;
      if (bloomAt >= 0) {
        const bt = (t - bloomAt) / 900;
        if (bt >= 1) {
          bloomAt = -1;
        } else {
          const env = Math.sin(Math.min(1, bt) * Math.PI); // rise then settle, one bloom
          scale += env * 0.12;
          brightness += env * 0.55;
        }
      }

      if (!w || !h) resize();
      gl.uniform2f(locResolution, canvas.width, canvas.height);
      gl.uniform1f(locTime, elapsed);
      gl.uniform1f(locFlow, current.flow);
      gl.uniform1f(locRim, current.rim);
      gl.uniform1f(locPulseAmp, current.pulseAmp);
      gl.uniform1f(locPulseFreq, current.pulseFreq);
      gl.uniform1f(locScale, scale);
      gl.uniform1f(locBrightness, brightness);
      gl.uniform1f(locSaturation, current.saturation);
      gl.uniform2f(locLight, pointer.x, pointer.y);
      gl.uniform3f(locAccent, accent[0], accent[1], accent[2]);
      gl.uniform3f(locAccentBright, accentBright[0], accentBright[1], accentBright[2]);
      gl.uniform3f(locAccentDeep, accentDeep[0], accentDeep[1], accentDeep[2]);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (running) raf = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    const io = new IntersectionObserver(
      ([e]) => {
        running = e.isIntersecting && !document.hidden;
        cancelAnimationFrame(raf);
        if (running) {
          last = performance.now();
          raf = requestAnimationFrame(draw);
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (canvas.getBoundingClientRect().top < window.innerHeight) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPointerMove);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
