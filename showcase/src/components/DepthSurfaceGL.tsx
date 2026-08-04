'use client';

import { useEffect, useRef } from 'react';

/**
 * DepthSurfaceGL — ambient figure for the HyperLiquid perps section.
 *
 * Depicts an order-book depth profile: two mirrored ridges built from
 * wireframe rows, bids in leaf on the left, asks in faint persimmon on the
 * right, breathing gently like a book that's still quoting. This is
 * abstract texture, not a market feed — no price axis, no numbers, nothing
 * that could be mistaken for a real book. It sits in the section's existing
 * corner-figure slot (.sw__field--top, sized per-section in site.css),
 * beside the copy rather than under it.
 *
 * Same two-tiny-programs WebGL2 approach as QuoteRaceGL: one draw call for
 * the ridge wireframe (LINES), one for the row of book-depth dots (POINTS).
 */

const ROWS = 14;      // depth levels per side
const COLS = 10;      // wireframe segments per row

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
in vec3 aColor;
in float aAlpha;
in float aSize;
uniform vec2 uViewport;
out vec3 vColor;
out float vAlpha;
void main() {
  vec2 clip = (aPos / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const DITHER = `
float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) / 255.0;
}`;

const FRAG_LINE = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
${DITHER}
void main() {
  outColor = vec4(vColor + dither(gl_FragCoord.xy), vAlpha);
}`;

const FRAG_POINT = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
${DITHER}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float edge = smoothstep(0.25, 0.06, r);
  outColor = vec4(vColor + dither(gl_FragCoord.xy), edge * vAlpha);
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

// Deterministic depth-curve shape: steep near mid, long faint tail outward —
// the general silhouette of a real book, without pretending to be one.
function depth(u: number) {
  return Math.pow(1 - u, 1.6);
}

export default function DepthSurfaceGL({
  className = '',
  bid = [0.42, 0.686, 0.486] as [number, number, number],
  ask = [0.965, 0.663, 0.235] as [number, number, number],
}: {
  className?: string;
  bid?: [number, number, number];
  ask?: [number, number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, running = false, w = 0, h = 0, dpr = 1;

    let progLine: WebGLProgram, progPoint: WebGLProgram;
    let vaoLine: WebGLVertexArrayObject, bufLine: WebGLBuffer;
    let vaoPoint: WebGLVertexArrayObject, bufPoint: WebGLBuffer;
    let ok = true;

    try {
      progLine = program(gl, VERT, FRAG_LINE);
      progPoint = program(gl, VERT, FRAG_POINT);

      const setupVAO = (prog: WebGLProgram) => {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        const stride = 7 * 4;
        const locPos = gl.getAttribLocation(prog, 'aPos');
        const locCol = gl.getAttribLocation(prog, 'aColor');
        const locAlpha = gl.getAttribLocation(prog, 'aAlpha');
        const locSize = gl.getAttribLocation(prog, 'aSize');
        gl.enableVertexAttribArray(locPos);
        gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(locCol);
        gl.vertexAttribPointer(locCol, 3, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(locAlpha);
        gl.vertexAttribPointer(locAlpha, 1, gl.FLOAT, false, stride, 20);
        gl.enableVertexAttribArray(locSize);
        gl.vertexAttribPointer(locSize, 1, gl.FLOAT, false, stride, 24);
        gl.bindVertexArray(null);
        return { vao, buf };
      };

      ({ vao: vaoLine, buf: bufLine } = setupVAO(progLine));
      ({ vao: vaoPoint, buf: bufPoint } = setupVAO(progPoint));

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } catch {
      ok = false;
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      if (!w || !h) return;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
    };

    // Two horizontal wireframe ridges (COLS segments each = COLS+1 verts,
    // ROWS rows per side, one shared mid-line where bid and ask meet).
    const lineVerts = ROWS * COLS * 2 * 2; // 2 sides, COLS segments -> COLS lines per row per side
    const lineData = new Float32Array(lineVerts * 7);
    const pointCount = ROWS * 2;
    const pointData = new Float32Array(pointCount * 7);

    const draw = (t: number) => {
      if (!ok || !w || !h) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const time = reduce ? 0 : t * 0.00045;
      const midX = w * 0.5;
      const baseY = h * 0.82;
      const ridgeH = h * 0.7;
      const halfW = w * 0.48;

      let li = 0, pi = 0;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const col = side === 0 ? bid : ask;
        for (let row = 0; row < ROWS; row++) {
          const rowT = row / (ROWS - 1);
          // Each row breathes independently, at a slow, low-amplitude rate —
          // "still quoting", not choppy.
          const wobble = reduce ? 0 : Math.sin(time * 1.3 + row * 0.6 + side * 2.1) * 0.035;
          const rowDepth = depth(rowT) * (1 + wobble);
          const rowAlpha = 0.05 + 0.16 * (1 - rowT);

          let prevX = 0, prevY = 0;
          for (let c = 0; c <= COLS; c++) {
            const u = c / COLS;
            const amp = rowDepth * (1 - u * 0.15);
            const x = midX + sign * (u * halfW);
            const y = baseY - amp * ridgeH * (0.35 + 0.65 * (1 - rowT));

            if (c > 0) {
              const o = li * 7;
              lineData[o] = prevX; lineData[o + 1] = prevY;
              lineData[o + 2] = col[0]; lineData[o + 3] = col[1]; lineData[o + 4] = col[2];
              lineData[o + 5] = rowAlpha; lineData[o + 6] = 1;
              lineData[o + 7] = x; lineData[o + 8] = y;
              lineData[o + 9] = col[0]; lineData[o + 10] = col[1]; lineData[o + 11] = col[2];
              lineData[o + 12] = rowAlpha; lineData[o + 13] = 1;
              li++;
            }
            prevX = x; prevY = y;
          }

          // A single depth dot near the front of each row, brighter than the
          // wireframe — reads as "resting liquidity" at that level.
          if (row < 6) {
            const u = 0.12;
            const amp = rowDepth * (1 - u * 0.15);
            const x = midX + sign * (u * halfW);
            const y = baseY - amp * ridgeH * (0.35 + 0.65 * (1 - rowT));
            const po = pi * 7;
            pointData[po] = x; pointData[po + 1] = y;
            pointData[po + 2] = col[0]; pointData[po + 3] = col[1]; pointData[po + 4] = col[2];
            pointData[po + 5] = 0.22 + 0.22 * (1 - rowT);
            pointData[po + 6] = 2.2 * dpr;
            pi++;
          }
        }
      }

      gl.bindVertexArray(vaoLine);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufLine);
      gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, li * 2 * 7), gl.STREAM_DRAW);
      gl.useProgram(progLine);
      gl.uniform2f(gl.getUniformLocation(progLine, 'uViewport'), cv.width, cv.height);
      gl.drawArrays(gl.LINES, 0, li * 2);

      gl.bindVertexArray(vaoPoint);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPoint);
      gl.bufferData(gl.ARRAY_BUFFER, pointData.subarray(0, pi * 7), gl.STREAM_DRAW);
      gl.useProgram(progPoint);
      gl.uniform2f(gl.getUniformLocation(progPoint, 'uViewport'), cv.width, cv.height);
      gl.drawArrays(gl.POINTS, 0, pi);
      gl.bindVertexArray(null);

      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(cv);

    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    }, { threshold: 0 });
    io.observe(cv);

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
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [bid, ask]);

  return <canvas ref={ref} className={`depthsurface ${className}`} aria-hidden="true" />;
}
