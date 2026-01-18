import type { Meta, StoryObj } from '@storybook/react'
import { designTokens } from '../../theme/tokens'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Shadows',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

interface ShadowBoxProps {
  name: string
  shadow: string
  usage?: string
}

function ShadowBox({ name, shadow, usage }: ShadowBoxProps) {
  return (
    <div className="space-y-3">
      <div
        className="h-24 bg-white rounded-suwappu-xl flex items-center justify-center"
        style={{ boxShadow: shadow }}
      >
        <span className="font-heading font-semibold text-suwappu-purple">{name}</span>
      </div>
      {usage && (
        <p className="text-xs text-suwappu-text-secondary font-body">{usage}</p>
      )}
    </div>
  )
}

export const ElevationLevels: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Shadows</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Elevation and shadow system for depth perception
      </p>

      <h2 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-4">Elevation Levels</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
        <ShadowBox name="Level 1" shadow={designTokens.shadows.level1} usage="Inputs, small cards" />
        <ShadowBox name="Level 2" shadow={designTokens.shadows.level2} usage="Cards, dropdowns" />
        <ShadowBox name="Level 3" shadow={designTokens.shadows.level3} usage="Modals, popovers" />
        <ShadowBox name="Level 4" shadow={designTokens.shadows.level4} usage="Tooltips, FAB" />
      </div>

      <h2 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-4">Special Shadows</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <ShadowBox name="Inset" shadow={designTokens.shadows.inset} usage="Pressed states, inputs" />
        <ShadowBox name="Glow" shadow={designTokens.shadows.glow} usage="Highlight, focus" />
        <ShadowBox name="Button" shadow={designTokens.shadows.buttonPrimary} usage="Primary buttons" />
      </div>
    </div>
  ),
}

export const ButtonShadows: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Button Shadow States</h1>

      <div className="flex flex-wrap gap-8 items-start">
        <div className="text-center space-y-3">
          <div
            className="px-8 py-4 bg-suwappu-gradient rounded-suwappu-pill text-white font-heading font-bold"
            style={{ boxShadow: designTokens.shadows.buttonPrimary }}
          >
            Default
          </div>
          <p className="text-xs text-suwappu-text-secondary">buttonPrimary</p>
        </div>

        <div className="text-center space-y-3">
          <div
            className="px-8 py-4 bg-suwappu-gradient rounded-suwappu-pill text-white font-heading font-bold transform -translate-y-1"
            style={{ boxShadow: designTokens.shadows.buttonHover }}
          >
            Hover
          </div>
          <p className="text-xs text-suwappu-text-secondary">buttonHover</p>
        </div>

        <div className="text-center space-y-3">
          <div
            className="px-8 py-4 bg-suwappu-gradient rounded-suwappu-pill text-white font-heading font-bold"
            style={{ boxShadow: designTokens.shadows.buttonActive }}
          >
            Active
          </div>
          <p className="text-xs text-suwappu-text-secondary">buttonActive</p>
        </div>
      </div>
    </div>
  ),
}

export const GlowEffects: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-purple-deep min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-sakura-mid mb-8 suwappu-text-glow">
        Glow Effects
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div
          className="p-8 bg-white/10 rounded-suwappu-xxl backdrop-blur"
          style={{ boxShadow: designTokens.shadows.glow }}
        >
          <h3 className="font-heading text-xl font-bold text-white mb-2">Sakura Glow</h3>
          <p className="font-body text-suwappu-sakura-light">
            A soft, multi-layered glow effect inspired by cherry blossoms
          </p>
        </div>

        <div className="p-8 bg-gradient-to-br from-suwappu-sakura-light to-suwappu-rose rounded-suwappu-xxl shadow-suwappu-glow">
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">Petal Card</h3>
          <p className="font-body text-suwappu-purple">
            Cards with the sakura glow effect for highlighted content
          </p>
        </div>
      </div>
    </div>
  ),
}
