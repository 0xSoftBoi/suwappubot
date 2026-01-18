import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Navigation } from '../components/Navigation'

const meta = {
  title: 'Components/Navigation',
  component: Navigation,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    activeTab: {
      control: 'radio',
      options: ['portfolio', 'history'],
      description: 'Currently active tab',
    },
    onTabChange: {
      description: 'Callback when tab changes',
    },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '200px', position: 'relative' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Navigation>

export default meta
type Story = StoryObj<typeof meta>

export const PortfolioActive: Story = {
  args: {
    activeTab: 'portfolio',
    onTabChange: () => {},
  },
}

export const HistoryActive: Story = {
  args: {
    activeTab: 'history',
    onTabChange: () => {},
  },
}

export const Interactive: Story = {
  args: {
    activeTab: 'portfolio',
    onTabChange: () => {},
  },
  render: () => {
    const [activeTab, setActiveTab] = useState<'portfolio' | 'history'>('portfolio')
    return (
      <div style={{ minHeight: '200px', position: 'relative' }}>
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <p style={{ color: 'var(--tg-theme-text-color)' }}>
            Active: <strong>{activeTab}</strong>
          </p>
        </div>
        <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    )
  },
}
