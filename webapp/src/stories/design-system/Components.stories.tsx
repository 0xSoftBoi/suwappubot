import type { Meta, StoryObj } from '@storybook/react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Components',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

export const Buttons: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-8">Buttons</h1>

      <div className="space-y-8">
        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">Primary</h2>
          <div className="flex flex-wrap gap-4">
            <button className="px-8 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover active:translate-y-0">
              Large Primary
            </button>
            <button className="px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover active:translate-y-0">
              Medium Primary
            </button>
            <button className="px-4 py-2 text-sm bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover active:translate-y-0">
              Small Primary
            </button>
          </div>
        </div>

        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">Secondary</h2>
          <div className="flex flex-wrap gap-4">
            <button className="px-6 py-3 bg-transparent text-suwappu-magenta-mid font-heading font-semibold rounded-suwappu-pill border-2 border-suwappu-sakura-mid transition-all duration-300 hover:bg-suwappu-sakura-light/30 hover:border-suwappu-magenta-mid">
              Secondary
            </button>
            <button className="px-6 py-3 bg-transparent text-suwappu-purple font-heading font-semibold rounded-suwappu-pill transition-all duration-300 hover:bg-suwappu-sakura-light/20">
              Ghost
            </button>
          </div>
        </div>

        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">Icon Buttons</h2>
          <div className="flex flex-wrap gap-4">
            <button className="w-12 h-12 bg-suwappu-petal text-suwappu-purple-deep rounded-full shadow-suwappu-2 flex items-center justify-center transition-all duration-300 hover:scale-110 hover:rotate-6 hover:shadow-suwappu-3">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
            <button className="w-12 h-12 bg-suwappu-gradient text-white rounded-full shadow-suwappu-button flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-suwappu-button-hover">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">States</h2>
          <div className="flex flex-wrap gap-4">
            <button className="px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button opacity-50 cursor-not-allowed">
              Disabled
            </button>
            <button className="px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button flex items-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading
            </button>
          </div>
        </div>
      </div>
    </div>
  ),
}

export const Cards: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-8">Cards</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-2 border border-suwappu-sakura-light/25 transition-all duration-300 hover:-translate-y-1 hover:shadow-suwappu-3">
          <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-2">Standard Card</h3>
          <p className="font-body text-suwappu-text-secondary text-sm">
            A simple card with hover lift effect and subtle shadow.
          </p>
        </div>

        <div className="p-6 bg-suwappu-card rounded-suwappu-xxl shadow-suwappu-2 border border-suwappu-sakura-light/25 transition-all duration-300 hover:-translate-y-1 hover:shadow-suwappu-3">
          <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-2">Feature Card</h3>
          <p className="font-body text-suwappu-text-secondary text-sm">
            Card with gradient background for featured content.
          </p>
        </div>

        <div className="p-6 bg-suwappu-glass backdrop-blur-md rounded-suwappu-xxl shadow-suwappu-2 border border-suwappu-sakura-mid/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-suwappu-3">
          <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-2">Glass Card</h3>
          <p className="font-body text-suwappu-text-secondary text-sm">
            Glassmorphism card with blur effect.
          </p>
        </div>

        <div className="p-6 bg-suwappu-gradient rounded-suwappu-xxl shadow-suwappu-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-suwappu-4">
          <h3 className="font-heading text-lg font-bold text-white mb-2">Brand Card</h3>
          <p className="font-body text-suwappu-sakura-light text-sm">
            Card with primary gradient for emphasis.
          </p>
        </div>

        <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-2 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full border-4 border-suwappu-sakura-mid shadow-suwappu-glow bg-linear-to-br from-suwappu-sakura-light to-suwappu-rose flex items-center justify-center text-2xl">
            🌸
          </div>
          <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-1">Avatar Card</h3>
          <p className="font-body text-suwappu-text-secondary text-sm">Profile card variant</p>
        </div>
      </div>
    </div>
  ),
}

