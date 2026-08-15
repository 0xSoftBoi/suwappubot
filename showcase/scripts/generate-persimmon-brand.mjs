import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const showcaseDir = path.resolve(__dirname, '..');
const publicDir = path.join(showcaseDir, 'public');
const brandDir = path.join(publicDir, 'brand', 'persimmon');
const conceptsDir = path.join(brandDir, 'concepts');

const primaryConceptId = 1;
const socialWidth = 1200;
const socialHeight = 630;

const palettes = [
  {
    name: 'ember',
    body: '#F1662D',
    bodyDark: '#B53B17',
    bodyLight: '#FFB45B',
    flesh: '#FFF3D6',
    fleshShadow: '#F3D18C',
    leaf: '#2F5E34',
    leafLight: '#7AB85B',
    stem: '#4A341D',
    bg: '#120F12',
    bgAlt: '#261B19',
    border: '#4A3025',
    ink: '#FFF7EE',
    shadow: '#160C0D',
  },
  {
    name: 'sunrise',
    body: '#F47B20',
    bodyDark: '#BE4A13',
    bodyLight: '#FFC85A',
    flesh: '#FFF5E1',
    fleshShadow: '#F2DBA4',
    leaf: '#456C2C',
    leafLight: '#98C554',
    stem: '#5D4025',
    bg: '#171116',
    bgAlt: '#2B1B1D',
    border: '#583527',
    ink: '#FFF8F1',
    shadow: '#190D10',
  },
  {
    name: 'mandarin',
    body: '#F05A28',
    bodyDark: '#A93318',
    bodyLight: '#FF9B58',
    flesh: '#FFF1DE',
    fleshShadow: '#EED09F',
    leaf: '#2C653F',
    leafLight: '#75B67A',
    stem: '#463321',
    bg: '#140F13',
    bgAlt: '#22171C',
    border: '#493128',
    ink: '#FFF3EA',
    shadow: '#140C0F',
  },
  {
    name: 'bronze',
    body: '#D86A24',
    bodyDark: '#8F3714',
    bodyLight: '#F8AD57',
    flesh: '#FFF0D8',
    fleshShadow: '#E4C48B',
    leaf: '#3E5B2C',
    leafLight: '#93BF63',
    stem: '#4F321A',
    bg: '#131013',
    bgAlt: '#241C18',
    border: '#46342A',
    ink: '#FFF4EB',
    shadow: '#120B0D',
  },
  {
    name: 'neon',
    body: '#FF6A32',
    bodyDark: '#B33614',
    bodyLight: '#FFB866',
    flesh: '#FFF2DB',
    fleshShadow: '#F0D49E',
    leaf: '#356645',
    leafLight: '#7ECC8B',
    stem: '#4B311C',
    bg: '#111015',
    bgAlt: '#1F1B25',
    border: '#4A3340',
    ink: '#FFF7EF',
    shadow: '#0F0B11',
  },
  {
    name: 'copper',
    body: '#E26D2B',
    bodyDark: '#9F3515',
    bodyLight: '#F6A63B',
    flesh: '#FFF2E0',
    fleshShadow: '#ECCF9A',
    leaf: '#3D6234',
    leafLight: '#8FBA61',
    stem: '#593A20',
    bg: '#120F10',
    bgAlt: '#25191A',
    border: '#4D2F2A',
    ink: '#FFF5EC',
    shadow: '#160C0D',
  },
  {
    name: 'vermillion',
    body: '#F85B1F',
    bodyDark: '#A92B12',
    bodyLight: '#FF9F57',
    flesh: '#FFF0D1',
    fleshShadow: '#F1CF90',
    leaf: '#2E5B38',
    leafLight: '#74B46D',
    stem: '#432C1D',
    bg: '#110F12',
    bgAlt: '#24181A',
    border: '#4B2F27',
    ink: '#FFF8F3',
    shadow: '#150C0E',
  },
  {
    name: 'orchard',
    body: '#E97C2F',
    bodyDark: '#9B421A',
    bodyLight: '#FFBE73',
    flesh: '#FFF6E6',
    fleshShadow: '#E9D4A5',
    leaf: '#47632D',
    leafLight: '#A0C364',
    stem: '#5A3C20',
    bg: '#141012',
    bgAlt: '#221D17',
    border: '#50352B',
    ink: '#FFF6EE',
    shadow: '#160D0D',
  },
  {
    name: 'amber',
    body: '#EB6524',
    bodyDark: '#A13717',
    bodyLight: '#FFAF4A',
    flesh: '#FFF2DA',
    fleshShadow: '#EBCB8F',
    leaf: '#3B6234',
    leafLight: '#89BE6C',
    stem: '#4C341F',
    bg: '#120E11',
    bgAlt: '#261818',
    border: '#4C302A',
    ink: '#FFF5ED',
    shadow: '#140B0D',
  },
  {
    name: 'clay',
    body: '#D95A2C',
    bodyDark: '#8C3018',
    bodyLight: '#F29B62',
    flesh: '#FFF0DE',
    fleshShadow: '#E7C48E',
    leaf: '#325F40',
    leafLight: '#6AB07F',
    stem: '#4A2E1E',
    bg: '#131014',
    bgAlt: '#221822',
    border: '#493148',
    ink: '#FFF7F0',
    shadow: '#130C10',
  },
];

