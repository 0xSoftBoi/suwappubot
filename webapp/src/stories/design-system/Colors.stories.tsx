import type { Meta, StoryObj } from '@storybook/react'
import { designTokens } from '../../theme/tokens'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Colors',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

interface ColorSwatchProps {
  name: string
  color: string
}

function ColorSwatch({ name, color }: ColorSwatchProps) {
  return (
    <div className="flex items-center gap-4 mb-3">
      <div
        className="w-16 h-16 rounded-suwappu-lg shadow-suwappu-2 shrink-0"
        style={{ backgroundColor: color }}
      />
      <div>
        <div className="font-heading font-semibold text-suwappu-text">{name}</div>
        <div className="font-body text-sm text-suwappu-text-secondary">{color}</div>
      </div>
    </div>
  )
}

interface ColorGroupProps {
  title: string
  colors: Record<string, string>
}

function ColorGroup({ title, colors }: ColorGroupProps) {
  return (
    <div className="mb-8">
      <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-4">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(colors).map(([name, color]) => (
          <ColorSwatch key={name} name={name} color={color} />
        ))}
      </div>
    </div>
  )
}

export const PrimaryColors: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Suwappu UI</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Kawaii-inspired design system with sakura theme
      </p>
      <ColorGroup title="Brand Palette" colors={{
        sakuraPinkLight: designTokens.colors.brand.sakuraPinkLight,
        sakuraPinkMid: designTokens.colors.brand.sakuraPinkMid,
        magentaCore: designTokens.colors.brand.magentaCore,
        roseGradientStart: designTokens.colors.brand.roseGradientStart,
        magentaGradientMid: designTokens.colors.brand.magentaGradientMid,
        deepPurpleGradientEnd: designTokens.colors.brand.deepPurpleGradientEnd,
        royalPurpleDeep: designTokens.colors.brand.royalPurpleDeep,
      }} />
    </div>
  ),
}

export const SecondaryColors: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <ColorGroup title="Secondary Palette" colors={designTokens.colors.secondary} />
    </div>
  ),
}

export const SemanticColors: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <ColorGroup title="Semantic Colors" colors={designTokens.colors.semantic} />
    </div>
  ),
}

export const NeutralColors: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <ColorGroup title="Neutral Colors" colors={designTokens.colors.neutral} />
    </div>
  ),
}

export const DarkModeColors: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <ColorGroup title="Dark Surface Colors" colors={designTokens.colors.surface.sakura} />
    </div>
  ),
}

export const AllColors: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Color System</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Complete color palette for the Suwappu UI design system
      </p>
      <ColorGroup title="Brand Palette" colors={{
        sakuraPinkLight: designTokens.colors.brand.sakuraPinkLight,
        sakuraPinkMid: designTokens.colors.brand.sakuraPinkMid,
        magentaCore: designTokens.colors.brand.magentaCore,
        roseGradientStart: designTokens.colors.brand.roseGradientStart,
        magentaGradientMid: designTokens.colors.brand.magentaGradientMid,
        deepPurpleGradientEnd: designTokens.colors.brand.deepPurpleGradientEnd,
        royalPurpleDeep: designTokens.colors.brand.royalPurpleDeep,
      }} />
      <ColorGroup title="Secondary Palette" colors={designTokens.colors.secondary} />
      <ColorGroup title="Semantic Colors" colors={designTokens.colors.semantic} />
      <ColorGroup title="Neutral Colors" colors={designTokens.colors.neutral} />
      <ColorGroup title="Dark Surface" colors={designTokens.colors.surface.sakura} />
    </div>
  ),
}