export const Inputs: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-8">Inputs</h1>

      <div className="max-w-md space-y-6">
        <div>
          <label className="block text-sm font-heading font-semibold text-suwappu-purple mb-2">
            Standard Input
          </label>
          <input
            type="text"
            placeholder="Enter text..."
            className="w-full px-5 py-4 bg-white/90 border-2 border-suwappu-sakura-mid/30 rounded-suwappu-lg shadow-suwappu-1 font-body text-suwappu-text placeholder-suwappu-text-secondary/50 transition-all duration-300 focus:outline-hidden focus:border-suwappu-magenta-mid focus:shadow-suwappu-glow"
          />
        </div>

        <div>
          <label className="block text-sm font-heading font-semibold text-suwappu-purple mb-2">
            Search Input
          </label>
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search..."
              className="w-full pl-12 pr-5 py-4 bg-white/90 border-2 border-suwappu-sakura-mid/30 rounded-suwappu-lg shadow-suwappu-1 font-body text-suwappu-text placeholder-suwappu-text-secondary/50 transition-all duration-300 focus:outline-hidden focus:border-suwappu-magenta-mid focus:shadow-suwappu-glow"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-heading font-semibold text-suwappu-purple mb-2">
            Textarea
          </label>
          <textarea
            placeholder="Enter message..."
            rows={4}
            className="w-full px-5 py-4 bg-white/90 border-2 border-suwappu-sakura-mid/30 rounded-suwappu-xl shadow-suwappu-1 font-body text-suwappu-text placeholder-suwappu-text-secondary/50 transition-all duration-300 focus:outline-hidden focus:border-suwappu-magenta-mid focus:shadow-suwappu-glow resize-y"
          />
        </div>
      </div>
    </div>
  ),
}

export const Badges: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-8">Badges</h1>

      <div className="flex flex-wrap gap-4">
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-petal text-suwappu-purple-deep">
          Primary
        </span>
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-cyan/30 text-suwappu-navy">
          Secondary
        </span>
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-success/30 text-green-800">
          Success
        </span>
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-warning/40 text-orange-800">
          Warning
        </span>
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-error/30 text-red-800">
          Error
        </span>
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-info/30 text-blue-800">
          Info
        </span>
      </div>

      <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mt-8 mb-4">With Icons</h2>
      <div className="flex flex-wrap gap-4">
        <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-success/30 text-green-800">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Verified
        </span>
        <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-petal text-suwappu-purple-deep">
          <span className="w-2 h-2 rounded-full bg-suwappu-magenta animate-pulse" />
          Live
        </span>
        <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-heading font-semibold bg-suwappu-gradient text-white">
          ⭐ Premium
        </span>
      </div>
    </div>
  ),
}

export const LoadingStates: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-8">Loading States</h1>

      <div className="space-y-8">
        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">Spinner</h2>
          <div className="flex gap-6 items-center">
            <div className="w-10 h-10 rounded-full border-4 border-suwappu-sakura-mid/30 border-t-suwappu-magenta-mid animate-spin" />
            <div className="w-8 h-8 rounded-full border-3 border-suwappu-sakura-mid/30 border-t-suwappu-purple animate-spin" />
            <div className="w-6 h-6 rounded-full border-2 border-suwappu-sakura-mid/30 border-t-suwappu-magenta animate-spin" />
          </div>
        </div>

        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">Dots</h2>
          <div className="flex gap-2">
            {[0, 0.15, 0.3].map((delay, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-full bg-suwappu-magenta-mid animate-suwappu-bounce"
                style={{ animationDelay: `${delay}s` }}
              />
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4">Skeleton</h2>
          <div className="max-w-md space-y-4">
            <div className="suwappu-shimmer h-6 rounded-suwappu-md" />
            <div className="suwappu-shimmer h-4 rounded-suwappu-sm w-3/4" />
            <div className="suwappu-shimmer h-4 rounded-suwappu-sm w-1/2" />
            <div className="flex gap-4 mt-6">
              <div className="suwappu-shimmer w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="suwappu-shimmer h-4 rounded w-1/3" />
                <div className="suwappu-shimmer h-3 rounded w-2/3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
}
