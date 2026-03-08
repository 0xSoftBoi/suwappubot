import type { Meta, StoryObj } from '@storybook/react'
import { designTokens } from '../../theme/tokens'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Gradients',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

interface GradientCardProps {
  name: string
  gradient: string
  textColor?: string
}

function GradientCard({ name, gradient, textColor = 'white' }: GradientCardProps) {
  return (
    <div className="space-y-2">
      <div
        className="h-32 rounded-suwappu-xl shadow-suwappu-2 flex items-end p-4"
        style={{ background: gradient }}
      >
        <span className="font-heading font-semibold" style={{ color: textColor }}>
          {name}
        </span>
      </div>
      <code className="text-xs text-suwappu-text-secondary font-mono block truncate">
        {gradient.slice(0, 60)}...
      </code>
    </div>
  )
}

export const AllGradients: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Gradients</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Beautiful gradient combinations for the Suwappu UI
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <GradientCard name="Primary Brand" gradient={designTokens.gradients.primaryBrand} />
        <GradientCard name="Button Hover" gradient={designTokens.gradients.buttonHover} />
        <GradientCard name="Petal" gradient={designTokens.gradients.petalGradient} textColor="#6C3483" />
        <GradientCard name="Card Ambient" gradient={designTokens.gradients.cardAmbient} textColor="#4A235A" />
        <GradientCard name="Glass Light" gradient={designTokens.gradients.glassLight} textColor="#4A235A" />
        <GradientCard name="Glass Dark" gradient={designTokens.gradients.glassDark} />
        <GradientCard name="Feature Card" gradient={designTokens.gradients.featureCard} textColor="#4A235A" />
      </div>
    </div>
  ),
}

export const GradientButtons: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Gradient Buttons</h1>

      <div className="flex flex-wrap gap-4">
        <button
          className="px-8 py-4 rounded-suwappu-pill font-heading font-bold text-white shadow-suwappu-button transition-all duration-300 hover:shadow-suwappu-button-hover hover:-translate-y-0.5"
          style={{ background: designTokens.gradients.primaryBrand }}
        >
          Primary Button
        </button>

        <button
          className="px-8 py-4 rounded-suwappu-pill font-heading font-bold text-white shadow-suwappu-button transition-all duration-300 hover:shadow-suwappu-button-hover hover:-translate-y-0.5"
          style={{ background: designTokens.gradients.buttonHover }}
        >
          Hover Style
        </button>

        <button
          className="px-8 py-4 rounded-suwappu-pill font-heading font-bold text-suwappu-purple-deep shadow-suwappu-button transition-all duration-300 hover:shadow-suwappu-button-hover hover:-translate-y-0.5"
          style={{ background: designTokens.gradients.petalGradient }}
        >
          Petal Style
        </button>
      </div>
    </div>
  ),
}

export const GradientCards: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Gradient Cards</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          className="p-6 rounded-suwappu-xxl shadow-suwappu-3"
          style={{ background: designTokens.gradients.featureCard }}
        >
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">Feature Card</h3>
          <p className="font-body text-suwappu-text">
            A beautiful card with the feature gradient background.
          </p>
        </div>

        <div
          className="p-6 rounded-suwappu-xxl shadow-suwappu-3 backdrop-blur-md"
          style={{ background: designTokens.glassmorphism.light.background }}
        >
          <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">Glass Card</h3>
          <p className="font-body text-suwappu-text">
            A glassmorphism card with blur effect.
          </p>
        </div>

        <div
          className="p-6 rounded-suwappu-xxl shadow-suwappu-3"
          style={{ background: designTokens.gradients.glassDark }}
        >
          <h3 className="font-heading text-xl font-bold text-white mb-2">Dark Glass Card</h3>
          <p className="font-body text-suwappu-sakura-light">
            A dark glassmorphism card variant.
          </p>
        </div>

        <div
          className="p-6 rounded-suwappu-xxl shadow-suwappu-3"
          style={{ background: designTokens.gradients.primaryBrand }}
        >
          <h3 className="font-heading text-xl font-bold text-white mb-2">Brand Card</h3>
          <p className="font-body text-suwappu-sakura-light">
            A card using the primary brand gradient.
          </p>
        </div>
      </div>
    </div>
  ),
}
