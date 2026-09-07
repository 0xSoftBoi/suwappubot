'use client';

import { useEffect, useRef } from 'react';

/**
 * QuoteRaceGL — ambient background for the Engine section.
 *
 * Depicts what "Quote" actually does: every routing venue races the same
 * quote in parallel, and one wins. One lane per venue (routerCount, driven
 * from the same stats.generated.json the page's copy uses — never a made-up
 * number), each finishing at its own pace. The winning lane resolves in
 * persimmon; the rest settle into faint leaf once the race is decided.
 *
 * Raw WebGL2, matching ChainSphereGL: two tiny programs (lines for the static
 * lane tracks, points for the travelling quotes), one dynamic buffer per
 * program rebuilt each frame. Nineteen lanes is nothing for the GPU — the
 * buffer rebuild costs more in principle than in practice, and it keeps the
 * per-lane arrival-time math in plain JS where it's easy to read.
 *
 * This sits behind copy, not beside it: opacity is held low and the palette
 * quiet on purpose, so the three step columns stay the thing being read.
 */

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

// Shared dither trick with ChainSphereGL: cheap fix for 8-bit banding on
// near-black, low-alpha fills.
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

// Deterministic per-lane, per-cycle hash — no Math.random, so a screenshot
// or a re-render is reproducible.
function hash(i: number, cycle: number) {
  const s = Math.sin(i * 12.9898 + cycle * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const RACE_MS = 6400;
const PAUSE_MS = 1800;
const PERIOD = RACE_MS + PAUSE_MS;

export default function QuoteRaceGL({
  className = '',
  venues = 19,
  accent = [0.965, 0.663, 0.235] as [number, number, number],
  leaf = [0.42, 0.686, 0.486] as [number, number, number],
}: {
  className?: string;
  venues?: number;
  accent?: [number, number, number];
  leaf?: [number, number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return; // no fallback for this one: it's decorative, not load-bearing

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
        const stride = 7 * 4; // x, y, r, g, b, a, size
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

    const lineData = new Float32Array(venues * 2 * 7);
    const TRACK_DOTS = 30;
    const pointData = new Float32Array(venues * (TRACK_DOTS + 1) * 7);

    const draw = (t: number) => {
      if (!ok || !w || !h) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const cyc = reduce ? 0 : Math.floor(t / PERIOD);
      const tLocal = reduce ? RACE_MS * 0.72 : Math.min(t % PERIOD, RACE_MS);

      const arrivals: number[] = [];
      let winner = 0;
      for (let i = 0; i < venues; i++) {
        arrivals[i] = RACE_MS * (0.45 + 0.55 * hash(i, cyc));
        if (arrivals[i] < arrivals[winner]) winner = i;
      }
      const resolved = tLocal >= arrivals[winner];
      const fadeT = resolved ? Math.min(1, (tLocal - arrivals[winner]) / 700) : 0;

      let pi = 0;
      const padX = w * 0.06, padY = h * 0.14;
      const trackW = w - padX * 2;

      for (let i = 0; i < venues; i++) {
        const y = venues > 1 ? padY + ((h - padY * 2) * i) / (venues - 1) : h / 2;
        const progress = Math.min(1, tLocal / arrivals[i]);
        const eased = 1 - Math.pow(1 - progress, 3);
        const x = padX + trackW * eased;
        const isWinner = i === winner;

        // Static lane track: a hairline, almost invisible, slightly brighter
        // once the winner is decided so the winning row still reads.
        const trackAlpha = isWinner && resolved ? 0.5 : 0.2;
        for (let d = 0; d < TRACK_DOTS; d++) {
          const to = (pi++) * 7;
          const covered = d / (TRACK_DOTS - 1) <= eased;
          pointData[to] = padX + (trackW * d) / (TRACK_DOTS - 1);
          pointData[to + 1] = y;
          const tc = covered && isWinner ? accent : leaf;
          pointData[to + 2] = tc[0]; pointData[to + 3] = tc[1]; pointData[to + 4] = tc[2];
          // The rail behind a quote is brighter than the rail ahead of it, so
          // each lane reads as progress rather than a static dotted line.
          pointData[to + 5] = covered ? trackAlpha : trackAlpha * 0.4;
          pointData[to + 6] = 1.6 * dpr;
        }

        // Travelling quote: persimmon and growing for the winner, leaf and
        // fading out for the field once the race is decided.
        const col = isWinner ? accent : leaf;
        let alpha: number, size: number;
        if (isWinner) {
          alpha = resolved ? 0.95 + 0.05 * Math.sin(t * 0.0016) : 0.5 + 0.45 * eased;
          size = (resolved ? 5.6 : 3.6 + 1.6 * eased) * dpr;
        } else {
          alpha = (0.72 - 0.42 * fadeT);
          size = 3.2 * dpr;
        }

        const po = (pi++) * 7;
        pointData[po] = x; pointData[po + 1] = y;
        pointData[po + 2] = col[0]; pointData[po + 3] = col[1]; pointData[po + 4] = col[2];
        pointData[po + 5] = Math.max(0, alpha);
        pointData[po + 6] = size;
      }


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
  }, [venues, accent, leaf]);

  return <canvas ref={ref} className={`quoterace ${className}`} aria-hidden="true" />;
}
