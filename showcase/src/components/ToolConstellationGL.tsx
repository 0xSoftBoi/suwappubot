'use client';

import { useEffect, useRef } from 'react';

/**
 * ToolConstellationGL — ambient figure for the Agents section.
 *
 * Honest data-as-visual: exactly `toolCount` nodes (passed in from
 * MCP_TOOLS.length in page.tsx, so this can never drift from the real tool
 * registry) orbiting one hub, thin connector lines, slow rotation. One
 * remote server, N callable tools — that's the whole MCP surface, drawn
 * literally rather than illustrated abstractly.
 *
 * WebGL2 draws the hub and the orbiting nodes/connectors. A 2D overlay,
 * exactly like ChainSphereGL's, labels a handful of nodes as they swing
 * through the leftmost/rightmost arc — full names for all of them would be
 * noise, but a few in transit read as "these are real tools," not just dots.
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

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export default function ToolConstellationGL({
  className = '',
  toolCount,
  names = [],
  accent = [0.965, 0.663, 0.235] as [number, number, number],
  leaf = [0.42, 0.686, 0.486] as [number, number, number],
}: {
  className?: string;
  toolCount: number;
  names?: string[];
  accent?: [number, number, number];
  leaf?: [number, number, number];
}) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = glRef.current, ov = ovRef.current;
    if (!cv || !ov) return;
    const gl = cv.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    const octx = ov.getContext('2d');
    if (!gl || !octx) return;

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
      ov.width = Math.floor(w * dpr);
      ov.height = Math.floor(h * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gl.viewport(0, 0, cv.width, cv.height);
    };

    // Fixed angular seats and radii, laid out once — only the rotation moves.
    const seats = Array.from({ length: toolCount }, (_, i) => {
      const a = i * GOLDEN;
      // Two loose rings so nodes don't all sit on one circle.
      const ring = i % 3 === 0 ? 0.62 : i % 3 === 1 ? 0.82 : 1.0;
      return { a, ring, name: names[i] };
    });

    const lineData = new Float32Array(toolCount * 2 * 7);
    const pointData = new Float32Array((toolCount + 1) * 7); // +1 for the hub

    const draw = (t: number) => {
      if (!ok || !w || !h) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      octx.clearRect(0, 0, w, h);

      const spin = reduce ? 0.6 : t * 0.00006;
      const cx = w * 0.5, cy = h * 0.5;
      const maxR = Math.min(w, h) * 0.46;

      let li = 0;
      const hubO = 0;
      pointData[hubO] = cx; pointData[hubO + 1] = cy;
      pointData[hubO + 2] = accent[0]; pointData[hubO + 3] = accent[1]; pointData[hubO + 4] = accent[2];
      pointData[hubO + 5] = 0.8; pointData[hubO + 6] = 6 * dpr;

      octx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      octx.textBaseline = 'middle';

      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        const ang = s.a + spin;
        const r = s.ring * maxR;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r * 0.58; // flattened ellipse, reads as an orbit not a wheel

        const lo = li * 7;
        lineData[lo] = cx; lineData[lo + 1] = cy;
        lineData[lo + 2] = leaf[0]; lineData[lo + 3] = leaf[1]; lineData[lo + 4] = leaf[2];
        lineData[lo + 5] = 0.16; lineData[lo + 6] = 1;
        lineData[lo + 7] = x; lineData[lo + 8] = y;
        lineData[lo + 9] = leaf[0]; lineData[lo + 10] = leaf[1]; lineData[lo + 11] = leaf[2];
        lineData[lo + 12] = 0.05; lineData[lo + 13] = 1;
        li++;

        const po = (i + 1) * 7;
        pointData[po] = x; pointData[po + 1] = y;
        pointData[po + 2] = leaf[0]; pointData[po + 3] = leaf[1]; pointData[po + 4] = leaf[2];
        pointData[po + 5] = 0.72;
        pointData[po + 6] = 4.2 * dpr;

        // Label a node only while it's in the outer third of the visible
        // width — near the leftmost or rightmost swing of the orbit —
        // rather than crowding every seat with text at once.
        if (s.name) {
          const edge = Math.abs(x - cx) / (maxR || 1);
          if (edge > 0.72) {
            const fade = Math.min(1, (edge - 0.72) / 0.28);
            octx.textAlign = x < cx ? 'right' : 'left';
            octx.fillStyle = `rgba(255,255,255,${0.1 + 0.22 * fade})`;
            octx.fillText(s.name, x + (x < cx ? -7 : 7), y);
          }
        }
      }

      gl.bindVertexArray(vaoLine);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufLine);
      gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STREAM_DRAW);
      gl.useProgram(progLine);
      gl.uniform2f(gl.getUniformLocation(progLine, 'uViewport'), cv.width, cv.height);
      gl.drawArrays(gl.LINES, 0, li * 2);

      gl.bindVertexArray(vaoPoint);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPoint);
      gl.bufferData(gl.ARRAY_BUFFER, pointData, gl.STREAM_DRAW);
      gl.useProgram(progPoint);
      gl.uniform2f(gl.getUniformLocation(progPoint, 'uViewport'), cv.width, cv.height);
      gl.drawArrays(gl.POINTS, 0, toolCount + 1);
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
  }, [toolCount, names, accent, leaf]);

  return (
    <div className={`toolconstellation ${className}`} aria-hidden="true">
      <canvas ref={glRef} className="toolconstellation__gl" />
      <canvas ref={ovRef} className="toolconstellation__overlay" />
    </div>
  );
}
