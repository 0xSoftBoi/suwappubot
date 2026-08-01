/**
 * glkit — the minimum WebGL2 needed for the section objects.
 *
 * One shader, one draw call, N points. Each frame the CPU writes position,
 * size and brightness into a single interleaved buffer and uploads it; the GPU
 * draws the lot additively. That is what buys the glow canvas 2D cannot do
 * cheaply, and it is why these objects can carry thousands of primitives
 * instead of the dozens they had.
 *
 * Deliberately not three.js: this is a few hundred lines against 150KB+, on a
 * marketing page where LCP matters.
 */

export const POINT_VERT = `#version 300 es
precision highp float;

// x, y in CSS px | size in px | brightness 0..1
in vec2  aPos;
in float aSize;
in float aBright;

uniform vec2 uViewport;   // device px
uniform float uDpr;

out float vBright;

void main() {
  vec2 clip = ((aPos * uDpr) / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = max(1.0, aSize * uDpr);
  vBright = aBright;
}`;

export const POINT_FRAG = `#version 300 es
precision highp float;

in float vBright;
uniform vec3 uAccent;
out vec4 outColor;

// Ordered dither. A near-black palette bands visibly at 8-bit and this is the
// cheap fix.
float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) / 320.0;
}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // Soft radial falloff is what reads as glow once blended additively.
  float fall = pow(1.0 - (r2 * 4.0), 1.6);
  float a = fall * vBright;
  outColor = vec4(uAccent * a + dither(gl_FragCoord.xy), a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'compile failed');
  }
  return sh;
}

export function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  }
  return p;
}

/** A growable interleaved point buffer: x, y, size, brightness. */
export class PointBatch {
  data: Float32Array;
  count = 0;
  constructor(public max: number) {
    this.data = new Float32Array(max * 4);
  }
  reset() { this.count = 0; }
  push(x: number, y: number, size: number, bright: number) {
    if (this.count >= this.max) return;
    const o = this.count * 4;
    this.data[o] = x; this.data[o + 1] = y;
    this.data[o + 2] = size; this.data[o + 3] = bright;
    this.count++;
  }
  /** Lay a run of points along a segment. The glow comes from overlap. */
  line(
    x0: number, y0: number, x1: number, y1: number,
    steps: number, size: number, b0: number, b1 = b0
  ) {
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      this.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, size, b0 + (b1 - b0) * u);
    }
  }
}

export const LINE_VERT = `#version 300 es
precision highp float;
in vec2  aPos;
in float aBright;
uniform vec2 uViewport;
uniform float uDpr;
out float vBright;
void main() {
  vec2 clip = ((aPos * uDpr) / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vBright = aBright;
}`;

export const LINE_FRAG = `#version 300 es
precision highp float;
in float vBright;
uniform vec3 uAccent;
out vec4 outColor;
float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) / 320.0;
}
void main() {
  outColor = vec4(uAccent * vBright + dither(gl_FragCoord.xy), vBright);
}`;

/** Interleaved line vertices: x, y, brightness. Drawn as GL_LINES pairs. */
export class LineBatch {
  data: Float32Array;
  count = 0;
  constructor(public max: number) {
    this.data = new Float32Array(max * 3);
  }
  reset() { this.count = 0; }
  private vert(x: number, y: number, b: number) {
    if (this.count >= this.max) return;
    const o = this.count * 3;
    this.data[o] = x; this.data[o + 1] = y; this.data[o + 2] = b;
    this.count++;
  }
  seg(x0: number, y0: number, x1: number, y1: number, b0: number, b1 = b0) {
    this.vert(x0, y0, b0); this.vert(x1, y1, b1);
  }
  /** A polyline from sampled points, brightness ramped along its length. */
  path(pts: Array<{ x: number; y: number }>, b0: number, b1 = b0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
      this.seg(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y,
               b0 + (b1 - b0) * t0, b0 + (b1 - b0) * t1);
    }
  }
}


/* ── Thick, anti-aliased, glowing lines ───────────────────────────────
   GL_LINES is locked to 1px: ALIASED_LINE_WIDTH_RANGE reports [1,1] on
   every modern driver. The fix is to stop using the line primitive and
   expand each segment into a quad in the vertex shader, which is what
   three.js ships Line2/MeshLine to do. Width becomes arbitrary, and the
   fragment shader gets a coordinate across the stroke, which buys both
   anti-aliasing and a soft glow falloff for free.

   Instanced: one unit quad, one draw call, N segments. */

export const RIBBON_VERT = `#version 300 es
precision highp float;

