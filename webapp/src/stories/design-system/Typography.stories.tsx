import type { Meta, StoryObj } from '@storybook/react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Typography',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

export const FontFamilies: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen space-y-8">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Font Families</h1>

      <div className="space-y-6">
        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2">
          <p className="text-sm font-body text-suwappu-text-secondary mb-2">Display - Pacifico</p>
          <p className="font-display text-4xl text-suwappu-magenta-mid">
            The quick brown fox jumps over the lazy dog
          </p>
        </div>

        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2">
          <p className="text-sm font-body text-suwappu-text-secondary mb-2">Heading - Quicksand</p>
          <p className="font-heading text-3xl font-bold text-suwappu-purple">
            The quick brown fox jumps over the lazy dog
          </p>
        </div>

        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2">
          <p className="text-sm font-body text-suwappu-text-secondary mb-2">Body - Nunito</p>
          <p className="font-body text-lg text-suwappu-text">
            The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet,
            consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </p>
        </div>
      </div>
    </div>
  ),
}

export const TypeScale: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen space-y-6">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Type Scale</h1>

      <div className="space-y-4">
        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">Display - 3.5rem</span>
          <p className="font-display text-6xl text-suwappu-magenta-mid" style={{ fontSize: '3.5rem', lineHeight: 1.1 }}>
            Suwappu
          </p>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">H1 - 2.5rem</span>
          <h1 className="font-heading text-4xl font-bold text-suwappu-purple-deep" style={{ fontSize: '2.5rem' }}>
            Heading One
          </h1>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">H2 - 2rem</span>
          <h2 className="font-heading text-3xl font-bold text-suwappu-purple" style={{ fontSize: '2rem' }}>
            Heading Two
          </h2>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">H3 - 1.5rem</span>
          <h3 className="font-heading text-2xl font-semibold text-suwappu-magenta-mid" style={{ fontSize: '1.5rem' }}>
            Heading Three
          </h3>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">H4 - 1.25rem</span>
          <h4 className="font-heading text-xl font-semibold text-suwappu-text" style={{ fontSize: '1.25rem' }}>
            Heading Four
          </h4>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">Body Large - 1.125rem</span>
          <p className="font-body text-lg text-suwappu-text" style={{ fontSize: '1.125rem', lineHeight: 1.6 }}>
            Body large text for emphasis and lead paragraphs.
          </p>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">Body - 1rem</span>
          <p className="font-body text-base text-suwappu-text" style={{ lineHeight: 1.65 }}>
            Regular body text for paragraphs and general content.
          </p>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">Small - 0.875rem</span>
          <p className="font-body text-sm text-suwappu-text-secondary" style={{ fontSize: '0.875rem' }}>
            Small text for secondary information and helper text.
          </p>
        </div>

        <div className="p-4 bg-white rounded-suwappu-lg shadow-suwappu-1">
          <span className="text-xs font-body text-suwappu-text-secondary">Caption - 0.75rem</span>
          <p className="font-body text-xs uppercase tracking-wider text-suwappu-text-secondary font-medium" style={{ fontSize: '0.75rem', letterSpacing: '0.08em' }}>
            Caption text for labels
          </p>
        </div>
      </div>
    </div>
  ),
}

export const TextEffects: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen space-y-6">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Text Effects</h1>

      <div className="space-y-6">
        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2">
          <span className="text-xs font-body text-suwappu-text-secondary block mb-2">Gradient Text</span>
          <p className="font-heading text-4xl font-bold suwappu-gradient-text">
            Gradient Text Effect
          </p>
        </div>

        <div className="p-6 bg-suwappu-purple-deep rounded-suwappu-xl shadow-suwappu-2">
          <span className="text-xs font-body text-suwappu-sakura-light block mb-2">Text Glow</span>
          <p className="font-display text-4xl text-suwappu-sakura-mid suwappu-text-glow">
            Glowing Sakura
          </p>
        </div>

        <div className="p-6 bg-gradient-to-r from-suwappu-sakura-light to-suwappu-sky rounded-suwappu-xl shadow-suwappu-2">
          <span className="text-xs font-body text-suwappu-purple block mb-2">Emboss Effect</span>
          <p
            className="font-heading text-4xl font-bold text-white"
            style={{ textShadow: '1px 1px 0 rgba(255,255,255,0.8), -1px -1px 0 rgba(108,52,131,0.15)' }}
          >
            Embossed Text
          </p>
        </div>
      </div>
    </div>
  ),
}