const families = [
  {
    key: 'orchard',
    label: 'Orchard',
    description: 'Whole-fruit silhouettes with a strong calyx and soft volume.',
  },
  {
    key: 'slice',
    label: 'Slice',
    description: 'Whole fruit paired with a cut section to make the persimmon read instantly.',
  },
  {
    key: 'seal',
    label: 'Seal',
    description: 'Badge-driven marks built for app icons, favicons, and avatars.',
  },
  {
    key: 'ribbon',
    label: 'Ribbon',
    description: 'Tech-forward bands and negative-space motion inside the fruit body.',
  },
  {
    key: 'orbit',
    label: 'Orbit',
    description: 'Dynamic rings and sparks around the fruit for a sharper systems feel.',
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(target, contents) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, contents);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fmt(value) {
  return Number.parseFloat(value.toFixed(2));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function attrs(props = {}) {
  return Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ');
}

function empty(name, props) {
  return `<${name} ${attrs(props)} />`;
}

function node(name, props, children = '') {
  return `<${name} ${attrs(props)}>${children}</${name}>`;
}

function leafPath(cx, cy, width, height) {
  const half = width / 2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;
  const shoulder = height * 0.16;

  return [
    `M ${fmt(cx)} ${fmt(top)}`,
    `C ${fmt(cx + half * 0.82)} ${fmt(cy - shoulder)} ${fmt(cx + half * 0.76)} ${fmt(cy + shoulder)} ${fmt(cx)} ${fmt(bottom)}`,
    `C ${fmt(cx - half * 0.76)} ${fmt(cy + shoulder)} ${fmt(cx - half * 0.82)} ${fmt(cy - shoulder)} ${fmt(cx)} ${fmt(top)}`,
    'Z',
  ].join(' ');
}

function dropletPath(cx, cy, width, height) {
  const half = width / 2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;

  return [
    `M ${fmt(cx)} ${fmt(top)}`,
    `C ${fmt(cx + half)} ${fmt(cy - height * 0.12)} ${fmt(cx + half * 0.8)} ${fmt(cy + height * 0.22)} ${fmt(cx)} ${fmt(bottom)}`,
    `C ${fmt(cx - half * 0.8)} ${fmt(cy + height * 0.22)} ${fmt(cx - half)} ${fmt(cy - height * 0.12)} ${fmt(cx)} ${fmt(top)}`,
    'Z',
  ].join(' ');
}

function octagonPoints(size = 320) {
  const inset = size * 0.22;
  const end = 1000 - inset;
  return [
    [500, 180],
    [end, 180 + inset],
    [820, 500],
    [end, end],
    [500, 820],
    [inset, end],
    [180, 500],
    [inset, 180 + inset],
  ]
    .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
    .join(' ');
}

function ticketPath() {
  return [
    'M 240 220',
    'H 760',
    'Q 820 220 820 280',
    'V 418',
    'Q 770 450 770 500',
    'Q 770 550 820 582',
    'V 720',
    'Q 820 780 760 780',
    'H 240',
    'Q 180 780 180 720',
    'V 582',
    'Q 230 550 230 500',
    'Q 230 450 180 418',
    'V 280',
    'Q 180 220 240 220',
    'Z',
  ].join(' ');
}

function bodyPath(style, variant) {
  const left = 230 + (variant % 3) * 8;
  const right = 770 - (variant % 3) * 8;
  const top = 248 + (variant % 2) * 8;
  const bottom = 842 - (variant % 2) * 10;

  if (style === 'round') {
    return [
      `M 500 ${top}`,
      `C ${fmt(670 + variant * 2)} ${top} ${right} ${fmt(362 - variant * 2)} ${right} 556`,
      `C ${right} ${fmt(734 + (variant % 2) * 8)} ${fmt(648 + variant * 2)} ${bottom} 500 ${bottom}`,
      `C ${fmt(352 - variant * 2)} ${bottom} ${left} ${fmt(734 + (variant % 2) * 8)} ${left} 556`,
      `C ${left} ${fmt(362 - variant * 2)} ${fmt(330 - variant * 2)} ${top} 500 ${top}`,
      'Z',
    ].join(' ');
  }

  if (style === 'lantern') {
    return [
      `M 500 ${top}`,
      `C ${fmt(628 + variant)} ${fmt(top + 6)} 748 332 748 486`,
      `C 748 ${fmt(712 + variant * 4)} ${fmt(638 + variant)} ${bottom} 500 ${bottom}`,
      `C ${fmt(362 - variant)} ${bottom} 252 ${fmt(712 + variant * 4)} 252 486`,
      `C 252 332 ${fmt(372 - variant)} ${fmt(top + 6)} 500 ${top}`,
      'Z',
    ].join(' ');
  }

  if (style === 'squircle') {
    const topEdge = top + 44;
    const bottomEdge = bottom - 52;
    return [
      `M 338 ${topEdge}`,
      `Q 338 ${top} 392 ${top}`,
      'H 608',
      `Q 662 ${top} 662 ${topEdge}`,
      `V ${bottomEdge}`,
      `Q 662 ${bottom} 608 ${bottom}`,
      'H 392',
      `Q 338 ${bottom} 338 ${bottomEdge}`,
      'Z',
    ].join(' ');
  }

  if (style === 'drop') {
    return [
      `M 500 ${fmt(top - 8)}`,
      `C ${fmt(624 + variant)} ${fmt(top + 12)} ${fmt(742 + variant)} 320 742 520`,
      `C 742 ${fmt(730 + variant * 3)} ${fmt(626 + variant)} ${bottom} 500 ${bottom}`,
      `C ${fmt(374 - variant)} ${bottom} 258 ${fmt(730 + variant * 3)} 258 520`,
      `C 258 320 ${fmt(376 - variant)} ${fmt(top + 12)} 500 ${fmt(top - 8)}`,
      'Z',
    ].join(' ');
  }

  return [
    `M 500 ${fmt(top - 4)}`,
    `C ${fmt(620 + variant * 2)} ${fmt(top - 4)} 760 330 760 492`,
    `C 760 676 642 ${bottom} 500 ${bottom}`,
    `C 358 ${bottom} 240 676 240 492`,
    `C 240 330 ${fmt(380 - variant * 2)} ${fmt(top - 4)} 500 ${fmt(top - 4)}`,
    'Z',
  ].join(' ');
}

function bodyStylesForFamily(familyKey) {
  if (familyKey === 'orchard') return ['round', 'lantern', 'drop', 'squircle'];
  if (familyKey === 'slice') return ['round', 'lantern', 'drop'];
  if (familyKey === 'seal') return ['squircle', 'stamp', 'round'];
  if (familyKey === 'ribbon') return ['round', 'drop', 'lantern'];
  return ['drop', 'round', 'stamp'];
}

function frameKinds() {
  return ['circle', 'squircle', 'octagon', 'ticket'];
}

function createConcept(family, familyIndex, variant) {
  const id = familyIndex * 10 + variant + 1;
  const number = pad(id);
  const palette = palettes[(id - 1) % palettes.length];
  const styles = bodyStylesForFamily(family.key);
  const frame = frameKinds()[variant % frameKinds().length];
  const leafCount = 4 + ((variant + familyIndex) % 2);

  return {
    id,
    number,
    familyKey: family.key,
    familyLabel: family.label,
    description: family.description,
    palette,
    variant,
    slug: `concept-${number}-${family.key}`,
    bodyStyle: styles[variant % styles.length],
    frameKind: frame,
    leafCount,
    leafAngleOffset: -8 + variant * 2.2,
    leafHeight: 132 + (variant % 4) * 10,
    leafWidth: 82 + (variant % 3) * 12,
    highlightShift: -50 + (variant % 5) * 18,
    bodyOutline: variant % 2 === 0,
    ribbonAngle: -24 + variant * 4,
    orbitAngle: -18 + variant * 6,
    sliceOffsetX: 592 + (variant % 4) * 14,
    sliceOffsetY: 596 + (variant % 3) * 12,
    pulseCount: 2 + (variant % 3),
  };
}

function renderDefs(concept, prefix) {
  const { palette } = concept;

  return [
    '<defs>',
    node(
      'radialGradient',
      { id: `${prefix}-body-grad`, cx: '34%', cy: '28%', r: '78%' },
      [
        empty('stop', { offset: '0%', 'stop-color': palette.bodyLight }),
        empty('stop', { offset: '55%', 'stop-color': palette.body }),
        empty('stop', { offset: '100%', 'stop-color': palette.bodyDark }),
      ].join('')
    ),
    node(
      'linearGradient',
      { id: `${prefix}-leaf-grad`, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
      [
        empty('stop', { offset: '0%', 'stop-color': palette.leafLight }),
        empty('stop', { offset: '100%', 'stop-color': palette.leaf }),
      ].join('')
    ),
    node(
      'linearGradient',
      { id: `${prefix}-flesh-grad`, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
      [
        empty('stop', { offset: '0%', 'stop-color': palette.flesh }),
        empty('stop', { offset: '100%', 'stop-color': palette.fleshShadow }),
      ].join('')
    ),
    node(
      'linearGradient',
      { id: `${prefix}-social-bg`, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
      [
        empty('stop', { offset: '0%', 'stop-color': palette.bg }),
        empty('stop', { offset: '100%', 'stop-color': palette.bgAlt }),
      ].join('')
    ),
    node(
      'clipPath',
      { id: `${prefix}-body-clip` },
      empty('path', { d: bodyPath(concept.bodyStyle, concept.variant) })
    ),
    '</defs>',
  ].join('');
}

function renderCalyx(concept, prefix) {
  const leaves = [];
  const mid = (concept.leafCount - 1) / 2;
  const spread = 68 + (concept.variant % 3) * 8;

  for (let index = 0; index < concept.leafCount; index += 1) {
    const position = index - mid;
    const cx = 500 + position * spread;
    const cy = 262 + Math.abs(position) * 8;
    const angle = position * 24 + concept.leafAngleOffset;

    leaves.push(
      empty('path', {
        d: leafPath(cx, cy, concept.leafWidth, concept.leafHeight),
        fill: `url(#${prefix}-leaf-grad)`,
        stroke: concept.palette.bg,
        'stroke-width': 10,
        transform: `rotate(${fmt(angle)} ${fmt(cx)} ${fmt(cy)})`,
      })
    );
  }

  const stem = empty('path', {
    d: [
      'M 488 210',
      'C 492 188 508 188 512 210',
      'L 522 274',
      'C 524 286 516 298 503 300',
      'L 497 300',
      'C 484 298 476 286 478 274',
      'Z',
    ].join(' '),
    fill: concept.palette.stem,
    stroke: concept.palette.bg,
    'stroke-width': 8,
  });

  const cap = empty('circle', {
    cx: 500,
    cy: 316,
    r: 28,
    fill: concept.palette.leaf,
    stroke: concept.palette.bg,
    'stroke-width': 8,
  });

  return `${leaves.join('')}${stem}${cap}`;
}

function renderBaseFruit(concept, prefix, options = {}) {
  const body = bodyPath(options.bodyStyle || concept.bodyStyle, concept.variant);
  const shadow = empty('ellipse', {
    cx: 500,
    cy: 860,
    rx: 190 + (concept.variant % 3) * 14,
    ry: 44,
    fill: concept.palette.shadow,
    opacity: 0.24,
  });
  const fruit = empty('path', {
    d: body,
    fill: `url(#${prefix}-body-grad)`,
    stroke: concept.bodyOutline || options.forceOutline ? concept.palette.bg : concept.palette.bodyDark,
    'stroke-width': concept.bodyOutline || options.forceOutline ? 18 : 12,
  });
  const shine = empty('ellipse', {
    cx: 430 + concept.highlightShift * 0.28,
    cy: 412 + (concept.variant % 3) * 18,
    rx: 104,
    ry: 128,
    fill: concept.palette.ink,
    opacity: 0.12,
    transform: `rotate(-16 ${fmt(430 + concept.highlightShift * 0.28)} ${fmt(412 + (concept.variant % 3) * 18)})`,
  });

  const ribs = Array.from({ length: 2 + (concept.variant % 3) }, (_, index) => {
    const offset = (index - 1) * 68;
    return empty('path', {
      d: `M ${fmt(500 + offset)} 332 C ${fmt(470 + offset)} 476 ${fmt(470 + offset)} 650 ${fmt(500 + offset)} 780`,
      fill: 'none',
      stroke: concept.palette.bodyDark,
      'stroke-opacity': 0.18,
      'stroke-width': 14,
      'stroke-linecap': 'round',
    });
  }).join('');

  return {
    bodyPath: body,
    mark: `${shadow}${fruit}${shine}${ribs}${renderCalyx(concept, prefix)}`,
  };
}

function renderSlice(concept, prefix) {
  const seedCount = 4 + (concept.variant % 2);
  const seeds = [];
  const radius = 44;

  for (let index = 0; index < seedCount; index += 1) {
    const angle = (-90 + index * (360 / seedCount)) * (Math.PI / 180);
    const seedX = concept.sliceOffsetX + Math.cos(angle) * radius;
    const seedY = concept.sliceOffsetY + Math.sin(angle) * radius;
    const rotation = -28 + index * 16;

    seeds.push(
      empty('path', {
        d: dropletPath(seedX, seedY, 28, 42),
        fill: concept.palette.bodyDark,
        opacity: 0.84,
        transform: `rotate(${rotation} ${fmt(seedX)} ${fmt(seedY)})`,
      })
    );
  }

  return [
    empty('circle', {
      cx: concept.sliceOffsetX,
      cy: concept.sliceOffsetY,
      r: 122,
      fill: `url(#${prefix}-flesh-grad)`,
      stroke: concept.palette.bg,
      'stroke-width': 14,
    }),
    empty('circle', {
      cx: concept.sliceOffsetX,
      cy: concept.sliceOffsetY,
      r: 80,
      fill: concept.palette.flesh,
      opacity: 0.7,
    }),
    seeds.join(''),
  ].join('');
}

function renderFrame(concept) {
  if (concept.frameKind === 'circle') {
    return [
      empty('circle', {
        cx: 500,
        cy: 540,
        r: 340,
        fill: concept.palette.bgAlt,
        stroke: concept.palette.border,
        'stroke-width': 24,
      }),
      empty('circle', {
        cx: 500,
        cy: 540,
        r: 300,
        fill: 'none',
        stroke: concept.palette.ink,
        'stroke-opacity': 0.12,
        'stroke-width': 8,
      }),
    ].join('');
  }

  if (concept.frameKind === 'octagon') {
    return [
      empty('polygon', {
        points: octagonPoints(),
        fill: concept.palette.bgAlt,
        stroke: concept.palette.border,
        'stroke-width': 24,
      }),
      empty('polygon', {
        points: octagonPoints(260),
        fill: 'none',
        stroke: concept.palette.ink,
        'stroke-opacity': 0.12,
        'stroke-width': 8,
      }),
    ].join('');
  }

  if (concept.frameKind === 'ticket') {
    return [
      empty('path', {
        d: ticketPath(),
        fill: concept.palette.bgAlt,
        stroke: concept.palette.border,
        'stroke-width': 24,
      }),
      empty('path', {
        d: ticketPath(),
        fill: 'none',
        stroke: concept.palette.ink,
        'stroke-opacity': 0.12,
        'stroke-width': 8,
      }),
    ].join('');
  }

  return [
    empty('rect', {
      x: 190,
      y: 210,
      width: 620,
      height: 660,
      rx: 172,
      fill: concept.palette.bgAlt,
      stroke: concept.palette.border,
      'stroke-width': 24,
    }),
    empty('rect', {
      x: 232,
      y: 252,
      width: 536,
      height: 576,
      rx: 138,
      fill: 'none',
      stroke: concept.palette.ink,
      'stroke-opacity': 0.12,
      'stroke-width': 8,
    }),
  ].join('');
}

function renderRibbonBands(concept, prefix) {
  const widths = [94, 66, 52];
  return widths
    .slice(0, concept.pulseCount)
    .map((bandWidth, index) =>
      empty('rect', {
        x: 170,
        y: 420 + index * 86,
        width: 660,
        height: bandWidth,
        rx: bandWidth / 2,
        fill: index % 2 === 0 ? concept.palette.flesh : concept.palette.bodyLight,
        opacity: index % 2 === 0 ? 0.92 : 0.64,
        transform: `rotate(${concept.ribbonAngle + index * 6} 500 540)`,
        'clip-path': `url(#${prefix}-body-clip)`,
      })
    )
    .join('');
}

function renderOrbitSystem(concept) {
  return Array.from({ length: 2 + (concept.variant % 3) }, (_, index) => {
    const stroke = index % 2 === 0 ? concept.palette.bodyLight : concept.palette.leafLight;
    const angle = concept.orbitAngle + index * 22;
    const rx = 244 + index * 40;
    const ry = 172 + index * 22;
    const dotX = 500 + rx * Math.cos(((angle + 32) * Math.PI) / 180);
    const dotY = 520 + ry * Math.sin(((angle + 32) * Math.PI) / 180);

    return [
      empty('ellipse', {
        cx: 500,
        cy: 520,
        rx,
        ry,
        fill: 'none',
        stroke,
        'stroke-width': 12 - index * 2,
        'stroke-opacity': 0.5,
        transform: `rotate(${angle} 500 520)`,
      }),
      empty('circle', {
        cx: fmt(dotX),
        cy: fmt(dotY),
        r: 12 - index * 2,
        fill: stroke,
      }),
    ].join('');
  }).join('');
}

function renderFamilyMark(concept, prefix) {
  const base = renderBaseFruit(concept, prefix);

  if (concept.familyKey === 'orchard') {
    return base.mark;
  }

  if (concept.familyKey === 'slice') {
    return `${base.mark}${renderSlice(concept, prefix)}`;
  }

  if (concept.familyKey === 'seal') {
    return `${renderFrame(concept)}<g transform="translate(0 24) scale(0.82 0.82) translate(110 96)">${base.mark}</g>`;
  }

  if (concept.familyKey === 'ribbon') {
    const accent = empty('path', {
      d: `M 324 350 C 430 280 628 276 694 342`,
      fill: 'none',
      stroke: concept.palette.ink,
      'stroke-opacity': 0.25,
      'stroke-width': 18,
      'stroke-linecap': 'round',
    });
    return `${base.mark}${renderRibbonBands(concept, prefix)}${accent}`;
  }

  return `${renderOrbitSystem(concept)}${base.mark}`;
}

function wrapSquareSvg(concept, contents, options = {}) {
  const prefix = `${concept.slug}-${options.mode || 'mark'}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width || 1000}" height="${options.height || 1000}" viewBox="0 0 1000 1000" fill="none">`,
    renderDefs(concept, prefix),
    contents(prefix),
    '</svg>',
  ].join('');
}

function renderLogoSvg(concept) {
  return wrapSquareSvg(concept, (prefix) => renderFamilyMark(concept, prefix), { mode: 'logo' });
}

function renderFaviconSvg(concept, review = true) {
  return wrapSquareSvg(
    concept,
    (prefix) => [
      empty('rect', {
        x: 64,
        y: 64,
        width: 872,
        height: 872,
        rx: 248,
        fill: `url(#${prefix}-social-bg)`,
      }),
      empty('rect', {
        x: 104,
        y: 104,
        width: 792,
        height: 792,
        rx: 212,
        fill: 'none',
        stroke: concept.palette.border,
        'stroke-width': 18,
      }),
      `<g transform="translate(0 28) scale(0.78 0.78) translate(140 120)">${renderFamilyMark(concept, prefix)}</g>`,
      review
        ? node(
            'text',
            {
              x: 150,
              y: 850,
              fill: concept.palette.ink,
              'font-family': 'system-ui, sans-serif',
              'font-size': 52,
              'font-weight': 700,
              'letter-spacing': 4,
            },
            concept.number
          )
        : '',
    ].join(''),
    { mode: 'favicon' }
  );
}

function renderSocialSvg(concept, review = true) {
  const prefix = `${concept.slug}-social`;
  const mark = renderFamilyMark(concept, prefix);
  const reviewCaption = review ? `Persimmon study ${concept.number}` : 'Cross-chain by design';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${socialWidth}" height="${socialHeight}" viewBox="0 0 ${socialWidth} ${socialHeight}" fill="none">`,
    renderDefs(concept, prefix),
    empty('rect', {
      x: 0,
      y: 0,
      width: socialWidth,
      height: socialHeight,
      fill: `url(#${prefix}-social-bg)`,
    }),
    empty('rect', {
      x: 24,
      y: 24,
      width: socialWidth - 48,
      height: socialHeight - 48,
      rx: 36,
      fill: 'none',
      stroke: concept.palette.border,
      'stroke-width': 4,
    }),
    empty('circle', {
      cx: 272,
      cy: 315,
      r: 174,
      fill: concept.palette.bgAlt,
      opacity: 0.96,
      stroke: concept.palette.border,
      'stroke-width': 4,
    }),
    `<g transform="translate(-228 -225) scale(0.5 0.5)">${mark}</g>`,
    node(
      'text',
      {
        x: 500,
        y: 270,
        fill: concept.palette.ink,
        'font-family': 'system-ui, sans-serif',
        'font-size': 84,
        'font-weight': 800,
        'letter-spacing': -2,
      },
      'suwappu'
    ),
    node(
      'text',
      {
        x: 504,
        y: 334,
        fill: concept.palette.bodyLight,
        'font-family': 'system-ui, sans-serif',
        'font-size': 30,
        'font-weight': 700,
        'letter-spacing': 4,
        'text-transform': 'uppercase',
      },
      concept.familyLabel
    ),
    node(
      'text',
      {
        x: 500,
        y: 392,
        fill: concept.palette.ink,
        opacity: 0.84,
        'font-family': 'system-ui, sans-serif',
        'font-size': 28,
        'font-weight': 500,
      },
      reviewCaption
    ),
    node(
      'text',
      {
        x: 500,
        y: 450,
        fill: concept.palette.ink,
        opacity: 0.72,
        'font-family': 'system-ui, sans-serif',
        'font-size': 24,
        'font-weight': 500,
      },
      'Deterministic SVG primitive system for brand exploration'
    ),
    empty('path', {
      d: `M 500 488 H 932`,
      stroke: concept.palette.border,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-opacity': 0.8,
    }),
    review
      ? node(
          'text',
          {
            x: 932,
            y: 558,
            fill: concept.palette.bodyLight,
            opacity: 0.92,
            'text-anchor': 'end',
            'font-family': 'system-ui, sans-serif',
            'font-size': 24,
            'font-weight': 700,
            'letter-spacing': 3,
          },
          `CONCEPT ${concept.number}`
        )
      : '',
    '</svg>',
  ].join('');
}

function galleryHtml(concepts) {
  const cards = concepts
    .map((concept) => {
      const base = `./concepts/${concept.slug}`;
      return `
        <article class="card">
          <header class="card__header">
            <div>
              <p class="card__eyebrow">${concept.familyLabel}</p>
              <h2>${concept.number}</h2>
            </div>
            <div class="swatches">
              <span style="background:${concept.palette.body}"></span>
              <span style="background:${concept.palette.bodyLight}"></span>
              <span style="background:${concept.palette.leaf}"></span>
            </div>
          </header>
          <p class="card__description">${concept.description}</p>
          <div class="preview preview--mark">
            <img src="${base}-mark.svg" alt="Concept ${concept.number} mark" loading="lazy" />
          </div>
          <div class="preview-row">
            <div class="preview preview--favicon">
              <img src="${base}-favicon.svg" alt="Concept ${concept.number} favicon" loading="lazy" />
            </div>
            <div class="preview preview--social">
              <img src="${base}-social.svg" alt="Concept ${concept.number} social card" loading="lazy" />
            </div>
          </div>
          <footer class="card__footer">
            <a href="${base}-mark.svg" target="_blank" rel="noreferrer">Mark</a>
            <a href="${base}-favicon.svg" target="_blank" rel="noreferrer">Favicon</a>
            <a href="${base}-social.svg" target="_blank" rel="noreferrer">Social</a>
          </footer>
        </article>
      `;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Suwappu Persimmon Lab</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #120f12;
        --panel: #1d1719;
        --panel-alt: #241c1f;
        --line: #3a2a29;
        --text: #fff7ee;
        --muted: #c7b6a9;
        --accent: #ffb45b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(255, 180, 91, 0.08), transparent 32%),
          linear-gradient(180deg, #120f12 0%, #0c0a0c 100%);
        color: var(--text);
      }
      main {
        width: min(1600px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 56px;
      }
      header.page {
        display: grid;
        gap: 8px;
        margin-bottom: 28px;
      }
      h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 3.6rem);
        line-height: 1;
      }
      p.lead {
        margin: 0;
        max-width: 820px;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.55;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 8px;
      }
      .meta span {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.03);
        border-radius: 999px;
        padding: 8px 12px;
        color: var(--muted);
        font-size: 0.86rem;
      }
      .grid {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      .card {
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 18px;
        display: grid;
        gap: 14px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18);
      }
      .card__header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
      }
      .card__eyebrow {
        margin: 0 0 4px;
        color: var(--accent);
        font-size: 0.74rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .card h2 {
        margin: 0;
        font-size: 1.7rem;
      }
      .card__description {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
        min-height: 3rem;
      }
      .swatches {
        display: flex;
        gap: 8px;
      }
      .swatches span {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.14);
      }
      .preview {
        border: 1px solid var(--line);
        background: var(--panel-alt);
        border-radius: 18px;
        overflow: hidden;
      }
      .preview img {
        display: block;
        width: 100%;
        height: auto;
      }
      .preview--mark img {
        aspect-ratio: 1;
      }
      .preview-row {
        display: grid;
        gap: 12px;
        grid-template-columns: 92px 1fr;
      }
      .preview--favicon img {
        aspect-ratio: 1;
      }
      .preview--social img {
        aspect-ratio: 1200 / 630;
      }
      .card__footer {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .card__footer a {
        color: var(--text);
        text-decoration: none;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 0.85rem;
      }
      .card__footer a:hover {
        border-color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <header class="page">
        <h1>Persimmon Logo Lab</h1>
        <p class="lead">
          Fifty deterministic SVG logo concepts built from editable primitives, each with a square mark, favicon treatment, and bordered social card. This stays inside the repo, uses no new tooling, and gives us a stable base to prune into a real identity system.
        </p>
        <div class="meta">
          <span>5 families</span>
          <span>50 concepts</span>
          <span>SVG-only</span>
          <span>Editable source in showcase/scripts</span>
        </div>
      </header>
      <section class="grid">
        ${cards}
      </section>
    </main>
  </body>
</html>`;
}

function main() {
  ensureDir(conceptsDir);

  const concepts = families.flatMap((family, familyIndex) =>
    Array.from({ length: 10 }, (_, variant) => createConcept(family, familyIndex, variant))
  );

  for (const concept of concepts) {
    const basePath = path.join(conceptsDir, concept.slug);
    writeFile(`${basePath}-mark.svg`, renderLogoSvg(concept));
    writeFile(`${basePath}-favicon.svg`, renderFaviconSvg(concept));
    writeFile(`${basePath}-social.svg`, renderSocialSvg(concept));
  }

  const primary = concepts.find((concept) => concept.id === primaryConceptId);

  if (!primary) {
    throw new Error(`Primary concept ${primaryConceptId} was not generated.`);
  }

  writeFile(path.join(publicDir, 'favicon.svg'), renderFaviconSvg(primary, false));
  writeFile(path.join(publicDir, 'logo.svg'), renderLogoSvg(primary));
  writeFile(path.join(publicDir, 'social-card.svg'), renderSocialSvg(primary, false));
  writeFile(path.join(brandDir, 'index.html'), galleryHtml(concepts));
  writeFile(
    path.join(brandDir, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        primaryConceptId,
        concepts: concepts.map((concept) => ({
          id: concept.id,
          number: concept.number,
          slug: concept.slug,
          family: concept.familyLabel,
          description: concept.description,
          palette: concept.palette.name,
          files: {
            mark: `./concepts/${concept.slug}-mark.svg`,
            favicon: `./concepts/${concept.slug}-favicon.svg`,
            social: `./concepts/${concept.slug}-social.svg`,
          },
        })),
      },
      null,
      2
    )
  );

  console.log(`Generated ${concepts.length} persimmon concepts in ${brandDir}`);
}

main();
