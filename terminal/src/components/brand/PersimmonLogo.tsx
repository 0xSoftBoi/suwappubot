import { useId } from 'react'

export type PersimmonPaletteName =
  | 'ember'
  | 'sunrise'
  | 'mandarin'
  | 'bronze'
  | 'neon'
  | 'butter'

export type PersimmonShell =
  | 'round'
  | 'lantern'
  | 'drop'
  | 'squircle'
  | 'fuyu'
  | 'hachiya'
  | 'fan'
  | 'crest'
  | 'coin'
export type PersimmonVariant = 'orchard' | 'slice' | 'seal' | 'ribbon' | 'orbit' | 'pair'
export type PersimmonFrame = 'none' | 'circle' | 'squircle' | 'octagon' | 'ticket'
export type PersimmonCutoutMode = 'none' | 'xor' | 'nor'
export type PersimmonKanaMode = 'both' | 'katakana' | 'hiragana'
export type PersimmonSwapStyle = 'badge' | 'orbit' | 'stream'

interface PersimmonPalette {
  body: string
  bodyDark: string
  bodyLight: string
  flesh: string
  fleshShadow: string
  leaf: string
  leafLight: string
  stem: string
  bg: string
  bgAlt: string
  border: string
  ink: string
  shadow: string
}

const palettes: Record<PersimmonPaletteName, PersimmonPalette> = {
  ember: {
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
  sunrise: {
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
  mandarin: {
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
  bronze: {
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
  neon: {
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
  butter: {
    body: '#E2A243',
    bodyDark: '#9B5D25',
    bodyLight: '#F6D77A',
    flesh: '#FFF5E7',
    fleshShadow: '#DDB784',
    leaf: '#6C543C',
    leafLight: '#B49A72',
    stem: '#5A4130',
    bg: '#FFFFFF',
    bgAlt: '#FFFFFF',
    border: '#D8C8A6',
    ink: '#2F221A',
    shadow: '#B69C77',
  },
}

const jpFontFamily = "'Hiragino Sans', 'Yu Gothic', 'YuGothic', 'Noto Sans JP', system-ui, sans-serif"

const stickerCalyxPetals = [
  { cx: 392, cy: 282, width: 238, height: 74, rotation: -64 },
  { cx: 500, cy: 228, width: 182, height: 118, rotation: 0 },
  { cx: 608, cy: 282, width: 238, height: 74, rotation: 64 },
  { cx: 500, cy: 340, width: 196, height: 130, rotation: 180 },
]

function fmt(value: number) {
  return Number.parseFloat(value.toFixed(2))
}

function leafPath(cx: number, cy: number, width: number, height: number) {
  const half = width / 2
  const top = cy - height / 2
  const bottom = cy + height / 2
  const shoulder = height * 0.16

  return [
    `M ${fmt(cx)} ${fmt(top)}`,
    `C ${fmt(cx + half * 0.82)} ${fmt(cy - shoulder)} ${fmt(cx + half * 0.76)} ${fmt(cy + shoulder)} ${fmt(cx)} ${fmt(bottom)}`,
    `C ${fmt(cx - half * 0.76)} ${fmt(cy + shoulder)} ${fmt(cx - half * 0.82)} ${fmt(cy - shoulder)} ${fmt(cx)} ${fmt(top)}`,
    'Z',
  ].join(' ')
}

function capsulePath(x: number, y: number, width: number, height: number) {
  const r = height / 2

  return [
    `M ${fmt(x + r)} ${fmt(y)}`,
    `H ${fmt(x + width - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + width)} ${fmt(y + r)}`,
    `V ${fmt(y + height - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + width - r)} ${fmt(y + height)}`,
    `H ${fmt(x + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + height - r)}`,
    `V ${fmt(y + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)}`,
    'Z',
  ].join(' ')
}

function circlePath(cx: number, cy: number, r: number) {
  return [
    `M ${fmt(cx - r)} ${fmt(cy)}`,
    `A ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}`,
    `A ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}`,
    'Z',
  ].join(' ')
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  return [
    `M ${fmt(cx - rx)} ${fmt(cy)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}`,
    'Z',
  ].join(' ')
}

function octagonPoints(size = 320) {
  const inset = size * 0.22
  const end = 1000 - inset

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
    .join(' ')
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
  ].join(' ')
}

function bodyPath(shell: PersimmonShell) {
  if (shell === 'round') {
    return [
      'M 500 248',
      'C 676 248 770 362 770 556',
      'C 770 734 648 842 500 842',
      'C 352 842 230 734 230 556',
      'C 230 362 324 248 500 248',
      'Z',
    ].join(' ')
  }

  if (shell === 'lantern') {
    return [
      'M 500 258',
      'C 638 258 748 332 748 486',
      'C 748 724 638 836 500 836',
      'C 362 836 252 724 252 486',
      'C 252 332 362 258 500 258',
      'Z',
    ].join(' ')
  }

  if (shell === 'drop') {
    return [
      'M 500 240',
      'C 626 252 742 326 742 520',
      'C 742 730 624 848 500 848',
      'C 376 848 258 730 258 520',
      'C 258 326 374 252 500 240',
      'Z',
    ].join(' ')
  }

  if (shell === 'fuyu') {
    return [
      'M 258 414',
      'C 294 352 386 318 500 318',
      'C 614 318 706 352 742 414',
      'C 772 462 786 520 776 590',
      'C 756 708 644 802 500 812',
      'C 356 802 244 708 224 590',
      'C 214 520 228 462 258 414',
      'Z',
    ].join(' ')
  }

  if (shell === 'hachiya') {
    return [
      'M 500 242',
      'C 664 252 758 364 740 530',
      'C 718 718 618 850 500 864',
      'C 382 850 282 718 260 530',
      'C 242 364 336 252 500 242',
      'Z',
    ].join(' ')
  }

  if (shell === 'fan') {
    return [
      'M 500 258',
      'C 696 258 816 352 776 500',
      'C 734 668 644 826 500 840',
      'C 356 826 266 668 224 500',
      'C 184 352 304 258 500 258',
      'Z',
    ].join(' ')
  }

  if (shell === 'crest') {
    return [
      'M 276 394',
      'C 320 340 404 306 500 304',
      'C 596 306 680 340 724 394',
      'C 760 444 776 510 768 592',
      'C 750 716 638 814 500 822',
      'C 362 814 250 716 232 592',
      'C 224 510 240 444 276 394',
      'Z',
    ].join(' ')
  }

  if (shell === 'coin') {
    return [
      'M 278 422',
      'C 316 370 398 342 500 342',
      'C 602 342 684 370 722 422',
      'C 748 464 760 516 752 576',
      'C 736 684 634 768 500 776',
      'C 366 768 264 684 248 576',
      'C 240 516 252 464 278 422',
      'Z',
    ].join(' ')
  }

  return [
    'M 338 292',
    'Q 338 248 392 248',
    'H 608',
    'Q 662 248 662 292',
    'V 790',
    'Q 662 842 608 842',
    'H 392',
    'Q 338 842 338 790',
    'Z',
  ].join(' ')
}

function renderFrame(frame: PersimmonFrame, palette: PersimmonPalette) {
  if (frame === 'none') return null

  if (frame === 'circle') {
    return (
      <>
        <circle cx="500" cy="540" r="340" fill={palette.bgAlt} stroke={palette.border} strokeWidth="24" />
        <circle cx="500" cy="540" r="300" fill="none" stroke={palette.ink} strokeOpacity="0.12" strokeWidth="8" />
      </>
    )
  }

  if (frame === 'octagon') {
    return (
      <>
        <polygon points={octagonPoints()} fill={palette.bgAlt} stroke={palette.border} strokeWidth="24" />
        <polygon points={octagonPoints(260)} fill="none" stroke={palette.ink} strokeOpacity="0.12" strokeWidth="8" />
      </>
    )
  }

  if (frame === 'ticket') {
    return (
      <>
        <path d={ticketPath()} fill={palette.bgAlt} stroke={palette.border} strokeWidth="24" />
        <path d={ticketPath()} fill="none" stroke={palette.ink} strokeOpacity="0.12" strokeWidth="8" />
      </>
    )
  }

  return (
    <>
      <rect x="190" y="210" width="620" height="660" rx="172" fill={palette.bgAlt} stroke={palette.border} strokeWidth="24" />
      <rect x="232" y="252" width="536" height="576" rx="138" fill="none" stroke={palette.ink} strokeOpacity="0.12" strokeWidth="8" />
    </>
  )
}

function renderCutouts(mode: PersimmonCutoutMode, idPrefix: string) {
  if (mode === 'none') return null

  if (mode === 'xor') {
    const xorPath = [
      circlePath(438, 536, 112),
      circlePath(562, 536, 112),
      capsulePath(360, 446, 280, 92),
    ].join(' ')

    return (
      <path
        d={xorPath}
        fill="black"
        fillRule="evenodd"
        clipPath={`url(#${idPrefix}-body-clip)`}
      />
    )
  }

  return (
    <g clipPath={`url(#${idPrefix}-body-clip)`} fill="black">
      <path d={capsulePath(292, 458, 420, 88)} transform="rotate(-16 502 502)" />
      <path d={capsulePath(292, 548, 420, 88)} transform="rotate(16 502 592)" />
      <circle cx="500" cy="550" r="76" />
    </g>
  )
}

function renderContours(shell: PersimmonShell, palette: PersimmonPalette) {
  const contourProps = {
    fill: 'none',
    stroke: palette.bodyDark,
    strokeOpacity: 0.12,
    strokeWidth: 10,
    strokeLinecap: 'round' as const,
  }

  if (shell === 'coin' || shell === 'squircle') {
    return (
      <>
        <path d="M 360 398 C 408 348 454 328 500 326" {...contourProps} strokeOpacity={0.08} />
        <path d="M 640 398 C 592 348 546 328 500 326" {...contourProps} strokeOpacity={0.08} />
      </>
    )
  }

  if (shell === 'hachiya') {
    return (
      <>
        <path d="M 346 394 C 404 332 456 310 500 308" {...contourProps} />
        <path d="M 654 394 C 596 332 544 310 500 308" {...contourProps} />
        <path d="M 430 354 C 464 332 488 324 500 324" {...contourProps} strokeOpacity={0.08} />
      </>
    )
  }

  return (
    <>
      <path d="M 334 402 C 392 344 448 318 500 316" {...contourProps} strokeOpacity={0.08} />
      <path d="M 666 402 C 608 344 552 318 500 316" {...contourProps} strokeOpacity={0.08} />
    </>
  )
}

interface TokenPairBadgeProps {
  colors: PersimmonPalette
  leftGlyph: string
  rightGlyph: string
  scale?: number
  x?: number
  y?: number
}

function renderSwapTokenLabel(label: string, x: number, y: number, colors: PersimmonPalette) {
  const compactLabel = label.trim()
  const upper = compactLabel.toUpperCase()
  const isCircleYen = upper === 'CIRCLEYEN'
  const isUsdc = upper === 'USDC'
  const isLong = compactLabel.length > 5

  if (isUsdc) {
    return (
      <g transform={`translate(${x} ${y - 9})`}>
        <circle cx="0" cy="0" r="18" fill={colors.bodyDark} opacity="0.1" />
        <path
          d="M 0 -16 C 7 -16 12 -12 14 -6"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M 0 16 C -7 16 -12 12 -14 6"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M 0 -11 V 11"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M 6 -7 C 4 -9 1 -10 -2 -10 C -7 -10 -9 -8 -9 -5 C -9 -2 -7 -1 -1 1 C 5 3 7 4 7 8 C 7 11 4 13 0 13 C -4 13 -7 12 -10 9"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }

  if (isCircleYen) {
    return (
      <g transform={`translate(${x} ${y - 9})`}>
        <circle cx="0" cy="0" r="18" fill={colors.bodyDark} opacity="0.1" />
        <path
          d="M 0 -16 C 7 -16 12 -12 14 -6"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M 0 16 C -7 16 -12 12 -14 6"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M -8 -9 L 0 1 L 8 -9"
          fill="none"
          stroke={colors.ink}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M -6 1 H 6" fill="none" stroke={colors.ink} strokeWidth="3" strokeLinecap="round" />
        <path d="M -5 6 H 5" fill="none" stroke={colors.ink} strokeWidth="3" strokeLinecap="round" />
        <path d="M 0 1 V 13" fill="none" stroke={colors.ink} strokeWidth="3" strokeLinecap="round" />
      </g>
    )
  }

  return (
    <text
      x={x}
      y={y}
      fill={colors.ink}
      textAnchor="middle"
      fontFamily={jpFontFamily}
      fontSize={isLong ? 12 : compactLabel.length > 3 ? 15 : 24}
      fontWeight="800"
      letterSpacing={isLong ? 0.4 : compactLabel.length > 3 ? 0.2 : 0}
    >
      {upper}
    </text>
  )
}

function TokenPairBadge({
  colors,
  leftGlyph,
  rightGlyph,
  scale = 1,
  x = 0,
  y = 0,
}: TokenPairBadgeProps) {
  return (
    <g transform={`translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})`}>
      <g transform="translate(102 76)" opacity="0.88">
        {[0, 72, 144, 216, 288].map((rotation) => (
          <g key={rotation} transform={`rotate(${rotation})`}>
            <ellipse
              cx="0"
              cy="-24"
              rx="22"
              ry="32"
              fill={colors.flesh}
              stroke={colors.bgAlt}
              strokeWidth="4"
            />
            <ellipse cx="0" cy="-21" rx="16" ry="22" fill={colors.fleshShadow} opacity="0.34" />
          </g>
        ))}
        <circle cx="0" cy="0" r="13" fill={colors.bodyLight} stroke={colors.flesh} strokeWidth="4" />
      </g>
      <path
        d="M 20 42 C 58 10 136 8 182 34"
        fill="none"
        stroke={colors.bodyLight}
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <path
        d="M 182 118 C 138 146 68 148 20 114"
        fill="none"
        stroke={colors.leafLight}
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <path
        d="M 166 16 L 194 20 L 182 40 L 188 46 L 208 26 L 176 20 Z"
        fill={colors.bodyLight}
      />
      <path
        d="M 44 136 L 14 126 L 26 104 L 18 98 L 0 124 L 34 128 Z"
        fill={colors.leafLight}
      />
      <circle cx="56" cy="88" r="32" fill={colors.bgAlt} stroke={colors.border} strokeWidth="4" />
      <circle cx="148" cy="76" r="32" fill={colors.bgAlt} stroke={colors.border} strokeWidth="4" />
      <circle cx="56" cy="88" r="22" fill={colors.bodyDark} opacity="0.14" />
      <circle cx="148" cy="76" r="22" fill={colors.bodyDark} opacity="0.14" />
      {renderSwapTokenLabel(leftGlyph, 56, 93, colors)}
      {renderSwapTokenLabel(rightGlyph, 148, 81, colors)}
    </g>
  )
}

interface SwapMotifProps extends TokenPairBadgeProps {
  style?: PersimmonSwapStyle
}

function SwapMotif({
  colors,
  leftGlyph,
  rightGlyph,
  scale = 1,
  x = 0,
  y = 0,
  style = 'badge',
}: SwapMotifProps) {
  if (style === 'badge') {
    return (
      <TokenPairBadge
        colors={colors}
        leftGlyph={leftGlyph}
        rightGlyph={rightGlyph}
        scale={scale}
        x={x}
        y={y}
      />
    )
  }

  if (style === 'orbit') {
    return (
      <g transform={`translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})`}>
        <path
          d="M 20 76 C 54 18 144 10 194 48"
          fill="none"
          stroke={colors.bodyLight}
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 192 96 C 156 146 72 154 18 118"
          fill="none"
          stroke={colors.leafLight}
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path d="M 174 28 L 208 34 L 192 60 Z" fill={colors.bodyLight} />
        <path d="M 42 136 L 8 120 L 34 100 Z" fill={colors.leafLight} />
        <circle cx="64" cy="88" r="26" fill={colors.bgAlt} stroke={colors.border} strokeWidth="4" />
        <circle cx="148" cy="78" r="26" fill={colors.bgAlt} stroke={colors.border} strokeWidth="4" />
        <text
          x="64"
          y="97"
          fill={colors.ink}
          textAnchor="middle"
          fontFamily={jpFontFamily}
          fontSize="24"
          fontWeight="800"
        >
          {leftGlyph}
        </text>
        <text
          x="148"
          y="87"
          fill={colors.ink}
          textAnchor="middle"
          fontFamily={jpFontFamily}
          fontSize="24"
          fontWeight="800"
        >
          {rightGlyph}
        </text>
      </g>
    )
  }

  return (
    <g transform={`translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})`}>
      <path
        d="M 22 52 C 64 26 102 22 146 34 C 172 42 188 60 192 84"
        fill="none"
        stroke={colors.bodyLight}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M 184 112 C 144 138 106 142 62 130 C 36 122 20 104 16 80"
        fill="none"
        stroke={colors.leafLight}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path d="M 164 28 L 196 36 L 180 58 Z" fill={colors.bodyLight} />
      <path d="M 46 136 L 12 118 L 38 100 Z" fill={colors.leafLight} />
      <circle cx="58" cy="84" r="16" fill={colors.bgAlt} stroke={colors.border} strokeWidth="4" />
      <circle cx="150" cy="78" r="16" fill={colors.bgAlt} stroke={colors.border} strokeWidth="4" />
      <circle cx="106" cy="92" r="12" fill={colors.bodyDark} opacity="0.16" />
      <text
        x="58"
        y="90"
        fill={colors.ink}
        textAnchor="middle"
        fontFamily={jpFontFamily}
        fontSize="16"
        fontWeight="800"
      >
        {leftGlyph}
      </text>
      <text
        x="150"
        y="84"
        fill={colors.ink}
        textAnchor="middle"
        fontFamily={jpFontFamily}
        fontSize="16"
        fontWeight="800"
      >
        {rightGlyph}
      </text>
    </g>
  )
}

function renderStickerCalyx(colors: PersimmonPalette, calyxGradientId: string) {
  return (
    <g>
      <path
        d={`${ellipsePath(500, 320, 168, 42)} ${ellipsePath(500, 320, 72, 14)}`}
        fill={colors.flesh}
        fillRule="evenodd"
        opacity="0.96"
      />
      <path
        d={`${ellipsePath(500, 320, 126, 28)} ${ellipsePath(500, 320, 66, 12)}`}
        fill={colors.fleshShadow}
        fillRule="evenodd"
        opacity="0.38"
      />
      {stickerCalyxPetals.map((petal, index) => (
        <g
          key={`${petal.cx}-${petal.cy}-${petal.rotation}`}
          transform={`translate(${fmt(petal.cx)} ${fmt(petal.cy)}) rotate(${fmt(petal.rotation)})`}
        >
          <path
            d={leafPath(0, 0, petal.width, petal.height)}
            fill={`url(#${calyxGradientId})`}
            stroke={colors.flesh}
            strokeWidth="16"
            strokeLinejoin="round"
          />
          <path
            d={`M 0 ${fmt(-petal.height / 2 + 12)} C ${fmt(-petal.width * 0.04)} ${fmt(-petal.height * 0.08)} ${fmt(-petal.width * 0.03)} ${fmt(petal.height * 0.12)} 0 ${fmt(petal.height / 2 - 12)}`}
            fill="none"
            stroke={colors.flesh}
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.92"
          />
          <path
            d={`M ${fmt(-petal.width * 0.18)} ${fmt(-petal.height * 0.16)} C ${fmt(-petal.width * 0.1)} ${fmt(-petal.height * 0.02)} ${fmt(-petal.width * 0.08)} ${fmt(petal.height * 0.14)} ${fmt(-petal.width * 0.16)} ${fmt(petal.height * 0.28)}`}
            fill="none"
            stroke={colors.flesh}
            strokeWidth="7"
            strokeLinecap="round"
            opacity="0.82"
          />
          <path
            d={`M ${fmt(petal.width * 0.18)} ${fmt(-petal.height * 0.16)} C ${fmt(petal.width * 0.1)} ${fmt(-petal.height * 0.02)} ${fmt(petal.width * 0.08)} ${fmt(petal.height * 0.14)} ${fmt(petal.width * 0.16)} ${fmt(petal.height * 0.28)}`}
            fill="none"
            stroke={colors.flesh}
            strokeWidth="7"
            strokeLinecap="round"
            opacity="0.82"
          />
          {index === 0 || index === 2 ? (
            <path
              d={`M ${fmt(index === 0 ? -petal.width * 0.3 : petal.width * 0.3)} ${fmt(-petal.height * 0.02)} C ${fmt(index === 0 ? -petal.width * 0.18 : petal.width * 0.18)} ${fmt(petal.height * 0.08)} ${fmt(index === 0 ? -petal.width * 0.16 : petal.width * 0.16)} ${fmt(petal.height * 0.18)} ${fmt(index === 0 ? -petal.width * 0.24 : petal.width * 0.24)} ${fmt(petal.height * 0.3)}`}
              fill="none"
              stroke={colors.flesh}
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.72"
            />
          ) : null}
        </g>
      ))}
      <ellipse cx="500" cy="318" rx="44" ry="14" fill={colors.body} stroke={colors.flesh} strokeWidth="10" />
      <path
        d="M 492 176 C 500 158 510 156 518 170 C 522 176 520 186 518 194 L 514 206 H 488 L 484 194 C 482 186 484 178 492 176 Z"
        fill={colors.fleshShadow}
        stroke={colors.flesh}
        strokeWidth="10"
        strokeLinejoin="round"
      />
    </g>
  )
}

export interface PersimmonStemMotifProps {
  size?: number
  palette?: PersimmonPaletteName
  rotation?: number
  flipX?: boolean
  opacity?: number
}

export function PersimmonStemMotif({
  size = 220,
  palette = 'butter',
  rotation = 0,
  flipX = false,
  opacity = 1,
}: PersimmonStemMotifProps) {
  const id = useId().replaceAll(':', '')
  const colors = palettes[palette]
  const calyxGradientId = `${id}-motif-calyx-grad`

  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" role="img" aria-label="Suwappu stem motif" fill="none">
      <defs>
        <linearGradient id={calyxGradientId} x1="12%" y1="0%" x2="88%" y2="100%">
          <stop offset="0%" stopColor={colors.leafLight} />
          <stop offset="60%" stopColor={colors.leaf} />
          <stop offset="100%" stopColor={colors.stem} />
        </linearGradient>
      </defs>
      <g
        opacity={opacity}
        transform={`translate(500 500) rotate(${fmt(rotation)}) scale(${flipX ? -1 : 1} 1) translate(-500 -500)`}
      >
        {renderStickerCalyx(colors, calyxGradientId)}
      </g>
    </svg>
  )
}

export interface SakuraBloomMotifProps {
  size?: number
  rotation?: number
  opacity?: number
  flipX?: boolean
  tone?: 'soft' | 'mist' | 'sun'
}

export function SakuraBloomMotif({
  size = 180,
  rotation = 0,
  opacity = 1,
  flipX = false,
  tone = 'soft',
}: SakuraBloomMotifProps) {
  const tones = {
    soft: {
      petal: '#f7d5df',
      petalShadow: '#e9bfd0',
      outline: '#fff7fb',
      center: '#f3c46c',
      centerOutline: '#fff6d8',
    },
    mist: {
      petal: '#eddde9',
      petalShadow: '#dcc4d4',
      outline: '#fff9fc',
      center: '#e7c892',
      centerOutline: '#fff5e5',
    },
    sun: {
      petal: '#f3d3cf',
      petalShadow: '#ebb7aa',
      outline: '#fff6f2',
      center: '#f0c95a',
      centerOutline: '#fff4d4',
    },
  } as const

  const colors = tones[tone]

  return (
    <svg width={size} height={size} viewBox="0 0 168 168" role="img" aria-label="Sakura bloom motif" fill="none">
      <g
        opacity={opacity}
        transform={`translate(84 84) rotate(${fmt(rotation)}) scale(${flipX ? -1 : 1} 1)`}
      >
        {[0, 72, 144, 216, 288].map((petalRotation) => (
          <g key={petalRotation} transform={`rotate(${petalRotation})`}>
            <ellipse
              cx="0"
              cy="-28"
              rx="23"
              ry="35"
              fill={colors.petal}
              stroke={colors.outline}
              strokeWidth="5"
            />
            <ellipse
              cx="0"
              cy="-24"
              rx="16"
              ry="24"
              fill={colors.petalShadow}
              opacity="0.24"
            />
          </g>
        ))}
        <circle cx="0" cy="0" r="13" fill={colors.center} stroke={colors.centerOutline} strokeWidth="4" />
      </g>
    </svg>
  )
}

export interface PersimmonMarkProps {
  size?: number
  palette?: PersimmonPaletteName
  variant?: PersimmonVariant
  shell?: PersimmonShell
  frame?: PersimmonFrame
  cutoutMode?: PersimmonCutoutMode
  leafCount?: number
  withGlow?: boolean
  leftGlyph?: string
  rightGlyph?: string
}

export function PersimmonMark({
  size = 240,
  palette = 'ember',
  variant = 'orchard',
  shell = 'round',
  frame = 'none',
  cutoutMode = 'xor',
  leafCount = 4,
  withGlow = true,
  leftGlyph = '¥',
  rightGlyph = '$',
}: PersimmonMarkProps) {
  const id = useId().replaceAll(':', '')
  const colors = palettes[palette]
  const markFrame = variant === 'seal' && frame === 'none' ? 'squircle' : frame
  const iconLikeShell = shell === 'fuyu' || shell === 'coin' || shell === 'crest'
  const body = bodyPath(shell)
  const leafTotal = Math.max(3, Math.min(6, leafCount))
  const maskId = `${id}-fruit-mask`
  const bodyClipId = `${id}-body-clip`
  const bodyGradientId = `${id}-body-grad`
  const fleshGradientId = `${id}-flesh-grad`
  const leafGradientId = `${id}-leaf-grad`
  const calyxGradientId = `${id}-calyx-grad`
  const glowId = `${id}-glow`

  const calyxLeafSpecs = [
    { cx: 402, cy: 286, width: 224, height: 66, rotation: -54 },
    { cx: 500, cy: 238, width: 176, height: 96, rotation: 0 },
    { cx: 598, cy: 286, width: 224, height: 66, rotation: 54 },
    { cx: 500, cy: 330, width: 188, height: 112, rotation: 180 },
    { cx: 448, cy: 316, width: 156, height: 56, rotation: 146 },
    { cx: 552, cy: 316, width: 156, height: 56, rotation: 214 },
  ]
  const calyxOrderByCount: Record<number, number[]> = {
    3: [0, 1, 2],
    4: [0, 1, 2, 3],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
  }

  const leaves = calyxOrderByCount[leafTotal].map((leafIndex) => {
    const spec = calyxLeafSpecs[leafIndex]

    return (
      <path
        key={`${spec.cx}-${spec.cy}-${spec.rotation}`}
        d={leafPath(spec.cx, spec.cy, spec.width, spec.height)}
        fill={`url(#${calyxGradientId})`}
        stroke={colors.bg}
        strokeWidth="12"
        transform={`rotate(${fmt(spec.rotation)} ${fmt(spec.cx)} ${fmt(spec.cy)})`}
      />
    )
  })

  const slice = (
    <g transform="translate(0 6)">
      <circle cx="616" cy="612" r="118" fill={`url(#${fleshGradientId})`} stroke={colors.bg} strokeWidth="14" />
      <circle cx="616" cy="612" r="78" fill={colors.flesh} opacity="0.72" />
      {Array.from({ length: 5 }, (_, index) => {
        const angle = ((-90 + index * 72) * Math.PI) / 180
        const seedX = 616 + Math.cos(angle) * 44
        const seedY = 612 + Math.sin(angle) * 44

        return (
          <path
            key={`${seedX}-${seedY}`}
            d={leafPath(seedX, seedY, 22, 34)}
            fill={colors.bodyDark}
            opacity="0.82"
            transform={`rotate(${index * 22 - 20} ${fmt(seedX)} ${fmt(seedY)})`}
          />
        )
      })}
    </g>
  )

  const ribbons = (
    <g clipPath={`url(#${bodyClipId})`}>
      <path d={capsulePath(210, 430, 580, 92)} fill={colors.flesh} opacity="0.92" transform="rotate(-22 500 476)" />
      <path d={capsulePath(236, 534, 548, 64)} fill={colors.bodyLight} opacity="0.6" transform="rotate(-12 510 566)" />
      <path d={capsulePath(266, 634, 520, 48)} fill={colors.ink} opacity="0.14" transform="rotate(6 526 658)" />
    </g>
  )

  const orbits = (
    <g fill="none">
      <ellipse cx="500" cy="522" rx="284" ry="176" stroke={colors.bodyLight} strokeWidth="12" strokeOpacity="0.5" transform="rotate(-18 500 522)" />
      <ellipse cx="500" cy="522" rx="244" ry="150" stroke={colors.leafLight} strokeWidth="10" strokeOpacity="0.44" transform="rotate(16 500 522)" />
      <circle cx="772" cy="478" r="10" fill={colors.bodyLight} />
      <circle cx="268" cy="646" r="8" fill={colors.leafLight} />
    </g>
  )

  const pairBadge = (
    <g clipPath={`url(#${bodyClipId})`}>
      <ellipse cx="500" cy="548" rx="246" ry="156" fill={colors.bgAlt} opacity="0.18" />
      <TokenPairBadge colors={colors} leftGlyph={leftGlyph} rightGlyph={rightGlyph} x={310} y={446} scale={1.18} />
    </g>
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      role="img"
      aria-label="Suwappu mark"
      fill="none"
    >
      <defs>
        <radialGradient id={bodyGradientId} cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor={colors.bodyLight} />
          <stop offset="58%" stopColor={colors.body} />
          <stop offset="100%" stopColor={colors.bodyDark} />
        </radialGradient>
        <linearGradient id={fleshGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.flesh} />
          <stop offset="100%" stopColor={colors.fleshShadow} />
        </linearGradient>
        <linearGradient id={leafGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.leafLight} />
          <stop offset="100%" stopColor={colors.leaf} />
        </linearGradient>
        <linearGradient id={calyxGradientId} x1="12%" y1="0%" x2="88%" y2="100%">
          <stop offset="0%" stopColor={colors.leafLight} />
          <stop offset="60%" stopColor={colors.leaf} />
          <stop offset="100%" stopColor={colors.stem} />
        </linearGradient>
        <clipPath id={bodyClipId}>
          <path d={body} />
        </clipPath>
        <mask id={maskId}>
          <rect width="1000" height="1000" fill="black" />
          <path d={body} fill="white" />
          {renderCutouts(cutoutMode, id)}
        </mask>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
      </defs>

      {withGlow ? (
        <ellipse
          cx="500"
          cy="596"
          rx="250"
          ry="184"
          fill={colors.body}
          opacity="0.22"
          filter={`url(#${glowId})`}
        />
      ) : null}

      {variant === 'orbit' ? orbits : null}
      {renderFrame(markFrame, colors)}

      <ellipse cx="500" cy="862" rx="194" ry="44" fill={colors.shadow} opacity="0.24" />

      <g mask={`url(#${maskId})`}>
        <path d={body} fill={`url(#${bodyGradientId})`} />
        {iconLikeShell ? (
          <>
            <path
              d={`${ellipsePath(500, 322, 184, 44)} ${ellipsePath(500, 322, 78, 14)}`}
              fill={colors.flesh}
              fillRule="evenodd"
              opacity="0.52"
            />
            <path
              d={`${ellipsePath(500, 324, 132, 24)} ${ellipsePath(500, 324, 74, 10)}`}
              fill={colors.bodyDark}
              fillRule="evenodd"
              opacity="0.18"
            />
            <ellipse cx="382" cy="416" rx="120" ry="124" fill={colors.flesh} opacity="0.12" transform="rotate(-18 382 416)" />
            <path
              d="M 322 362 C 380 326 424 314 470 312"
              fill="none"
              stroke={colors.flesh}
              strokeOpacity="0.24"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              d="M 528 312 C 572 314 620 328 676 364"
              fill="none"
              stroke={colors.flesh}
              strokeOpacity="0.18"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d="M 684 454 C 712 486 714 534 694 578"
              fill="none"
              stroke={colors.bodyDark}
              strokeOpacity="0.1"
              strokeWidth="8"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <path
              d={`${ellipsePath(500, 308, 156, 42)} ${ellipsePath(500, 308, 90, 18)}`}
              fill={colors.shadow}
              fillRule="evenodd"
              opacity="0.22"
            />
            <ellipse cx="500" cy="310" rx="122" ry="32" fill={colors.bodyDark} opacity="0.12" />
            <ellipse cx="500" cy="308" rx="72" ry="12" fill={colors.shadow} opacity="0.22" />
            <ellipse cx="394" cy="418" rx="118" ry="126" fill={colors.ink} opacity="0.11" transform="rotate(-18 394 418)" />
            <ellipse cx="620" cy="430" rx="70" ry="112" fill={colors.bodyLight} opacity="0.08" transform="rotate(12 620 430)" />
            <path
              d="M 642 410 C 688 446 698 506 670 558"
              fill="none"
              stroke={colors.ink}
              strokeOpacity="0.14"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M 618 440 C 640 460 646 496 632 524"
              fill="none"
              stroke={colors.ink}
              strokeOpacity="0.1"
              strokeWidth="8"
              strokeLinecap="round"
            />
          </>
        )}
        {renderContours(shell, colors)}
        {variant === 'ribbon' ? ribbons : null}
        {variant === 'pair' ? pairBadge : null}
      </g>

      {iconLikeShell ? (
        <>
          <path d={body} fill="none" stroke={colors.flesh} strokeWidth="24" strokeLinejoin="round" />
          <path d={body} fill="none" stroke={colors.bodyDark} strokeOpacity="0.18" strokeWidth="6" strokeLinejoin="round" />
        </>
      ) : (
        <path d={body} fill="none" stroke={colors.bg} strokeWidth="18" />
      )}

      {variant === 'slice' ? slice : null}

      {iconLikeShell ? (
        renderStickerCalyx(colors, calyxGradientId)
      ) : (
        <g>
          <path
            d="M 370 308 C 408 276 456 262 500 262 C 544 262 592 276 630 308 C 592 326 548 340 500 340 C 452 340 408 326 370 308 Z"
            fill={colors.leaf}
            stroke={colors.bg}
            strokeWidth="10"
          />
          <ellipse cx="500" cy="308" rx="82" ry="14" fill={colors.leafLight} opacity="0.16" />
          {leaves}
          <rect
            x="468"
            y="206"
            width="68"
            height="66"
            rx="18"
            fill={colors.stem}
            stroke={colors.bg}
            strokeWidth="8"
          />
          <rect
            x="476"
            y="194"
            width="52"
            height="24"
            rx="12"
            fill={colors.stem}
            stroke={colors.bg}
            strokeWidth="8"
          />
          <rect
            x="484"
            y="212"
            width="36"
            height="40"
            rx="12"
            fill={colors.fleshShadow}
            opacity="0.28"
          />
          <ellipse cx="502" cy="286" rx="34" ry="16" fill={colors.leaf} stroke={colors.bg} strokeWidth="8" />
          <ellipse cx="506" cy="282" rx="10" ry="5" fill={colors.leafLight} opacity="0.4" />
        </g>
      )}
    </svg>
  )
}

export interface PersimmonLockupProps extends PersimmonMarkProps {
  width?: number
  label?: string
  strapline?: string
  hiraganaLabel?: string
  katakanaLabel?: string
  showKana?: boolean
  showSwapPair?: boolean
  kanaMode?: PersimmonKanaMode
  swapStyle?: PersimmonSwapStyle
}

export function PersimmonLockup({
  width = 560,
  label = 'suwappu',
  strapline = 'swap pairs by design',
  hiraganaLabel = 'すわっぷ',
  katakanaLabel = 'スワップ',
  showKana = true,
  showSwapPair = true,
  kanaMode = 'both',
  swapStyle = 'badge',
  ...markProps
}: PersimmonLockupProps) {
  const colors = palettes[markProps.palette ?? 'ember']
  const textX = 178
  const pairX = 546
  const pairY = 54
  const pairScale = swapStyle === 'badge' ? 0.48 : swapStyle === 'orbit' ? 0.46 : 0.44
  const pairOpacity = swapStyle === 'badge' ? 0.6 : 0.52
  const straplineLines = strapline
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const displayStraplineLines = straplineLines.map((line) =>
    strapline.includes('\n') || /[,.]/.test(strapline) || strapline.length > 22 ? line : line.toUpperCase()
  )
  const isMultiLineStrapline = displayStraplineLines.length > 1
  const straplineFontSize = isMultiLineStrapline ? 18 : strapline.length > 22 ? 18 : 22
  const straplineLetterSpacing = isMultiLineStrapline ? 2.4 : strapline.length > 22 ? 2.8 : 5
  const straplineY = showKana ? 164 : 160
  const straplineLineHeight = 26

  return (
    <svg width={width} viewBox="0 0 720 260" fill="none" role="img" aria-label="Suwappu lockup">
      <rect x="0" y="0" width="720" height="260" rx="34" fill={colors.bgAlt} />
      <g transform="translate(64 30)">
        <PersimmonMark {...markProps} size={168} withGlow={false} />
      </g>
      {showSwapPair ? (
        <g transform={`translate(${pairX} ${pairY}) scale(${fmt(pairScale)})`} opacity={pairOpacity}>
          <SwapMotif
            colors={colors}
            leftGlyph={markProps.leftGlyph ?? '¥'}
            rightGlyph={markProps.rightGlyph ?? '$'}
            style={swapStyle}
          />
        </g>
      ) : null}
      {showKana ? (
        <text
          x={textX}
          y="72"
          fill={colors.bodyLight}
          fontFamily={jpFontFamily}
          fontSize="19"
          fontWeight="700"
          letterSpacing="1"
        >
          {kanaMode === 'hiragana' ? hiraganaLabel : kanaMode === 'katakana' ? katakanaLabel : hiraganaLabel}
          {kanaMode === 'both' ? (
            <>
              <tspan fill={colors.ink} opacity="0.44">
                {' / '}
              </tspan>
              <tspan fill={colors.ink}>{katakanaLabel}</tspan>
            </>
          ) : null}
        </text>
      ) : null}
      <text
        x={textX}
        y={showKana ? '130' : '124'}
        fill={colors.ink}
        fontFamily={jpFontFamily}
        fontSize="78"
        fontWeight="800"
        letterSpacing="-9"
      >
        {label}
      </text>
      {displayStraplineLines.map((line, index) => (
        <text
          key={`${line}-${index}`}
          x={textX + 4}
          y={straplineY + index * straplineLineHeight}
          fill={colors.bodyLight}
          fontFamily={jpFontFamily}
          fontSize={straplineFontSize}
          fontWeight="700"
          letterSpacing={straplineLetterSpacing}
        >
          {line}
        </text>
      ))}
      <path
        d={`M ${textX} ${isMultiLineStrapline ? 202 : showKana ? 192 : 188} H 620`}
        stroke={colors.border}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface PersimmonFaviconProps extends PersimmonMarkProps {
  size?: number
}

export function PersimmonFavicon({
  size = 160,
  ...markProps
}: PersimmonFaviconProps) {
  const colors = palettes[markProps.palette ?? 'ember']

  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" fill="none" role="img" aria-label="Suwappu favicon">
      <rect x="64" y="64" width="872" height="872" rx="248" fill={colors.bg} />
      <rect x="104" y="104" width="792" height="792" rx="212" fill="none" stroke={colors.border} strokeWidth="18" />
      <g transform="translate(108 116) scale(0.78)">
        <PersimmonMark {...markProps} size={1000} frame="none" withGlow={false} />
      </g>
    </svg>
  )
}

export interface PersimmonSocialCardProps extends PersimmonMarkProps {
  width?: number
  title?: string
  subtitle?: string
  caption?: string
  hiraganaLabel?: string
  katakanaLabel?: string
  showKana?: boolean
  showSwapPair?: boolean
  kanaMode?: PersimmonKanaMode
  swapStyle?: PersimmonSwapStyle
}

export function PersimmonSocialCard({
  width = 880,
  title = 'suwappu',
  subtitle = 'swap marks and kana lockups',
  caption = 'SVG-only logo directions with pair badges, asymmetric fruit, and live state review',
  hiraganaLabel = 'すわっぷ',
  katakanaLabel = 'スワップ',
  showKana = true,
  showSwapPair = true,
  kanaMode = 'both',
  swapStyle = 'badge',
  ...markProps
}: PersimmonSocialCardProps) {
  const colors = palettes[markProps.palette ?? 'ember']
  const textX = 386
  const motifX = 936
  const motifY = 118
  const motifScale = swapStyle === 'badge' ? 0.7 : swapStyle === 'orbit' ? 0.66 : 0.62
  const motifOpacity = swapStyle === 'badge' ? 0.56 : 0.48
  const subtitleLines = subtitle
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const displaySubtitleLines = subtitleLines.map((line) =>
    subtitle.includes('\n') || /[,.]/.test(subtitle) || subtitle.length > 26 ? line : line.toUpperCase()
  )
  const isMultiLineSubtitle = displaySubtitleLines.length > 1
  const subtitleFontSize = isMultiLineSubtitle ? 24 : subtitle.length > 26 ? 24 : 30
  const subtitleLetterSpacing = isMultiLineSubtitle ? 2 : subtitle.length > 26 ? 2.5 : 4
  const subtitleY = showKana ? 338 : 314
  const subtitleLineHeight = 30
  const captionY = isMultiLineSubtitle ? (showKana ? 426 : 398) : showKana ? 398 : 372
  const ruleY = isMultiLineSubtitle ? 494 : 478
  const footerY = isMultiLineSubtitle ? 556 : 540

  return (
    <svg width={width} viewBox="0 0 1200 630" fill="none" role="img" aria-label="Suwappu social card">
      <rect x="0" y="0" width="1200" height="630" fill={colors.bg} />
      <rect x="24" y="24" width="1152" height="582" rx="36" fill="none" stroke={colors.border} strokeWidth="4" />
      <circle cx="250" cy="315" r="174" fill={colors.bgAlt} opacity="0.96" stroke={colors.border} strokeWidth="4" />
      <g transform="translate(102 126) scale(0.35)">
        <PersimmonMark {...markProps} size={1000} frame="none" withGlow={false} />
      </g>
      {showSwapPair ? (
        <g transform={`translate(${motifX} ${motifY}) scale(${fmt(motifScale)})`} opacity={motifOpacity}>
          <SwapMotif
            colors={colors}
            leftGlyph={markProps.leftGlyph ?? '¥'}
            rightGlyph={markProps.rightGlyph ?? '$'}
            style={swapStyle}
          />
        </g>
      ) : null}
      <text x={textX} y="244" fill={colors.ink} fontFamily={jpFontFamily} fontSize="86" fontWeight="800" letterSpacing="-8">
        {title}
      </text>
      {showKana ? (
        <text x={textX + 4} y="292" fill={colors.bodyLight} fontFamily={jpFontFamily} fontSize="30" fontWeight="700" letterSpacing="1">
          {kanaMode === 'hiragana' ? hiraganaLabel : kanaMode === 'katakana' ? katakanaLabel : hiraganaLabel}
          {kanaMode === 'both' ? (
            <>
              <tspan fill={colors.ink} opacity="0.42">
                {' / '}
              </tspan>
              <tspan fill={colors.ink}>{katakanaLabel}</tspan>
            </>
          ) : null}
        </text>
      ) : null}
      {displaySubtitleLines.map((line, index) => (
        <text
          key={`${line}-${index}`}
          x={textX + 4}
          y={subtitleY + index * subtitleLineHeight}
          fill={colors.bodyLight}
          fontFamily={jpFontFamily}
          fontSize={subtitleFontSize}
          fontWeight="700"
          letterSpacing={subtitleLetterSpacing}
        >
          {line}
        </text>
      ))}
      <text x={textX} y={captionY} fill={colors.ink} opacity="0.82" fontFamily={jpFontFamily} fontSize="28" fontWeight="500">
        {caption}
      </text>
      <path d={`M ${textX} ${ruleY} H 896`} stroke={colors.border} strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
      <text x="896" y={footerY} fill={colors.bodyLight} textAnchor="end" fontFamily={jpFontFamily} fontSize="24" fontWeight="700" letterSpacing="3">
        LIVE BRAND LAB
      </text>
      <rect x="44" y="44" width="184" height="36" rx="18" fill={colors.bgAlt} stroke={colors.border} strokeWidth="2" />
      <text x="136" y="68" fill={colors.ink} textAnchor="middle" fontFamily={jpFontFamily} fontSize="18" fontWeight="700" letterSpacing="2">
        SHOWCASE
      </text>
    </svg>
  )
}
