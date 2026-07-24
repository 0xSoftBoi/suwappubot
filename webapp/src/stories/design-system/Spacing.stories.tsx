import type { Meta, StoryObj } from '@storybook/react'
import { designTokens } from '../../theme/tokens'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Spacing & Layout',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

export const SpacingScale: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Spacing</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Consistent spacing scale based on 8px unit
      </p>

      <div className="space-y-4">
        {Object.entries(designTokens.spacing.scale).map(([name, value]) => (
          <div key={name} className="flex items-center gap-4">
            <div className="w-24 font-heading font-semibold text-suwappu-purple">{name}</div>
            <div className="w-16 text-sm text-suwappu-text-secondary">{value}px</div>
            <div
              className="h-6 bg-linear-to-r from-suwappu-sakura-mid to-suwappu-rose rounded"
              style={{ width: value }}
            />
          </div>
        ))}
      </div>
    </div>
  ),
}

export const BorderRadius: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Border Radius</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Rounded corners from subtle to full pill shapes
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Object.entries(designTokens.borderRadius).map(([name, value]) => (
          <div key={name} className="text-center">
            <div
              className="w-24 h-24 bg-linear-to-br from-suwappu-sakura-light to-suwappu-rose shadow-suwappu-2 mx-auto mb-3"
              style={{ borderRadius: value }}
            />
            <div className="font-heading font-semibold text-suwappu-purple">{name}</div>
            <div className="text-sm text-suwappu-text-secondary">{value}px</div>
          </div>
        ))}
      </div>
    </div>
  ),
}

export const ContainerWidths: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Container Widths</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Responsive container max-widths for different screen sizes
      </p>

      <div className="space-y-6">
        {[
          { name: 'sm', width: 640 },
          { name: 'md', width: 768 },
          { name: 'lg', width: 1024 },
          { name: 'xl', width: 1280 },
          { name: 'xxl', width: 1536 },
        ].map(({ name, width }) => (
          <div key={name}>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-heading font-semibold text-suwappu-purple w-12">{name}</span>
              <span className="text-sm text-suwappu-text-secondary">{width}px</span>
            </div>
            <div
              className="h-8 bg-linear-to-r from-suwappu-sakura-mid to-suwappu-purple rounded-suwappu-sm"
              style={{ width: `${(width / 1536) * 100}%`, maxWidth: width }}
            />
          </div>
        ))}
      </div>
    </div>
  ),
}

export const GridExample: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">12-Column Grid</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Flexible grid system for layout composition
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-12 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-12 bg-linear-to-br from-suwappu-sakura-light to-suwappu-rose rounded-suwappu-sm shadow-suwappu-1 flex items-center justify-center text-xs font-heading font-bold text-suwappu-purple"
            >
              {i + 1}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-6 h-16 bg-linear-to-br from-suwappu-rose to-suwappu-magenta-mid rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-white">
            col-span-6
          </div>
          <div className="col-span-6 h-16 bg-linear-to-br from-suwappu-magenta-mid to-suwappu-purple rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-white">
            col-span-6
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-4 h-16 bg-linear-to-br from-suwappu-sakura-mid to-suwappu-rose rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-suwappu-purple-deep">
            col-span-4
          </div>
          <div className="col-span-8 h-16 bg-linear-to-br from-suwappu-rose to-suwappu-purple rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-white">
            col-span-8
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-3 h-16 bg-linear-to-br from-suwappu-sakura-light to-suwappu-sakura-mid rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-suwappu-purple">
            3
          </div>
          <div className="col-span-3 h-16 bg-linear-to-br from-suwappu-sakura-mid to-suwappu-rose rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-suwappu-purple-deep">
            3
          </div>
          <div className="col-span-3 h-16 bg-linear-to-br from-suwappu-rose to-suwappu-magenta-mid rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-white">
            3
          </div>
          <div className="col-span-3 h-16 bg-linear-to-br from-suwappu-magenta-mid to-suwappu-purple rounded-suwappu-md shadow-suwappu-2 flex items-center justify-center font-heading font-bold text-white">
            3
          </div>
        </div>
      </div>
    </div>
  ),
}