in vec2  aCorner;   // x: 0..1 along segment, y: -1..1 across
in vec4  aSeg;      // p0.xy, p1.xy   (per instance)
in vec3  aStyle;    // width, b0, b1  (per instance)

uniform vec2  uViewport;
uniform float uDpr;

out float vAcross;
out float vBright;

void main() {
  vec2 p0 = aSeg.xy, p1 = aSeg.zw;
  vec2 d = p1 - p0;
  float len = max(length(d), 0.0001);
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);

  // Extend the ends by half a width so joins do not show gaps.
  vec2 along = dir * (aCorner.x * len + (aCorner.x * 2.0 - 1.0) * aStyle.x * 0.5);
  vec2 pos = p0 + along + nrm * aCorner.y * aStyle.x * 0.5;

  vec2 clip = ((pos * uDpr) / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  vAcross = aCorner.y;
  vBright = mix(aStyle.y, aStyle.z, aCorner.x);
}`;

export const RIBBON_FRAG = `#version 300 es
precision highp float;

in float vAcross;
in float vBright;
uniform vec3 uAccent;
out vec4 outColor;

float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) / 320.0;
}

void main() {
  float edge = 1.0 - abs(vAcross);
  // A crisp core with a soft halo: the core reads as the stroke, the halo
  // as the glow once blended additively.
  float core = smoothstep(0.0, 0.55, edge);
  float halo = pow(edge, 2.4);
  float a = vBright * (core * 0.72 + halo * 0.55);
  if (a <= 0.002) discard;
  outColor = vec4(uAccent * a + dither(gl_FragCoord.xy), a);
}`;

/** Per-instance segment buffer: p0.xy, p1.xy, width, b0, b1. */
export class RibbonBatch {
  data: Float32Array;
  count = 0;
  constructor(public max: number) {
    this.data = new Float32Array(max * 7);
  }
  reset() { this.count = 0; }
  seg(x0: number, y0: number, x1: number, y1: number, width: number, b0: number, b1 = b0) {
    if (this.count >= this.max) return;
    const o = this.count * 7;
    const d = this.data;
    d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1;
    d[o + 4] = width; d[o + 5] = b0; d[o + 6] = b1;
    this.count++;
  }
  /** Polyline from sampled points, width and brightness ramped along it. */
  path(
    pts: Array<{ x: number; y: number }>,
    width: number, b0: number, b1 = b0
  ) {
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      this.seg(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, width,
               b0 + (b1 - b0) * t0, b0 + (b1 - b0) * t1);
    }
  }
}

export type GLPoints = {
  gl: WebGL2RenderingContext;
  draw: (batch: PointBatch, viewportW: number, viewportH: number, dpr: number) => void;
  drawLines: (batch: LineBatch, viewportW: number, viewportH: number, dpr: number, width?: number) => void;
  drawRibbons: (batch: RibbonBatch, viewportW: number, viewportH: number, dpr: number) => void;
  dispose: () => void;
};

export function initPoints(
  canvas: HTMLCanvasElement,
  accent: [number, number, number],
  maxPoints: number
): GLPoints | null {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: true, premultipliedAlpha: false,
  });
  if (!gl) return null;

  let prog: WebGLProgram;
  try {
    prog = makeProgram(gl, POINT_VERT, POINT_FRAG);
  } catch {
    return null;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, maxPoints * 4 * 4, gl.DYNAMIC_DRAW);

  const stride = 4 * 4;
  const bind = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  };
  bind('aPos', 2, 0);
  bind('aSize', 1, 8);
  bind('aBright', 1, 12);
  gl.bindVertexArray(null);

  gl.enable(gl.BLEND);
  // Additive: overlapping points accumulate light, and there is no
  // transparency ordering to get wrong.
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  const uViewport = gl.getUniformLocation(prog, 'uViewport');
  const uDpr = gl.getUniformLocation(prog, 'uDpr');
  const uAccent = gl.getUniformLocation(prog, 'uAccent');

  // A separate line pipeline. Lines drawn as GL_LINES are continuous by
  // construction; laying points along a curve only looks continuous if the
  // spacing is tuned below the point size, which is fragile at every zoom.
  let lprog: WebGLProgram;
  try { lprog = makeProgram(gl, LINE_VERT, LINE_FRAG); } catch { return null; }
  const lvao = gl.createVertexArray();
  gl.bindVertexArray(lvao);
  const lbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lbuf);
  gl.bufferData(gl.ARRAY_BUFFER, maxPoints * 3 * 4, gl.DYNAMIC_DRAW);
  const lstride = 3 * 4;
  const lp = gl.getAttribLocation(lprog, 'aPos');
  gl.enableVertexAttribArray(lp);
  gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, lstride, 0);
  const lb = gl.getAttribLocation(lprog, 'aBright');
  gl.enableVertexAttribArray(lb);
  gl.vertexAttribPointer(lb, 1, gl.FLOAT, false, lstride, 8);
  gl.bindVertexArray(null);
  // Quad-expanded lines: the pipeline that actually gives thick strokes.
  let rprog: WebGLProgram;
  try { rprog = makeProgram(gl, RIBBON_VERT, RIBBON_FRAG); } catch { return null; }
  const rvao = gl.createVertexArray();
  gl.bindVertexArray(rvao);
  const cbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const rc = gl.getAttribLocation(rprog, 'aCorner');
  gl.enableVertexAttribArray(rc);
  gl.vertexAttribPointer(rc, 2, gl.FLOAT, false, 0, 0);

  const rbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
  gl.bufferData(gl.ARRAY_BUFFER, maxPoints * 7 * 4, gl.DYNAMIC_DRAW);
  const rstride = 7 * 4;
  const rs = gl.getAttribLocation(rprog, 'aSeg');
  gl.enableVertexAttribArray(rs);
  gl.vertexAttribPointer(rs, 4, gl.FLOAT, false, rstride, 0);
  gl.vertexAttribDivisor(rs, 1);
  const rst = gl.getAttribLocation(rprog, 'aStyle');
  gl.enableVertexAttribArray(rst);
  gl.vertexAttribPointer(rst, 3, gl.FLOAT, false, rstride, 16);
  gl.vertexAttribDivisor(rst, 1);
  gl.bindVertexArray(null);
  const ruViewport = gl.getUniformLocation(rprog, 'uViewport');
  const ruDpr = gl.getUniformLocation(rprog, 'uDpr');
  const ruAccent = gl.getUniformLocation(rprog, 'uAccent');

  const luViewport = gl.getUniformLocation(lprog, 'uViewport');
  const luDpr = gl.getUniformLocation(lprog, 'uDpr');
  const luAccent = gl.getUniformLocation(lprog, 'uAccent');

  return {
    gl,
    draw(batch, vw, vh, dpr) {
      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!batch.count) return;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, vw, vh);
      gl.uniform1f(uDpr, dpr);
      gl.uniform3fv(uAccent, accent);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.count * 4));
      gl.drawArrays(gl.POINTS, 0, batch.count);
      gl.bindVertexArray(null);
    },
    drawLines(batch, vw, vh, dpr, width = 1) {
      if (!batch.count) return;
      gl.useProgram(lprog);
      gl.uniform2f(luViewport, vw, vh);
      gl.uniform1f(luDpr, dpr);
      gl.uniform3fv(luAccent, accent);
      gl.lineWidth(width);   // most drivers clamp to 1; density carries weight
      gl.bindVertexArray(lvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, lbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.count * 3));
      gl.drawArrays(gl.LINES, 0, batch.count);
      gl.bindVertexArray(null);
    },
    drawRibbons(batch, vw, vh, dpr) {
      if (!batch.count) return;
      // MAX, not ADD. Segments are extended by half a width so joins do not
      // gap, which means adjacent quads overlap; under additive blending that
      // overlap accumulates and the whole stroke saturates to white. MAX
      // takes the brighter of source and destination, so overlap is free.
      gl.blendEquation(gl.MAX);
      gl.useProgram(rprog);
      gl.uniform2f(ruViewport, vw, vh);
      gl.uniform1f(ruDpr, dpr);
      gl.uniform3fv(ruAccent, accent);
      gl.bindVertexArray(rvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.count * 7));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
      gl.bindVertexArray(null);
      gl.blendEquation(gl.FUNC_ADD);   // restore for the glow pass
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
