import type { Meta, StoryObj } from '@storybook/react'
import { designTokens } from '@suwappu/design-tokens'

const sections: Array<{ name: string; items: Array<[string, string]> }> = [
  {
    name: 'Summer Breeze',
    items: [
      ['Persimmon Cream', designTokens.colors.brand.persimmonCream],
      ['Sunlit Flesh', designTokens.colors.brand.sunlitFlesh],
      ['Persimmon Core', designTokens.colors.brand.persimmonCore],
      ['Golden Calyx', designTokens.colors.brand.goldenCalyx],
      ['Burnt Stem', designTokens.colors.brand.burntStem],
      ['Ink Brown', designTokens.colors.brand.inkBrown],
    ],
  },
  {
    name: 'Studio Surfaces',
    items: [
      ['Background', designTokens.colors.surface.professional.background],
      ['BG Secondary', designTokens.colors.surface.professional.bgSecondary],
      ['BG Tertiary', designTokens.colors.surface.professional.bgTertiary],
      ['Panel', designTokens.colors.surface.professional.panel],
      ['Border', designTokens.colors.surface.professional.border],
      ['Text', designTokens.colors.surface.professional.text],
    ],
  },
  {
    name: 'Atmosphere',
    items: [
      ['Sky Wash', designTokens.colors.secondary.sky],
      ['Ocean Haze', designTokens.colors.secondary.ocean],
      ['Info', designTokens.colors.semantic.info],
      ['Warning', designTokens.colors.semantic.warning],
      ['Bull', designTokens.colors.trading.bull],
      ['Bear', designTokens.colors.trading.bear],
    ],
  },
]

function SwatchSection({
  name,
  items,
}: {
  name: string
  items: Array<[string, string]>
}) {
  return (
    <section className="terminal-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-terminal-text">{name}</h2>
        <span className="rounded-full border border-terminal-border bg-terminal-bg-secondary px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-terminal-text-muted">
          Storybook Foundation
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="rounded-3xl border border-terminal-border bg-white p-3 shadow-[0_16px_36px_rgba(246,207,133,0.12)]"
          >
            <div
              className="mb-3 h-20 rounded-2xl border border-terminal-border"
              style={{ background: value }}
            />
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-terminal-text">
              {label}
            </div>
            <div className="mt-1 font-mono text-[11px] text-terminal-text-muted">{value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

const meta = {
  title: 'Foundations/Color Tokens',
  tags: ['autodocs'],
  render: () => (
    <div className="rounded-[40px] border border-terminal-border bg-[radial-gradient(circle_at_top_right,rgba(244,201,99,0.16),transparent_24%),linear-gradient(180deg,#FFFEFB_0%,#FFF8EE_100%)] p-6 shadow-[0_28px_80px_rgba(246,207,133,0.18)]">
      <div className="mb-6 max-w-3xl">
        <div className="inline-flex rounded-full border border-terminal-border bg-white/80 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-terminal-text-muted">
          Summer Breeze Palette
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-terminal-text">
          White studio surfaces with persimmon warmth and light sky support.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-terminal-text-secondary">
          This replaces the old dark sakura-first look with a brighter editorial system for
          Storybook atoms, molecules, and brand explorations.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <SwatchSection key={section.name} name={section.name} items={section.items} />
        ))}
      </div>
    </div>
  ),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
