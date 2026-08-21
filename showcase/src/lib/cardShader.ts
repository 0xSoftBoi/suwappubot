/**
 * Generative reserve-card shader.
 *
 * Ported from the cloudflare.pay name-reservation card: a single fragment
 * shader with 24 procedural "treatment" branches (satin / brushed / marble /
 * lacquer / weave / etc.), seeded so the same handle always renders the same
 * card. The port keeps the GLSL math untouched (it's the interesting part)
 * and swaps only the four-colour palette pool: Cloudflare orange out,
 * Suwappu's warm/summer tokens in.
 *
 * WebGL1 (not 2): one decorative object on a marketing page doesn't need the
 * GL2 feature set, and gl_FragColor keeps the shader source a near-literal
 * copy of the reference GLSL for easy diffing later.
 */

export const VERTEX_SRC = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Untouched from the reference shader (see scratchpad/shader.glsl) beyond the
// removal of the unused `mouse`->pointer indirection naming.
export const FRAGMENT_SRC = `
precision highp float;

uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform float seed;
uniform float mode;
uniform vec4 variation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform vec3 color4;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + seed);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + 1.0), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.52;
  mat2 r = mat2(.80, -.60, .60, .80);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 7.1; a *= .5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 p = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
  float t = time * .13;
  vec2 mouse = (pointer - .5) * vec2(resolution.x / resolution.y, 1.0);
  p += mouse * .08;
  float s = seed * 9.73;
  float scale = .58 + variation.x * .92;
  vec2 preDomain = p * (.42 + variation.z * .44) + vec2(s, -s);
  vec2 domainWarp = vec2(noise(preDomain), noise(preDomain + 17.31)) - .5;
  p += domainWarp * (.18 + variation.y * .88);
  p.x *= .78 + variation.z * .52;
  float q = fbm(p * scale + vec2(s, -s * .7) + t * (.08 + variation.w * .16));
  float r = fbm(p * (1.02 + variation.z * .52) + q * (.48 + variation.y * .62) + vec2(-t * .12, t * .09));
  float directionAngle = seed * 6.28318 + mode * .47;
  vec2 direction = vec2(cos(directionAngle), sin(directionAngle));
  float sweep = dot(p, direction) * .68 + q * .42 + r * .14 + s;
  float satin = smoothstep(.08, .94, sin(sweep * (3.8 + variation.z * 4.8)) * .5 + .5);
  float treatment;
  float coolFilm = 0.0;
  if (mode < .5) {
    treatment = satin;
  } else if (mode < 1.5) {
    float microflake = noise(floor((p + q * .08) * 18.0) + s);
    treatment = .43 + smoothstep(.54, .94, microflake) * .34;
  } else if (mode < 2.5) {
    treatment = smoothstep(.18, .88, sin((q * 1.4 + r + dot(p,direction) * .18) * 7.0) * .5 + .5);
  } else if (mode < 3.5) {
    treatment = smoothstep(.24, .82, fbm(p * 1.45 + vec2(q * 1.2, -r) + t * .08));
  } else if (mode < 4.5) {
    vec2 facetCell = floor((p + q * .08) * (15.0 + variation.z * 12.0));
    float facet = hash(facetCell + s);
    treatment = .44 + facet * .22 + satin * .09;
  } else if (mode < 5.5) {
    float brushed = sin((dot(p,direction) + r * .1) * 35.0 + s);
    treatment = .52 + brushed * .07 + satin * .13;
  } else if (mode < 6.5) {
    float fold = sin((dot(p,direction) + q * .7) * 8.5 + s);
    treatment = smoothstep(-.4,.92,fold)*.62; coolFilm = smoothstep(.35,.94,fold*.5+.5)*.09;
  } else if (mode < 7.5) {
    float m = sin((p.x*.82+p.y+q*.3)*16.0)*sin((p.x-p.y*.66+r*.2)*13.0);
    treatment = .52 + m * .11;
  } else if (mode < 8.5) {
    treatment = .48 + sin((p.y + q*.5) * 11.0 + s) * .17;
  } else if (mode < 9.5) {
    vec2 perpendicular = vec2(-direction.y, direction.x);
    float pleat = sin(dot(p,direction)*18.0 + sin(dot(p,perpendicular)*4.0)*1.5+s);
    treatment = .51 + pleat * .14;
  } else if (mode < 10.5) {
    float warp = fbm(p*2.1 + vec2(r,-q)*1.6);
    treatment = smoothstep(.2,.84,warp);
  } else if (mode < 11.5) {
    float ribbon = sin((dot(p,direction)+q*1.15+r*.35)*6.5+s);
    treatment = .47 + ribbon * .19;
  } else if (mode < 12.5) {
    float weave = sin((p.x+q*.12)*24.0)*sin((p.y+r*.12)*22.0);
    treatment = .53 + weave * .07;
  } else if (mode < 13.5) {
    float directionalFlare = smoothstep(-.72,.88,dot(p,direction)+q*.32);
    treatment = .38 + directionalFlare * .42; coolFilm = directionalFlare * .055;
  } else if (mode < 14.5) {
    float broken = sin((floor((q+r)*8.0)/8.0 + dot(p,direction)) * 10.0);
    treatment = .51 + broken * .12;
  } else if (mode < 15.5) {
    float cloud = fbm(p*.82 + vec2(q,-r)*.6 + t*.035);
    treatment = .38 + smoothstep(.2,.82,cloud) * .38;
  } else if (mode < 16.5) {
    float hammered = noise(p * (7.0 + variation.z * 5.0) + vec2(q,r));
    treatment = .40 + smoothstep(.24,.84,hammered) * .34;
  } else if (mode < 17.5) {
    float row = mod(floor((p.y + 2.0) * 8.0), 2.0);
    float herringbone = sin((p.x * (row * 2.0 - 1.0) + p.y * .72) * 19.0 + s);
    treatment = .51 + herringbone * .13;
  } else if (mode < 18.5) {
    float frost = noise(p * 4.8 + q * 1.7 + s);
    treatment = .37 + smoothstep(.18,.88,frost) * .42; coolFilm = frost * .045;
  } else if (mode < 19.5) {
    float lattice = sin((p.x+p.y+q*.18)*18.0) * sin((p.x-p.y+r*.16)*7.0);
    treatment = .51 + lattice * .12;
  } else if (mode < 20.5) {
    float flame = fbm(vec2(p.x * 1.45 + q * .4, p.y * .58 - t * .06) + vec2(r,-q));
    treatment = .35 + smoothstep(.16,.86,flame) * .46;
  } else if (mode < 21.5) {
    vec2 tessera = floor((p + vec2(q,-r)*.07) * vec2(18.0,24.0));
    treatment = .44 + hash(tessera + s) * .23;
  } else if (mode < 22.5) {
    float marble = fbm(p * 1.7 + vec2(q,-r) * 2.1 + t * .025);
    treatment = .35 + smoothstep(.12,.9,marble) * .46;
  } else {
    float lacquer = sin((p.y + q*.24) * 29.0 + sin(p.x*3.0+s));
    treatment = .52 + lacquer * .08 + satin * .10;
  }
  float shapedTreatment = clamp(.5 + (treatment - .5) * 1.38, 0.0, 1.0);
  float depthRange = .48 + variation.y * .24;
  float materialDepth = clamp(.66 + q * .18 + (shapedTreatment - .5) * depthRange, .46, .99);
  vec3 liftedShadow = mix(color1, color2, .70);
  vec3 col = mix(liftedShadow, color2, materialDepth);
  col = mix(col, color3, max(0.0, shapedTreatment - .54) * (.24 + variation.w * .18));
  vec3 coolPearl = mix(color3, color4, clamp(uv.x + uv.y * .35, 0.0, 1.0));
  col = mix(col, coolPearl, coolFilm * (1.0 + variation.z * .45));
  float pearlMix = sin(sweep * 1.15 + time * .055) * .5 + .5;
  vec3 pearl = mix(color3, color4, pearlMix);
  float interference = smoothstep(.54, .94, satin) * (.085 + r * (.06 + variation.w * .055));
  col = mix(col, pearl, interference);
  float specular = pow(max(0.0, 1.0 - abs(sin(sweep * 2.15))), 11.0 + variation.w * 15.0);
  col += specular * vec3(.28, .23, .17);
  float vignette = 1.0 - smoothstep(.55, 1.45, length(p * vec2(.68, 1.0)));
  col *= .995 + vignette * .015;
  col = pow(col, vec3(.94));
  float grain = hash(gl_FragCoord.xy + fract(time * .1) * 91.0) - .5;
  col += grain * .007;
  gl_FragColor = vec4(col, 1.0);
}
`;

