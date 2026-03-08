import type { Meta, StoryObj } from '@storybook/react'
import { SakuraShowcaseCarousel } from '../../components/showcase/SakuraShowcaseCarousel'
import type { ShowcaseCard } from '../../components/showcase/SakuraShowcaseCarousel'

const sampleCards: ShowcaseCard[] = [
  {
    id: 'cross-chain',
    title: 'Cross-Chain Swaps',
    subtitle: '7+ Networks',
    description: 'Seamlessly swap tokens across Ethereum, Base, Polygon, Arbitrum, and more with optimal routing.',
    badge: 'Featured',
    badgeColor: 'rgba(233,30,140,0.6)',
    gradient: 'linear-gradient(135deg, #6C3483 0%, #C44569 50%, #E91E8C 100%)',
    accentColor: '#E91E8C',
    icon: '⇄',
    stats: [
      { label: 'Chains', value: '7+' },
      { label: 'Avg Time', value: '~45s' },
      { label: 'Routes', value: '100+' },
    ],
  },
  {
    id: 'passkey-wallet',
    title: 'Passkey Wallets',
    subtitle: 'TEE-Secured',
    description: 'Hardware-level security with device passkeys. No seed phrases, no browser extensions.',
    badge: 'New',
    badgeColor: 'rgba(74,222,128,0.5)',
    gradient: 'linear-gradient(135deg, #1A237E 0%, #3B82F6 50%, #87CEEB 100%)',
    accentColor: '#3B82F6',
    icon: '🔐',
    stats: [
      { label: 'Security', value: 'TEE' },
      { label: 'Setup', value: '<10s' },
    ],
  },
  {
    id: 'price-alerts',
    title: 'Smart Alerts',
    subtitle: 'Real-Time',
    description: 'Set custom price alerts on any token. Get notified instantly via Telegram when targets hit.',
    gradient: 'linear-gradient(135deg, #F8A5C2 0%, #FFB7C5 50%, #FFD1DC 100%)',
    accentColor: '#F8A5C2',
    icon: '🔔',
    stats: [
      { label: 'Tokens', value: '500+' },
      { label: 'Latency', value: '<1s' },
    ],
  },
  {
    id: 'limit-orders',
    title: 'Limit Orders',
    subtitle: 'Set & Forget',
    description: 'Place limit orders that execute automatically when your price target is reached.',
    badge: 'Beta',
    badgeColor: 'rgba(139,92,246,0.5)',
    gradient: 'linear-gradient(135deg, #4A235A 0%, #6C3483 50%, #8B5CF6 100%)',
    accentColor: '#8B5CF6',
    icon: '📊',
    stats: [
      { label: 'Active', value: '24/7' },
      { label: 'Gas', value: 'Optimized' },
    ],
  },
  {
    id: 'portfolio',
    title: 'Portfolio View',
    subtitle: 'All Chains',
    description: 'Unified view of all your holdings across every supported chain in one dashboard.',
    gradient: 'linear-gradient(135deg, #0D1B4C 0%, #1A237E 50%, #3B82F6 100%)',
    accentColor: '#627EEA',
    icon: '💎',
  },
]

const meta = {
  title: 'Showcase/SakuraShowcaseCarousel',
  component: SakuraShowcaseCarousel,
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'suwappu', values: [{ name: 'suwappu', value: '#FFFBFC' }] },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SakuraShowcaseCarousel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    cards: sampleCards,
    title: 'Discover Suwappu',
    subtitle: 'What we offer',
  },
}

export const WithoutHeader: Story = {
  args: {
    cards: sampleCards,
  },
}

export const TwoCards: Story = {
  args: {
    cards: sampleCards.slice(0, 2),
    title: 'Highlights',
  },
}
