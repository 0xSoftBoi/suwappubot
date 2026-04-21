import { useEffect, useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { gsap } from 'gsap'
import {
  PersimmonFavicon,
  PersimmonLockup,
  PersimmonMark,
  PersimmonSocialCard,
  SakuraBloomMotif,
  PersimmonStemMotif,
  type PersimmonCutoutMode,
  type PersimmonFrame,
  type PersimmonKanaMode,
  type PersimmonPaletteName,
  type PersimmonShell,
  type PersimmonSwapStyle,
  type PersimmonVariant,
} from '../../components/brand/PersimmonLogo'

type PlaygroundArgs = {
  palette: PersimmonPaletteName
  variant: PersimmonVariant
  shell: PersimmonShell
  frame: PersimmonFrame
  cutoutMode: PersimmonCutoutMode
  leafCount: number
  withGlow: boolean
  leftGlyph: string
  rightGlyph: string
  kanaMode?: PersimmonKanaMode
  swapStyle?: PersimmonSwapStyle
}

type Direction = PlaygroundArgs & {
  name: string
  note: string
  strapline: string
}

const familyDescriptions: Record<PersimmonVariant, string> = {
  orchard: 'Core fruit silhouette with a flatter kaki body and stronger calyx.',
  slice: 'Cut section to keep the fruit read immediate at small sizes.',
  seal: 'Contained badge version for app icons and avatars.',
  ribbon: 'Motion-first interior lines for an energetic swap feel.',
  orbit: 'Ring language around the mark for networked movement.',
  pair: 'Coin-pair core with tiny currency circles for the swap story.',
}

const themedVariants: Direction[] = [
  {
    name: 'Reference Blend',
    note: 'Front-view kaki body, compact 4-lobe calyx, and a clean outline-first read.',
    strapline: 'reference blend icon',
    palette: 'mandarin',
    variant: 'orchard',
    shell: 'fuyu',
    frame: 'none',
    cutoutMode: 'none',
    leafCount: 4,
    withGlow: true,
    leftGlyph: '¥',
    rightGlyph: '$',
  },
  {
    name: 'Swap Token Badge',
    note: 'Uses the fruit as the container and the token pair as the idea in the middle.',
    strapline: 'paired currencies inside',
    palette: 'ember',
    variant: 'pair',
    shell: 'coin',
    frame: 'circle',
    cutoutMode: 'none',
    leafCount: 5,
    withGlow: false,
    leftGlyph: '¥',
    rightGlyph: 'Ξ',
  },
  {
    name: 'Kana App Seal',
    note: 'The compact product badge: softer container, kana lockup, and tighter icon fit.',
    strapline: 'kana-first product seal',
    palette: 'sunrise',
    variant: 'seal',
    shell: 'coin',
    frame: 'squircle',
    cutoutMode: 'none',
    leafCount: 5,
    withGlow: false,
    leftGlyph: '◎',
    rightGlyph: '$',
  },
]

const sweetVariants: Direction[] = [
  {
    name: 'Sweet Float',
    note: 'Cream-paper warmth, suspended-fruit softness, and the gentlest front-view silhouette.',
    strapline: 'soft editorial icon',
    palette: 'butter',
    variant: 'orchard',
    shell: 'fuyu',
    frame: 'none',
    cutoutMode: 'none',
    leafCount: 4,
    withGlow: false,
    leftGlyph: '¥',
    rightGlyph: '$',
  },
  {
    name: 'Honey Pair',
    note: 'Keeps the swap badge, but in a warmer, sweeter, less aggressive tone.',
    strapline: 'sweet pair energy',
    palette: 'butter',
    variant: 'pair',
    shell: 'coin',
    frame: 'circle',
    cutoutMode: 'none',
    leafCount: 5,
    withGlow: false,
    leftGlyph: '◎',
    rightGlyph: 'Ξ',
  },
  {
    name: 'Soft Seal',
    note: 'A light product seal with kana support and a friendlier icon balance.',
    strapline: 'gentle app badge',
    palette: 'butter',
    variant: 'seal',
    shell: 'coin',
    frame: 'squircle',
    cutoutMode: 'none',
    leafCount: 5,
    withGlow: false,
    leftGlyph: '¥',
    rightGlyph: '$',
  },
]

function labelForVariant(variant: PersimmonVariant) {
  if (variant === 'pair') return 'Swap Pair'

  return variant.charAt(0).toUpperCase() + variant.slice(1)
}

function LabHeader() {
  return (
    <section className="terminal-panel p-5">
      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-sakura-400">
        Suwappu
      </div>
      <h1 className="text-2xl font-semibold text-terminal-text">Suwappu Mark Lab</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-terminal-text-secondary">
        SVG-only logo directions tuned toward a flatter Japanese kaki silhouette. The live surfaces
        include kana lockups and paired currency chips so we can evaluate shape, naming, and swap
        language together.
      </p>
    </section>
  )
}

function Playground(args: PlaygroundArgs) {
  return (
    <div className="grid gap-4">
      <LabHeader />

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <section className="terminal-panel p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
            Active Direction
          </div>
          <h2 className="text-lg font-semibold text-terminal-text">{labelForVariant(args.variant)}</h2>
          <p className="mt-2 text-sm leading-6 text-terminal-text-secondary">
            {familyDescriptions[args.variant]}
          </p>
          <dl className="mt-4 grid gap-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-terminal-text-muted">Palette</dt>
              <dd className="font-mono text-terminal-text">{args.palette}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-terminal-text-muted">Shell</dt>
              <dd className="font-mono text-terminal-text">{args.shell}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-terminal-text-muted">Frame</dt>
              <dd className="font-mono text-terminal-text">{args.frame}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-terminal-text-muted">Cutout</dt>
              <dd className="font-mono text-terminal-text">{args.cutoutMode}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-terminal-text-muted">Calyx</dt>
              <dd className="font-mono text-terminal-text">{args.leafCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-terminal-text-muted">Pair</dt>
              <dd className="font-mono text-terminal-text">
                {args.leftGlyph}/{args.rightGlyph}
              </dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-4">
          <div className="terminal-panel flex items-center justify-center p-6">
            <PersimmonMark
              size={360}
              palette={args.palette}
              variant={args.variant}
              shell={args.shell}
              frame={args.frame}
              cutoutMode={args.cutoutMode}
              leafCount={args.leafCount}
              withGlow={args.withGlow}
              leftGlyph={args.leftGlyph}
              rightGlyph={args.rightGlyph}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="terminal-panel flex items-center justify-center p-4">
              <PersimmonFavicon
                size={144}
                palette={args.palette}
                variant={args.variant}
                shell={args.shell}
                cutoutMode={args.cutoutMode}
                leafCount={args.leafCount}
                leftGlyph={args.leftGlyph}
                rightGlyph={args.rightGlyph}
              />
            </div>
            <div className="terminal-panel flex items-center justify-center p-4 lg:col-span-2">
              <PersimmonLockup
                width={520}
                palette={args.palette}
                variant={args.variant}
                shell={args.shell}
                cutoutMode={args.cutoutMode}
                leafCount={args.leafCount}
                frame={args.frame}
                leftGlyph={args.leftGlyph}
                rightGlyph={args.rightGlyph}
                kanaMode={args.kanaMode}
                swapStyle={args.swapStyle}
                showSwapPair={false}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Matrix() {
  const variants: PersimmonVariant[] = ['orchard', 'slice', 'seal', 'ribbon', 'orbit', 'pair']
  const cutouts: PersimmonCutoutMode[] = ['none', 'xor', 'nor']
  const shellByVariant: Record<PersimmonVariant, PersimmonShell> = {
    orchard: 'fuyu',
    slice: 'fuyu',
    seal: 'squircle',
    ribbon: 'fan',
    orbit: 'crest',
    pair: 'coin',
  }

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Direction matrix</div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {variants.flatMap((variant, variantIndex) =>
            cutouts.map((cutoutMode, cutoutIndex) => (
              <div
                key={`${variant}-${cutoutMode}`}
                className="rounded border border-terminal-border bg-terminal-bg p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-terminal-text">
                      {labelForVariant(variant)}
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
                      {cutoutMode}
                    </div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg-secondary px-2 py-1 text-[10px] font-mono text-terminal-text-secondary">
                    {variantIndex + 1}.{cutoutIndex + 1}
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  <PersimmonMark
                    size={190}
                    variant={variant}
                    cutoutMode={cutoutMode}
                    palette={variantIndex % 2 === 0 ? 'mandarin' : 'neon'}
                    shell={shellByVariant[variant]}
                    frame={variant === 'seal' ? 'squircle' : 'none'}
                    leafCount={variant === 'pair' ? 5 : 4 + (variantIndex % 2)}
                    withGlow={cutoutMode !== 'none'}
                    leftGlyph={variantIndex % 3 === 0 ? '¥' : variantIndex % 3 === 1 ? 'Ξ' : '₿'}
                    rightGlyph={variantIndex % 2 === 0 ? '$' : '◎'}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function TenDirections() {
  const directions: Direction[] = [
    {
      name: 'Kaki Core',
      note: 'The flattest primary fruit. This is the closest to the photo reference.',
      strapline: 'swap pairs by design',
      palette: 'mandarin',
      variant: 'orchard',
      shell: 'fuyu',
      frame: 'none',
      cutoutMode: 'none',
      leafCount: 4,
      withGlow: true,
      leftGlyph: '¥',
      rightGlyph: '$',
    },
    {
      name: 'Crown Coin',
      note: 'A tighter icon shell with a stronger top recess and clean badge fit.',
      strapline: 'rounded and app-ready',
      palette: 'ember',
      variant: 'pair',
      shell: 'coin',
      frame: 'circle',
      cutoutMode: 'none',
      leafCount: 5,
      withGlow: false,
      leftGlyph: '¥',
      rightGlyph: 'Ξ',
    },
    {
      name: 'Dry Calyx',
      note: 'Leans into the iconic stem and papery crown more than the body ribs.',
      strapline: 'stem-first silhouette',
      palette: 'bronze',
      variant: 'orchard',
      shell: 'crest',
      frame: 'none',
      cutoutMode: 'none',
      leafCount: 6,
      withGlow: true,
      leftGlyph: '₿',
      rightGlyph: '$',
    },
    {
      name: 'Swap Fruit',
      note: 'The pair badge is the hero and the fruit becomes the frame.',
      strapline: 'micro pair story',
      palette: 'neon',
      variant: 'pair',
      shell: 'fuyu',
      frame: 'none',
      cutoutMode: 'xor',
      leafCount: 4,
      withGlow: true,
      leftGlyph: '◎',
      rightGlyph: 'Ξ',
    },
    {
      name: 'Kata Badge',
      note: 'Good candidate for a compact app mark with visible kana support.',
      strapline: 'kana forward badge',
      palette: 'sunrise',
      variant: 'seal',
      shell: 'coin',
      frame: 'squircle',
      cutoutMode: 'none',
      leafCount: 5,
      withGlow: false,
      leftGlyph: '¥',
      rightGlyph: '€',
    },
    {
      name: 'Sliced Kaki',
      note: 'Keeps the fruit literal while still looking flatter than the first pass.',
      strapline: 'literal but clean',
      palette: 'mandarin',
      variant: 'slice',
      shell: 'fuyu',
      frame: 'none',
      cutoutMode: 'none',
      leafCount: 4,
      withGlow: true,
      leftGlyph: '¥',
      rightGlyph: '$',
    },
    {
      name: 'Ribbon Pair',
      note: 'Motion lines push it toward exchange mechanics instead of produce.',
      strapline: 'swap flow inside',
      palette: 'ember',
      variant: 'ribbon',
      shell: 'fan',
      frame: 'none',
      cutoutMode: 'xor',
      leafCount: 5,
      withGlow: true,
      leftGlyph: 'Ξ',
      rightGlyph: '$',
    },
    {
      name: 'Orbit Kaki',
      note: 'The rings give it a product feel without dropping the stem icon.',
      strapline: 'networked exchange',
      palette: 'neon',
      variant: 'orbit',
      shell: 'crest',
      frame: 'none',
      cutoutMode: 'none',
      leafCount: 4,
      withGlow: true,
      leftGlyph: '◎',
      rightGlyph: '₿',
    },
    {
      name: 'Tall Market',
      note: 'Useful if we want a more vertical silhouette while keeping the same crown.',
      strapline: 'market to market',
      palette: 'bronze',
      variant: 'pair',
      shell: 'hachiya',
      frame: 'octagon',
      cutoutMode: 'nor',
      leafCount: 5,
      withGlow: false,
      leftGlyph: '¥',
      rightGlyph: '₿',
    },
    {
      name: 'Soft Ticket',
      note: 'A social-card direction with asymmetry and a softer container treatment.',
      strapline: 'showcase ready',
      palette: 'sunrise',
      variant: 'pair',
      shell: 'fuyu',
      frame: 'ticket',
      cutoutMode: 'none',
      leafCount: 6,
      withGlow: false,
      leftGlyph: '$',
      rightGlyph: '◎',
    },
  ]

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Ten more directions</div>
        <div className="grid gap-4 xl:grid-cols-2">
          {directions.map((direction, index) => (
            <div
              key={direction.name}
              className="rounded border border-terminal-border bg-terminal-bg p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-terminal-text">{direction.name}</div>
                  <div className="mt-1 text-sm leading-6 text-terminal-text-secondary">
                    {direction.note}
                  </div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg-secondary px-2 py-1 text-[10px] font-mono text-terminal-text-secondary">
                  {index + 1}/10
                </div>
              </div>

              <div className="grid items-center gap-4 lg:grid-cols-[200px_1fr]">
                <div className="flex items-center justify-center">
                  <PersimmonMark
                    size={184}
                    palette={direction.palette}
                    variant={direction.variant}
                    shell={direction.shell}
                    frame={direction.frame}
                    cutoutMode={direction.cutoutMode}
                    leafCount={direction.leafCount}
                    withGlow={direction.withGlow}
                    leftGlyph={direction.leftGlyph}
                    rightGlyph={direction.rightGlyph}
                  />
                </div>
                <div className="overflow-hidden rounded border border-terminal-border bg-terminal-bg-secondary">
                  <PersimmonLockup
                    width={430}
                    palette={direction.palette}
                    variant={direction.variant}
                    shell={direction.shell}
                    frame={direction.frame}
                    cutoutMode={direction.cutoutMode}
                    leafCount={direction.leafCount}
                    withGlow={false}
                    strapline={direction.strapline}
                    leftGlyph={direction.leftGlyph}
                    rightGlyph={direction.rightGlyph}
                    showSwapPair={false}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function ThemeTriptychBoard() {
  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Three theme variants</div>
        <div className="grid gap-4 xl:grid-cols-3">
          {themedVariants.map((variant) => (
            <div
              key={variant.name}
              className="rounded border border-terminal-border bg-terminal-bg p-4"
            >
              <div className="mb-3 text-sm font-semibold text-terminal-text">{variant.name}</div>
              <p className="mb-4 text-sm leading-6 text-terminal-text-secondary">{variant.note}</p>
              <div className="mb-4 flex items-center justify-center rounded border border-terminal-border bg-terminal-bg-secondary p-3">
                <PersimmonMark
                  size={176}
                  palette={variant.palette}
                  variant={variant.variant}
                  shell={variant.shell}
                  frame={variant.frame}
                  cutoutMode={variant.cutoutMode}
                  leafCount={variant.leafCount}
                  withGlow={variant.withGlow}
                  leftGlyph={variant.leftGlyph}
                  rightGlyph={variant.rightGlyph}
                />
              </div>
              <div className="overflow-hidden rounded border border-terminal-border bg-terminal-bg-secondary">
                <PersimmonLockup
                  width={380}
                  palette={variant.palette}
                  variant={variant.variant}
                  shell={variant.shell}
                  frame={variant.frame}
                  cutoutMode={variant.cutoutMode}
                  leafCount={variant.leafCount}
                  withGlow={false}
                  strapline={variant.strapline}
                  leftGlyph={variant.leftGlyph}
                  rightGlyph={variant.rightGlyph}
                  showSwapPair={false}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function HowTheyAreMadeBoard() {
  const buildSteps = [
    {
      title: '1. Silhouette',
      description: 'Start with a flat front-view kaki body that reads before any detail.',
      props: themedVariants[0],
    },
    {
      title: '2. Crown',
      description: 'Push the papery top and bent stem so the fruit has identity at a glance.',
      props: {
        ...themedVariants[0],
        shell: 'crest' as PersimmonShell,
        leafCount: 5,
      },
    },
    {
      title: '3. Swap Story',
      description: 'Drop in the paired currency chips only after the fruit shape is strong enough.',
      props: themedVariants[1],
    },
  ]

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">How they are made</div>
        <div className="grid gap-4 xl:grid-cols-3">
          {buildSteps.map((step) => (
            <div
              key={step.title}
              className="rounded border border-terminal-border bg-terminal-bg p-4"
            >
              <div className="mb-2 text-sm font-semibold text-terminal-text">{step.title}</div>
              <p className="mb-4 text-sm leading-6 text-terminal-text-secondary">
                {step.description}
              </p>
              <div className="mb-4 flex items-center justify-center rounded border border-terminal-border bg-terminal-bg-secondary p-3">
                <PersimmonMark
                  size={188}
                  palette={step.props.palette}
                  variant={step.props.variant}
                  shell={step.props.shell}
                  frame={step.props.frame}
                  cutoutMode={step.props.cutoutMode}
                  leafCount={step.props.leafCount}
                  withGlow={step.props.withGlow}
                  leftGlyph={step.props.leftGlyph}
                  rightGlyph={step.props.rightGlyph}
                />
              </div>
              <div className="grid gap-2 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-terminal-text-muted">Shell</span>
                  <span className="font-mono text-terminal-text">{step.props.shell}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-terminal-text-muted">Variant</span>
                  <span className="font-mono text-terminal-text">{step.props.variant}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-terminal-text-muted">Pair</span>
                  <span className="font-mono text-terminal-text">
                    {step.props.leftGlyph}/{step.props.rightGlyph}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function SweetTriptychBoard() {
  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Sweet to me</div>
        <div className="grid gap-4 xl:grid-cols-3">
          {sweetVariants.map((variant) => (
            <div
              key={variant.name}
              className="rounded border border-terminal-border bg-terminal-bg p-4"
            >
              <div className="mb-3 text-sm font-semibold text-terminal-text">{variant.name}</div>
              <p className="mb-4 text-sm leading-6 text-terminal-text-secondary">{variant.note}</p>
              <div className="mb-4 flex items-center justify-center rounded border border-terminal-border bg-terminal-bg-secondary p-3">
                <PersimmonMark
                  size={176}
                  palette={variant.palette}
                  variant={variant.variant}
                  shell={variant.shell}
                  frame={variant.frame}
                  cutoutMode={variant.cutoutMode}
                  leafCount={variant.leafCount}
                  withGlow={variant.withGlow}
                  leftGlyph={variant.leftGlyph}
                  rightGlyph={variant.rightGlyph}
                />
              </div>
              <div className="overflow-hidden rounded border border-terminal-border bg-terminal-bg-secondary">
                <PersimmonLockup
                  width={380}
                  palette={variant.palette}
                  variant={variant.variant}
                  shell={variant.shell}
                  frame={variant.frame}
                  cutoutMode={variant.cutoutMode}
                  leafCount={variant.leafCount}
                  withGlow={false}
                  strapline={variant.strapline}
                  leftGlyph={variant.leftGlyph}
                  rightGlyph={variant.rightGlyph}
                  showSwapPair={false}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function FallingPersimmonsBoard() {
  const fruits = [
    { left: '-2%', top: '18%', size: 146, blur: 10, opacity: 0.5, delay: '0s', duration: '14s', hanging: true, string: 230, variant: 'orchard' as PersimmonVariant, shell: 'fuyu' as PersimmonShell },
    { left: '8%', top: '4%', size: 88, blur: 1, opacity: 0.78, delay: '-3s', duration: '11s', hanging: true, string: 118, variant: 'orchard' as PersimmonVariant, shell: 'coin' as PersimmonShell },
    { left: '17%', top: '30%', size: 184, blur: 14, opacity: 0.54, delay: '-5s', duration: '16s', hanging: true, string: 260, variant: 'orchard' as PersimmonVariant, shell: 'fuyu' as PersimmonShell },
    { left: '41%', top: '-1%', size: 110, blur: 3, opacity: 0.58, delay: '-4s', duration: '12s', hanging: false, string: 0, variant: 'orchard' as PersimmonVariant, shell: 'coin' as PersimmonShell },
    { left: '74%', top: '4%', size: 176, blur: 12, opacity: 0.44, delay: '-1s', duration: '17s', hanging: true, string: 152, variant: 'orchard' as PersimmonVariant, shell: 'fuyu' as PersimmonShell },
    { left: '85%', top: '24%', size: 214, blur: 20, opacity: 0.58, delay: '-7s', duration: '18s', hanging: false, string: 0, variant: 'orchard' as PersimmonVariant, shell: 'fuyu' as PersimmonShell },
    { left: '63%', top: '77%', size: 60, blur: 2, opacity: 0.72, delay: '-2s', duration: '10s', hanging: false, string: 0, variant: 'orchard' as PersimmonVariant, shell: 'coin' as PersimmonShell },
    { left: '88%', top: '73%', size: 74, blur: 4, opacity: 0.68, delay: '-6s', duration: '10s', hanging: false, string: 0, variant: 'orchard' as PersimmonVariant, shell: 'coin' as PersimmonShell },
  ]

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Floating persimmons</div>
        <div
          className="relative overflow-hidden rounded-[36px] border p-6"
          style={{
            minHeight: 820,
            borderColor: '#e7dcc7',
            background:
              'radial-gradient(circle at 10% 88%, rgba(248,220,118,0.34), transparent 22%), radial-gradient(circle at 84% 34%, rgba(239,197,92,0.24), transparent 18%), linear-gradient(180deg, #fffefb 0%, #ffffff 48%, #fffef9 100%)',
          }}
        >
          <style>{`
            @keyframes suwappu-float-drift {
              0% { transform: translate3d(0, -10px, 0) rotate(-2deg) scale(1); }
              50% { transform: translate3d(7px, 12px, 0) rotate(3deg) scale(1.02); }
              100% { transform: translate3d(-5px, 22px, 0) rotate(-1deg) scale(0.99); }
            }
            @keyframes suwappu-string-sway {
              0% { transform: rotate(-1.2deg); transform-origin: top center; }
              50% { transform: rotate(1.3deg); transform-origin: top center; }
              100% { transform: rotate(-0.8deg); transform-origin: top center; }
            }
            @keyframes suwappu-panel-breathe {
              0% { transform: translateY(0); }
              50% { transform: translateY(-4px); }
              100% { transform: translateY(0); }
            }
          `}</style>

          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 30% 34%, rgba(255,255,255,0.94), transparent 16%), radial-gradient(circle at 76% 44%, rgba(255,232,180,0.28), transparent 22%), radial-gradient(circle at 54% 54%, rgba(255,255,255,0.88), transparent 26%)',
            }}
          />

          {fruits.map((fruit, index) => (
            <div
              key={`${fruit.left}-${fruit.top}-${index}`}
              className="absolute"
              style={{
                left: fruit.left,
                top: fruit.top,
                width: fruit.size,
                height: fruit.size,
                opacity: fruit.opacity,
                filter: `blur(${fruit.blur}px)`,
                animation: `suwappu-float-drift ${fruit.duration} ease-in-out infinite`,
                animationDelay: fruit.delay,
              }}
            >
              {fruit.hanging ? (
                <div
                  className="absolute left-1/2 top-[-160px] w-[6px] -translate-x-1/2 rounded-full"
                  style={{
                    height: fruit.string,
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(245,237,225,0.42) 60%, rgba(255,255,255,0.08) 100%)',
                    animation: `suwappu-string-sway ${fruit.duration} ease-in-out infinite`,
                    animationDelay: fruit.delay,
                  }}
                />
              ) : null}

              <PersimmonMark
                size={fruit.size}
                palette="butter"
                variant={fruit.variant}
                shell={fruit.shell}
                frame="none"
                cutoutMode="none"
                leafCount={4}
                withGlow={false}
                leftGlyph="USDC"
                rightGlyph="CircleYEN"
              />
            </div>
          ))}

          <div className="relative z-10 mx-auto flex min-h-[760px] max-w-[980px] items-center justify-center">
            <div
              className="relative mx-auto w-full max-w-[660px] rounded-[36px] border border-[#ece1ce] bg-white/58 p-5 shadow-[0_24px_80px_rgba(194,154,80,0.12)] backdrop-blur-md"
              style={{ animation: 'suwappu-panel-breathe 9s ease-in-out infinite' }}
            >
              <div className="absolute inset-x-8 top-0 h-px bg-white/96" />
              <div className="mb-4 inline-flex rounded-full border border-[#ead9bb] bg-white/74 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[#8d7351] backdrop-blur-sm">
                Floating Studio
              </div>
              <h2
                className="max-w-[12ch] text-[48px] font-semibold leading-[0.96] tracking-[-0.04em] text-[#2f221a] sm:text-[64px]"
                style={{ fontFamily: "'Iowan Old Style', 'Palatino Linotype', serif" }}
              >
                Persimmons drifting through white light.
              </h2>
              <p className="mt-4 max-w-[34rem] text-base leading-7 text-[#6e5b42]">
                Suspended fruit, soft blur, and a quiet studio composition around the mark. This is
                the dreamy editorial direction from the photo reference.
              </p>
              <div className="mt-6 overflow-hidden rounded-[30px] border border-[#efe3d2] bg-white">
                <PersimmonLockup
                  width={620}
                  palette="butter"
                  variant="orchard"
                  shell="fuyu"
                  frame="none"
                  cutoutMode="none"
                  leafCount={4}
                  leftGlyph="USDC"
                  rightGlyph="CircleYEN"
                  kanaMode="katakana"
                  swapStyle="badge"
                  strapline={'swap anything,\neverywhere.'}
                  showSwapPair={false}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function StemMotifsBoard() {
  const motifTiles = [
    { name: 'Micro', size: 92, rotation: -12, palette: 'butter' as PersimmonPaletteName },
    { name: 'Badge', size: 132, rotation: 8, palette: 'mandarin' as PersimmonPaletteName },
    { name: 'Hero', size: 184, rotation: -8, palette: 'sunrise' as PersimmonPaletteName },
    { name: 'Mirror', size: 148, rotation: 18, palette: 'butter' as PersimmonPaletteName, flipX: true },
  ]

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Stem motifs</div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div
            className="relative overflow-hidden rounded-[32px] border p-8"
            style={{
              minHeight: 520,
              borderColor: '#e0d1b3',
              background:
                'radial-gradient(circle at 0% 100%, rgba(247,221,132,0.45), transparent 28%), linear-gradient(180deg, #fff9ef 0%, #f6efdf 48%, #f2e6d3 100%)',
            }}
          >
            <div className="absolute -left-10 top-6 opacity-55">
              <PersimmonStemMotif size={240} palette="butter" rotation={-22} />
            </div>
            <div className="absolute left-[38%] top-[-6%] opacity-35">
              <PersimmonStemMotif size={210} palette="sunrise" rotation={10} />
            </div>
            <div className="absolute right-[-2%] top-[8%] opacity-45">
              <PersimmonStemMotif size={280} palette="mandarin" rotation={24} flipX />
            </div>
            <div className="absolute left-[8%] bottom-[10%] opacity-22">
              <PersimmonStemMotif size={320} palette="butter" rotation={-16} />
            </div>
            <div className="absolute right-[8%] bottom-[6%] opacity-26">
              <PersimmonStemMotif size={188} palette="sunrise" rotation={14} />
            </div>

            <div className="relative z-10 mx-auto mt-20 max-w-[620px] rounded-[30px] border border-[#eadcc2] bg-white/52 p-4 shadow-[0_24px_80px_rgba(184,144,88,0.16)] backdrop-blur-md">
              <PersimmonLockup
                width={600}
                palette="butter"
                variant="orchard"
                shell="fuyu"
                frame="none"
                cutoutMode="none"
                leafCount={4}
                leftGlyph="¥"
                rightGlyph="$"
                strapline={'swap anything,\neverywhere.'}
                showSwapPair={false}
              />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[28px] border border-terminal-border bg-terminal-bg p-4">
              <div className="mb-2 text-sm font-semibold text-terminal-text">Reusable set</div>
              <p className="mb-4 text-sm leading-6 text-terminal-text-secondary">
                The stem/calyx can work as a repeatable asset family for hero backdrops, promo
                cards, and small marketing hits without always bringing the full fruit mark along.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {motifTiles.map((tile) => (
                  <div
                    key={tile.name}
                    className="rounded-2xl border border-terminal-border bg-terminal-bg-secondary p-4"
                  >
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-terminal-text-muted">
                      {tile.name}
                    </div>
                    <div className="flex items-center justify-center rounded-2xl bg-[#fff8ec] p-3">
                      <PersimmonStemMotif
                        size={tile.size}
                        palette={tile.palette}
                        rotation={tile.rotation}
                        flipX={tile.flipX ?? false}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-terminal-border bg-terminal-bg p-4">
              <div className="mb-2 text-sm font-semibold text-terminal-text">Backdrop rule</div>
              <p className="text-sm leading-6 text-terminal-text-secondary">
                Use large low-opacity motifs for atmosphere, medium motifs for corners and section
                headers, and only bring in the full fruit mark when the brand needs to land.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function BloomMotifsBoard() {
  const bloomTiles = [
    { name: 'Soft', size: 112, rotation: -8, tone: 'soft' as const },
    { name: 'Mist', size: 132, rotation: 10, tone: 'mist' as const },
    { name: 'Sun', size: 152, rotation: -14, tone: 'sun' as const },
    { name: 'Mirror', size: 124, rotation: 14, tone: 'soft' as const, flipX: true },
  ]

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Bloom motifs</div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div
            className="relative overflow-hidden rounded-[32px] border p-8"
            style={{
              minHeight: 520,
              borderColor: '#d9e4f0',
              background:
                'linear-gradient(180deg, #b8dcfa 0%, #d7ecff 38%, #f6f1e6 39%, #f7f1e7 100%)',
            }}
          >
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 520" fill="none" aria-hidden="true">
              <path d="M -40 40 C 140 64 224 118 346 232" stroke="#6d5142" strokeWidth="14" strokeLinecap="round" />
              <path d="M 118 104 C 208 146 252 196 308 278" stroke="#7a5c4b" strokeWidth="9" strokeLinecap="round" />
            </svg>

            <div className="absolute left-[4%] top-[4%] opacity-96">
              <SakuraBloomMotif size={156} tone="soft" rotation={-8} />
            </div>
            <div className="absolute left-[15%] top-[14%] opacity-82">
              <SakuraBloomMotif size={128} tone="mist" rotation={12} />
            </div>
            <div className="absolute left-[23%] top-[23%] opacity-74">
              <SakuraBloomMotif size={104} tone="sun" rotation={-16} />
            </div>
            <div className="absolute right-[6%] top-[10%] opacity-22">
              <SakuraBloomMotif size={172} tone="mist" rotation={18} />
            </div>
            <div className="absolute left-[10%] bottom-[14%] opacity-16">
              <PersimmonStemMotif size={220} palette="butter" rotation={-18} />
            </div>
            <div className="absolute right-[9%] bottom-[10%] opacity-18">
              <PersimmonStemMotif size={170} palette="sunrise" rotation={14} flipX />
            </div>

            <div className="relative z-10 mx-auto mt-24 max-w-[620px] rounded-[30px] border border-white/72 bg-white/48 p-4 shadow-[0_24px_80px_rgba(108,136,170,0.16)] backdrop-blur-md">
              <PersimmonLockup
                width={600}
                palette="butter"
                variant="orchard"
                shell="fuyu"
                frame="none"
                cutoutMode="none"
                leafCount={4}
                leftGlyph="¥"
                rightGlyph="$"
                strapline={'swap anything,\neverywhere.'}
                showSwapPair={false}
              />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[28px] border border-terminal-border bg-terminal-bg p-4">
              <div className="mb-2 text-sm font-semibold text-terminal-text">Bloom set</div>
              <p className="mb-4 text-sm leading-6 text-terminal-text-secondary">
                These blossoms can work like the stem motifs: small accents, section corners, or
                softer background framing on spring-forward surfaces.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {bloomTiles.map((tile) => (
                  <div
                    key={tile.name}
                    className="rounded-2xl border border-terminal-border bg-terminal-bg-secondary p-4"
                  >
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-terminal-text-muted">
                      {tile.name}
                    </div>
                    <div className="flex items-center justify-center rounded-2xl bg-[#f8f2eb] p-3">
                      <SakuraBloomMotif
                        size={tile.size}
                        tone={tile.tone}
                        rotation={tile.rotation}
                        flipX={tile.flipX ?? false}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-terminal-border bg-terminal-bg p-4">
              <div className="mb-2 text-sm font-semibold text-terminal-text">Use with stem motifs</div>
              <p className="text-sm leading-6 text-terminal-text-secondary">
                Pair blossoms with the stem motif when a surface needs both softness and brand
                specificity. Use blossoms alone when the scene wants a gentler Japanese cue.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function FujiSakuraBoard() {
  const blossomClusters = [
    { left: '5%', top: '6%', scale: 1.05, opacity: 0.96 },
    { left: '14%', top: '12%', scale: 0.82, opacity: 0.88 },
    { left: '22%', top: '20%', scale: 0.72, opacity: 0.84 },
    { left: '72%', top: '8%', scale: 0.58, opacity: 0.72 },
  ]
  const fruits = [
    { left: '50%', top: '8%', size: 92, blur: 1, opacity: 0.72, hanging: true, string: 122, shell: 'coin' as PersimmonShell },
    { left: '60%', top: '12%', size: 150, blur: 6, opacity: 0.52, hanging: true, string: 176, shell: 'fuyu' as PersimmonShell },
    { left: '74%', top: '4%', size: 118, blur: 10, opacity: 0.38, hanging: false, string: 0, shell: 'coin' as PersimmonShell },
    { left: '81%', top: '18%', size: 184, blur: 14, opacity: 0.54, hanging: true, string: 210, shell: 'fuyu' as PersimmonShell },
    { left: '90%', top: '33%', size: 126, blur: 4, opacity: 0.72, hanging: false, string: 0, shell: 'fuyu' as PersimmonShell },
  ]

  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Sakura and floating persimmons</div>
        <div
          className="relative overflow-hidden rounded-[34px] border"
          style={{
            minHeight: 820,
            borderColor: '#c8d8ea',
            background:
              'linear-gradient(180deg, #8ec7f6 0%, #bfe0fb 28%, #dbeeff 54%, #98bfe0 55%, #7aa3c7 68%, #6f97bc 100%)',
          }}
        >
          <div
            className="absolute inset-x-0 bottom-0 h-[46%]"
            style={{
              background:
                'linear-gradient(180deg, rgba(132,171,205,0.16) 0%, rgba(89,126,164,0.52) 100%)',
            }}
          />
          <div
            className="absolute inset-x-0 top-[54%] h-px"
            style={{ background: 'rgba(255,255,255,0.42)' }}
          />

          <svg
            className="absolute left-0 top-0 h-full w-full"
            viewBox="0 0 1400 820"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M -40 36 C 162 66 236 128 346 234 C 432 316 474 338 604 360"
              stroke="#5f4638"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              d="M 112 114 C 194 156 234 212 282 300"
              stroke="#6e4e3b"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 248 166 C 324 196 372 252 418 338"
              stroke="#6e4e3b"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M 86 214 C 152 230 202 276 254 352"
              stroke="#6e4e3b"
              strokeWidth="8"
              strokeLinecap="round"
            />
          </svg>

          {blossomClusters.map((cluster, index) => (
            <div
              key={`${cluster.left}-${cluster.top}-${index}`}
              className="absolute"
              style={{
                left: cluster.left,
                top: cluster.top,
                transform: `scale(${cluster.scale})`,
                opacity: cluster.opacity,
              }}
            >
              <svg width="168" height="168" viewBox="0 0 168 168" fill="none" aria-hidden="true">
                <g transform="translate(84 84)">
                  {[0, 72, 144, 216, 288].map((rotation) => (
                    <ellipse
                      key={rotation}
                      cx="0"
                      cy="-26"
                      rx="22"
                      ry="34"
                      transform={`rotate(${rotation})`}
                      fill="#f7d5df"
                      stroke="#fff7fb"
                      strokeWidth="5"
                    />
                  ))}
                  <circle cx="0" cy="0" r="12" fill="#f3c46c" stroke="#fff6d8" strokeWidth="4" />
                </g>
              </svg>
            </div>
          ))}

          {fruits.map((fruit, index) => (
            <div
              key={`${fruit.left}-${fruit.top}-${index}`}
              className="absolute"
              style={{
                left: fruit.left,
                top: fruit.top,
                width: fruit.size,
                height: fruit.size,
                opacity: fruit.opacity,
                filter: `blur(${fruit.blur}px)`,
              }}
            >
              {fruit.hanging ? (
                <div
                  className="absolute left-1/2 top-[-180px] w-[5px] -translate-x-1/2 rounded-full"
                  style={{
                    height: fruit.string,
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.18) 100%)',
                  }}
                />
              ) : null}
              <PersimmonMark
                size={fruit.size}
                palette="butter"
                variant="orchard"
                shell={fruit.shell}
                frame="none"
                cutoutMode="none"
                leafCount={4}
                withGlow={false}
                leftGlyph="USDC"
                rightGlyph="CircleYEN"
              />
            </div>
          ))}

          <div className="absolute left-[8%] top-[64%] opacity-14">
            <PersimmonStemMotif size={240} palette="butter" rotation={-24} />
          </div>
          <div className="absolute right-[10%] top-[14%] opacity-16">
            <PersimmonStemMotif size={156} palette="sunrise" rotation={18} flipX />
          </div>

          <div className="relative z-10 flex min-h-[820px] items-end justify-center px-8 py-10">
            <div className="grid w-full max-w-[1160px] gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="px-2 pb-4 lg:px-6">
                <div className="mb-3 inline-flex rounded-full border border-white/70 bg-white/38 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[#5c6f85] backdrop-blur-sm">
                  Japan Spring Surface
                </div>
                <h2
                  className="max-w-[10ch] text-[52px] font-semibold leading-[0.96] tracking-[-0.04em] text-[#17324a] sm:text-[72px]"
                  style={{ fontFamily: "'Iowan Old Style', 'Palatino Linotype', serif" }}
                >
                  Sakura light and floating fruit around the mark.
                </h2>
                <p className="mt-5 max-w-[34rem] text-base leading-7 text-[#345069]">
                  This keeps the spring softness but drops the tourism postcard cue. Blossoms frame
                  the scene while suspended persimmons build the actual fruit-first brand world.
                </p>
              </div>

              <div className="relative mx-auto w-full max-w-[660px] rounded-[34px] border border-white/72 bg-white/42 p-4 shadow-[0_30px_80px_rgba(86,120,158,0.20)] backdrop-blur-md">
                <div className="absolute inset-x-8 top-0 h-px bg-white/90" />
                <PersimmonLockup
                  width={628}
                  palette="butter"
                  variant="orchard"
                  shell="fuyu"
                  frame="none"
                  cutoutMode="none"
                  leafCount={4}
                  leftGlyph="USDC"
                  rightGlyph="CircleYEN"
                  kanaMode="katakana"
                  swapStyle="badge"
                  strapline={'swap anything,\neverywhere.'}
                  showSwapPair={false}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function ShowcaseBreakdown(args: PlaygroundArgs) {
  return (
    <div className="grid gap-4">
      <LabHeader />

      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Showcase breakdown</div>
        <p className="mb-4 max-w-3xl text-sm leading-6 text-terminal-text-secondary">
          These are the primary surfaces we need to rebuild coherently across the showcase: nav mark,
          hero lockup, favicon square, and bordered social card.
        </p>

        <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
          <div className="grid gap-4">
            <div className="terminal-panel bg-terminal-bg p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
                Nav mark
              </div>
              <div className="flex items-center justify-center">
                <PersimmonMark
                  size={136}
                  palette={args.palette}
                  variant={args.variant}
                  shell={args.shell}
                  frame="none"
                  cutoutMode={args.cutoutMode}
                  leafCount={args.leafCount}
                  leftGlyph={args.leftGlyph}
                  rightGlyph={args.rightGlyph}
                />
              </div>
            </div>

            <div className="terminal-panel bg-terminal-bg p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
                Favicon
              </div>
              <div className="flex items-center justify-center">
                <PersimmonFavicon
                  size={132}
                  palette={args.palette}
                  variant={args.variant}
                  shell={args.shell}
                  cutoutMode={args.cutoutMode}
                  leafCount={args.leafCount}
                  leftGlyph={args.leftGlyph}
                  rightGlyph={args.rightGlyph}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="terminal-panel bg-terminal-bg p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
                Hero lockup
              </div>
              <PersimmonLockup
                width={620}
                palette={args.palette}
                variant={args.variant}
                shell={args.shell}
                frame={args.frame}
                cutoutMode={args.cutoutMode}
                leafCount={args.leafCount}
                strapline={'swap anything,\neverywhere.'}
                leftGlyph={args.leftGlyph}
                rightGlyph={args.rightGlyph}
                kanaMode={args.kanaMode}
                swapStyle={args.swapStyle}
                showSwapPair={false}
              />
            </div>

            <div className="terminal-panel bg-terminal-bg p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
                Social card
              </div>
              <PersimmonSocialCard
                width={760}
                palette={args.palette}
                variant={args.variant}
                shell={args.shell}
                frame={args.frame}
                cutoutMode={args.cutoutMode}
                leafCount={args.leafCount}
                subtitle={'swap anything,\neverywhere.'}
                leftGlyph={args.leftGlyph}
                rightGlyph={args.rightGlyph}
                kanaMode={args.kanaMode}
                swapStyle={args.swapStyle}
                showSwapPair={false}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function GsapMotionBoard() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootRef.current) return

    const ctx = gsap.context(() => {
      gsap.to('.motion-bloom', {
        y: -10,
        rotation: 8,
        duration: 6.2,
        repeat: -1,
        yoyo: true,
        stagger: 0.24,
        ease: 'sine.inOut',
      })

      gsap.to('.motion-stem', {
        y: 8,
        rotation: -6,
        duration: 7.4,
        repeat: -1,
        yoyo: true,
        stagger: 0.3,
        ease: 'sine.inOut',
      })

      gsap.to('.motion-lockup', {
        y: -6,
        duration: 5.6,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    }, rootRef)

    return () => ctx.revert()
  }, [])

  return (
    <div className="grid gap-4" ref={rootRef}>
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">GSAP motion surface</div>
        <div
          className="relative overflow-hidden rounded-[32px] border p-8"
          style={{
            minHeight: 540,
            borderColor: '#ddd1be',
            background:
              'linear-gradient(180deg, #b6d9f7 0%, #d9edff 42%, #f7f1e5 42%, #f7f1e5 100%)',
          }}
        >
          <div className="motion-bloom absolute left-[4%] top-[7%] opacity-92">
            <SakuraBloomMotif size={164} tone="soft" rotation={-12} />
          </div>
          <div className="motion-bloom absolute left-[14%] top-[16%] opacity-78">
            <SakuraBloomMotif size={116} tone="mist" rotation={14} />
          </div>
          <div className="motion-bloom absolute right-[10%] top-[9%] opacity-26">
            <SakuraBloomMotif size={148} tone="sun" rotation={10} />
          </div>
          <div className="motion-stem absolute left-[8%] bottom-[8%] opacity-20">
            <PersimmonStemMotif size={240} palette="butter" rotation={-16} />
          </div>
          <div className="motion-stem absolute right-[8%] bottom-[10%] opacity-24">
            <PersimmonStemMotif size={190} palette="sunrise" rotation={12} flipX />
          </div>

          <div className="motion-lockup relative z-10 mx-auto mt-24 max-w-[640px] rounded-[30px] border border-white/72 bg-white/48 p-4 shadow-[0_24px_80px_rgba(108,136,170,0.16)] backdrop-blur-md">
            <PersimmonLockup
              width={620}
              palette="butter"
              variant="orchard"
              shell="fuyu"
              frame="none"
              cutoutMode="none"
              leafCount={4}
              leftGlyph="USDC"
              rightGlyph="CircleYEN"
              kanaMode="katakana"
              swapStyle="badge"
              strapline={'swap anything,\neverywhere.'}
              showSwapPair={false}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function SummerBreezeBoard() {
  return (
    <div className="grid gap-4">
      <LabHeader />
      <section className="terminal-panel p-4">
        <div className="mb-3 text-sm font-semibold text-terminal-text">Summer breeze</div>
        <div
          className="relative overflow-hidden rounded-[34px] border"
          style={{
            minHeight: 760,
            borderColor: '#d7e6ef',
            background:
              'linear-gradient(180deg, #fdfcf8 0%, #fffefb 18%, #f7fcff 18%, #d9f1f3 52%, #bde0e6 100%)',
          }}
        >
          <div
            className="absolute inset-y-5 left-5 w-[86px] rounded-[26px] border border-white/84 bg-white/88 shadow-[0_16px_40px_rgba(88,142,162,0.12)] md:inset-y-8 md:left-8 md:w-[132px] md:rounded-[30px]"
          />
          <div className="absolute left-[16px] top-[30px] md:left-[24px] md:top-[40px]">
            <div className="rounded-full border border-[#bfe6ef] bg-white/82 px-2.5 py-1 text-[9px] uppercase tracking-[0.28em] text-[#57a9bc] md:px-3 md:text-[10px]">
              summer breeze
            </div>
          </div>
          <div className="absolute inset-y-[76px] left-[20px] flex items-center md:inset-y-[90px] md:left-[34px]">
            <div
              className="text-[52px] font-semibold leading-none tracking-[-0.05em] text-[#16b8d1] md:text-[74px]"
              style={{
                fontFamily: "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif",
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
              }}
            >
              すわっぷ
            </div>
          </div>
          <div
            className="absolute bottom-[170px] left-[74px] text-[56px] leading-none text-white/28 md:bottom-[116px] md:left-[118px] md:text-[88px]"
            style={{
              fontFamily: "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif",
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: 'rotate(8deg)',
              filter: 'blur(0.2px)',
            }}
          >
            すわっぷ
          </div>

          <div
            className="absolute bottom-[18px] left-[100px] right-[18px] top-[18px] overflow-hidden rounded-[26px] border border-white/70 md:bottom-[28px] md:left-[160px] md:right-[28px] md:top-[28px] md:rounded-[30px]"
            style={{
              background:
                'radial-gradient(circle at 75% 24%, rgba(255,214,182,0.52), transparent 12%), radial-gradient(circle at 68% 14%, rgba(255,192,162,0.36), transparent 8%), linear-gradient(180deg, rgba(153,214,228,0.9) 0%, rgba(144,208,223,0.92) 26%, rgba(209,242,239,0.72) 54%, rgba(196,235,230,0.86) 100%)',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 22% 18%, rgba(255,255,255,0.48), transparent 18%), linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0.18) 52%, rgba(255,255,255,0.04) 100%)',
              }}
            />
            <div
              className="absolute bottom-[-6%] right-[8%] h-[44%] w-[24%] rounded-[45%] md:bottom-[-2%] md:right-[10%] md:h-[54%] md:w-[28%]"
              style={{
                background:
                  'linear-gradient(180deg, rgba(198,245,246,0.94) 0%, rgba(149,219,224,0.98) 100%)',
                filter: 'blur(0.4px)',
                transform: 'rotate(14deg)',
              }}
            />
            <div
              className="absolute right-[18%] top-[30%] h-[10%] w-[7%] rounded-full border border-white/70 bg-white/18 md:right-[20%] md:top-[28%]"
              style={{ transform: 'rotate(-6deg)' }}
            />
            <div className="absolute left-[14%] top-[10%] opacity-18 md:left-[12%] md:top-[8%]">
              <SakuraBloomMotif size={110} tone="soft" rotation={-10} />
            </div>
            <div className="absolute right-[10%] top-[12%] hidden opacity-12 md:block">
              <SakuraBloomMotif size={132} tone="mist" rotation={18} />
            </div>
            <div className="absolute left-[10%] top-[14%] opacity-34 md:left-[12%] md:top-[12%]">
              <PersimmonMark
                size={62}
                palette="butter"
                variant="orchard"
                shell="coin"
                frame="none"
                cutoutMode="none"
                leafCount={4}
                withGlow={false}
                leftGlyph="USDC"
                rightGlyph="CircleYEN"
              />
            </div>
            <div className="absolute left-[44%] top-[4%] hidden opacity-26 blur-[1px] sm:block">
              <PersimmonMark
                size={84}
                palette="butter"
                variant="orchard"
                shell="coin"
                frame="none"
                cutoutMode="none"
                leafCount={4}
                withGlow={false}
                leftGlyph="USDC"
                rightGlyph="CircleYEN"
              />
            </div>
            <div className="absolute right-[2%] top-[8%] opacity-26 blur-[3px] md:opacity-34">
              <PersimmonMark
                size={108}
                palette="butter"
                variant="orchard"
                shell="fuyu"
                frame="none"
                cutoutMode="none"
                leafCount={4}
                withGlow={false}
                leftGlyph="USDC"
                rightGlyph="CircleYEN"
              />
            </div>
            <div className="absolute bottom-[20px] left-[14px] right-[14px] rounded-[26px] border border-white/88 bg-white/86 p-3 shadow-[0_18px_48px_rgba(88,142,162,0.14)] backdrop-blur-md md:bottom-[24px] md:left-[54px] md:right-[40px] md:rounded-[30px] md:p-4">
              <div className="origin-top-left scale-[0.64] sm:scale-[0.78] md:scale-100">
                <PersimmonLockup
                  width={460}
                  palette="butter"
                  variant="orchard"
                  shell="fuyu"
                  frame="none"
                  cutoutMode="none"
                leafCount={4}
                leftGlyph="USDC"
                rightGlyph="CircleYEN"
                kanaMode="hiragana"
                strapline={'cross-chain,\nagent-ready.'}
                showSwapPair={false}
              />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

const meta = {
  title: 'Foundations/Suwappu Mark Lab',
  tags: ['autodocs'],
  args: {
    palette: 'mandarin',
    variant: 'orchard',
    shell: 'fuyu',
    frame: 'none',
    cutoutMode: 'none',
    leafCount: 4,
    withGlow: true,
    leftGlyph: 'USDC',
    rightGlyph: 'CircleYEN',
    kanaMode: 'katakana',
    swapStyle: 'badge',
  },
  argTypes: {
    palette: {
      control: 'select',
      options: ['ember', 'sunrise', 'mandarin', 'bronze', 'neon', 'butter'],
    },
    variant: {
      control: 'select',
      options: ['orchard', 'slice', 'seal', 'ribbon', 'orbit', 'pair'],
    },
    shell: {
      control: 'select',
      options: ['round', 'lantern', 'drop', 'squircle', 'fuyu', 'hachiya', 'fan', 'crest', 'coin'],
    },
    frame: {
      control: 'select',
      options: ['none', 'circle', 'squircle', 'octagon', 'ticket'],
    },
    cutoutMode: {
      control: 'inline-radio',
      options: ['none', 'xor', 'nor'],
    },
    leafCount: {
      control: { type: 'range', min: 3, max: 6, step: 1 },
    },
    withGlow: {
      control: 'boolean',
    },
    leftGlyph: {
      control: 'text',
    },
    rightGlyph: {
      control: 'text',
    },
    kanaMode: {
      control: 'inline-radio',
      options: ['katakana', 'both', 'hiragana'],
    },
    swapStyle: {
      control: 'inline-radio',
      options: ['badge', 'orbit', 'stream'],
    },
  },
} satisfies Meta<PlaygroundArgs>

export default meta

type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: (args) => <Playground {...args} />,
}

export const VariantMatrix: Story = {
  render: () => <Matrix />,
}

export const ThreeThemeVariants: Story = {
  render: () => <ThemeTriptychBoard />,
}

export const SweetToMe: Story = {
  render: () => <SweetTriptychBoard />,
}

export const ReferenceBlend: Story = {
  args: themedVariants[0],
  render: (args) => <Playground {...args} />,
}

export const SwapTokenBadge: Story = {
  args: themedVariants[1],
  render: (args) => <Playground {...args} />,
}

export const KanaAppSeal: Story = {
  args: themedVariants[2],
  render: (args) => <Playground {...args} />,
}

export const TenMoreDirections: Story = {
  render: () => <TenDirections />,
}

export const HowTheyAreMade: Story = {
  render: () => <HowTheyAreMadeBoard />,
}

export const StemMotifs: Story = {
  render: () => <StemMotifsBoard />,
}

export const BloomMotifs: Story = {
  render: () => <BloomMotifsBoard />,
}

export const FujiAndSakura: Story = {
  render: () => <FujiSakuraBoard />,
}

export const GsapMotion: Story = {
  render: () => <GsapMotionBoard />,
}

export const SummerBreeze: Story = {
  render: () => <SummerBreezeBoard />,
}

export const FloatingPersimmons: Story = {
  render: () => <FallingPersimmonsBoard />,
}

export const ShowcaseSurfaces: Story = {
  args: {
    variant: 'pair',
    frame: 'squircle',
    cutoutMode: 'none',
    shell: 'fuyu',
    palette: 'mandarin',
    leftGlyph: 'USDC',
    rightGlyph: 'CircleYEN',
    kanaMode: 'katakana',
    swapStyle: 'badge',
  },
  render: (args) => <ShowcaseBreakdown {...args} />,
}