export type Vec3 = [number, number, number];
export type Palette = { color1: Vec3; color2: Vec3; color3: Vec3; color4: Vec3 };

function hexToVec3(hex: string): Vec3 {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Suwappu token pool (see summer-token-vars.css / globals.css --sw-*), used
// as color1 (shadow) -> color2 (base) -> color3 (highlight) -> color4 (cool
// pearl/interference) quadruples. Kept warm/premium — no crypto neon.
const INK = hexToVec3('#17324A');
const MUTED = hexToVec3('#4F6F7F');
const SKY = hexToVec3('#77BFD0');
const SKY_DEEP = hexToVec3('#0B8BC7');
const GREEN = hexToVec3('#2F8F5B');
const PERSIMMON = hexToVec3('#E58D2B');
const BUTTER = hexToVec3('#F4C963');
const ACCENT = hexToVec3('#0EA5E9');
const ACCENT_LIGHT = hexToVec3('#38BDF8');
const ACCENT_DEEP = hexToVec3('#0284C7');
const FLOWER_SOFT = hexToVec3('#F7D5DF');
const FLOWER_MIST = hexToVec3('#EDDDE9');
const PETAL_BLUSH = hexToVec3('#E9BFD0');
const CANVAS_WARM = hexToVec3('#FFF8ED');
const CANVAS_COOL = hexToVec3('#EDF8FB');

/** 12 curated on-brand palettes. Seed picks one; the shader does the rest. */
export const PALETTES: Palette[] = [
  { color1: INK, color2: SKY_DEEP, color3: BUTTER, color4: ACCENT_LIGHT },
  { color1: INK, color2: PERSIMMON, color3: BUTTER, color4: CANVAS_WARM },
  { color1: INK, color2: GREEN, color3: BUTTER, color4: SKY },
  { color1: MUTED, color2: SKY, color3: CANVAS_WARM, color4: ACCENT_DEEP },
  { color1: INK, color2: ACCENT_DEEP, color3: ACCENT_LIGHT, color4: CANVAS_COOL },
  { color1: INK, color2: MUTED, color3: PERSIMMON, color4: FLOWER_SOFT },
  { color1: INK, color2: GREEN, color3: SKY, color4: CANVAS_COOL },
  { color1: MUTED, color2: PERSIMMON, color3: BUTTER, color4: PETAL_BLUSH },
  { color1: INK, color2: SKY_DEEP, color3: PERSIMMON, color4: FLOWER_MIST },
  { color1: INK, color2: ACCENT, color3: BUTTER, color4: ACCENT_LIGHT },
  { color1: MUTED, color2: GREEN, color3: CANVAS_WARM, color4: SKY },
  { color1: INK, color2: PERSIMMON, color3: SKY, color4: CANVAS_COOL },
];

/** Deterministic 32-bit PRNG (mulberry32). Same seed -> same stream, always. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CardParams {
  mode: number; // 0..23, selects the shader treatment branch
  variation: [number, number, number, number];
  palette: Palette;
}

/** Derives stable shader parameters from the API's `seed`. Same seed, same card, forever. */
export function deriveCardParams(seed: number): CardParams {
  const rand = mulberry32(seed);
  const mode = Math.floor(rand() * 24);
  const variation: [number, number, number, number] = [rand(), rand(), rand(), rand()];
  const palette = PALETTES[Math.floor(rand() * PALETTES.length)];
  return { mode, variation, palette };
}

/** CSS fallback gradient (WebGL unavailable / shader compile failure) built from the same palette. */
export function paletteToCssGradient(p: Palette): string {
  const c = (v: Vec3) => `rgb(${Math.round(v[0] * 255)}, ${Math.round(v[1] * 255)}, ${Math.round(v[2] * 255)})`;
  return `linear-gradient(155deg, ${c(p.color1)} 0%, ${c(p.color2)} 45%, ${c(p.color3)} 78%, ${c(p.color4)} 100%)`;
}
