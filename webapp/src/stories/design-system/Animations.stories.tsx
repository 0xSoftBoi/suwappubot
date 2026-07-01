import type { Meta, StoryObj } from '@storybook/react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Animations',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

function SakuraPetal({ delay = 0, left = 0 }: { delay?: number; left?: number }) {
  return (
    <svg
      className="absolute w-6 h-6 suwappu-petal"
      style={{ left: `${left}%`, animationDelay: `${delay}s` }}
      viewBox="0 0 24 24"
      fill="url(#petalGradient)"
    >
      <defs>
        <linearGradient id="petalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFD1DC" />
          <stop offset="50%" stopColor="#FFB7C5" />
          <stop offset="100%" stopColor="#F8A5C2" />
        </linearGradient>
      </defs>
      <path d="M12 2C8 2 4 6 4 10c0 3 2 6 8 12 6-6 8-9 8-12 0-4-4-8-8-8z" />
    </svg>
  )
}

export const PetalFloat: Story = {
  render: () => (
    <div className="relative h-96 bg-linear-to-b from-suwappu-sky to-suwappu-bg overflow-hidden rounded-suwappu-xxl">
      {Array.from({ length: 15 }).map((_, i) => (
        <SakuraPetal key={i} delay={i * 0.5} left={Math.random() * 90} />
      ))}
      <div className="absolute inset-0 flex items-center justify-center">
        <h2 className="font-display text-4xl text-suwappu-magenta-mid suwappu-text-glow">
          Sakura Petals
        </h2>
      </div>
    </div>
  ),
}

export const Bounce: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Bounce Animation</h1>

      <div className="flex gap-8 items-end h-32">
        <div className="text-center">
          <div className="w-16 h-16 bg-suwappu-gradient rounded-full shadow-suwappu-3 animate-suwappu-bounce" />
          <p className="mt-4 text-sm text-suwappu-text-secondary">Default</p>
        </div>

        <div className="text-center">
          <div
            className="w-16 h-16 bg-suwappu-petal rounded-full shadow-suwappu-3 animate-suwappu-bounce"
            style={{ animationDelay: '0.2s' }}
          />
          <p className="mt-4 text-sm text-suwappu-text-secondary">Delay 0.2s</p>
        </div>

        <div className="text-center">
          <div
            className="w-16 h-16 bg-linear-to-br from-suwappu-cyan to-suwappu-blue rounded-full shadow-suwappu-3 animate-suwappu-bounce"
            style={{ animationDelay: '0.4s' }}
          />
          <p className="mt-4 text-sm text-suwappu-text-secondary">Delay 0.4s</p>
        </div>
      </div>

      <div className="mt-8 flex gap-4">
        {['#FFB7C5', '#C44569', '#6C3483'].map((color, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full animate-suwappu-bounce"
            style={{
              backgroundColor: color,
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-suwappu-text-secondary">Loading dots</p>
    </div>
  ),
}

export const Shimmer: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Shimmer Effect</h1>

      <div className="space-y-4 max-w-md">
        <div className="suwappu-shimmer h-8 rounded-suwappu-md" />
        <div className="suwappu-shimmer h-4 rounded-suwappu-sm w-3/4" />
        <div className="suwappu-shimmer h-4 rounded-suwappu-sm w-1/2" />

        <div className="p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 mt-8">
          <div className="flex items-center gap-4">
            <div className="suwappu-shimmer w-12 h-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="suwappu-shimmer h-4 rounded w-1/2" />
              <div className="suwappu-shimmer h-3 rounded w-3/4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
}

export const HeartBurst: Story = {
  render: () => {
    const triggerAnimation = (e: React.MouseEvent<HTMLButtonElement>) => {
      const btn = e.currentTarget
      btn.classList.remove('animate-suwappu-heart')
      void btn.offsetWidth // Trigger reflow
      btn.classList.add('animate-suwappu-heart')
    }

    return (
      <div className="p-8 bg-suwappu-bg min-h-screen">
        <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Heart Burst</h1>
        <p className="font-body text-suwappu-text-secondary mb-8">Click the heart to trigger the animation</p>

        <button
          onClick={triggerAnimation}
          className="w-24 h-24 bg-suwappu-gradient rounded-full shadow-suwappu-glow flex items-center justify-center text-white text-4xl hover:scale-110 transition-transform"
        >
          ❤️
        </button>
      </div>
    )
  },
}

export const HoverEffects: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Hover Effects</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2 transition-all duration-300 hover:-translate-y-2 hover:shadow-suwappu-4 cursor-pointer">
          <h3 className="font-heading font-bold text-suwappu-purple mb-2">Card Lift</h3>
          <p className="text-sm text-suwappu-text-secondary">Hover to lift the card</p>
        </div>

        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2 transition-all duration-300 hover:shadow-suwappu-glow cursor-pointer border border-transparent hover:border-suwappu-sakura-mid">
          <h3 className="font-heading font-bold text-suwappu-purple mb-2">Glow Border</h3>
          <p className="text-sm text-suwappu-text-secondary">Hover for glow effect</p>
        </div>

        <div className="p-6 bg-white rounded-suwappu-xl shadow-suwappu-2 transition-all duration-300 hover:bg-linear-to-br hover:from-suwappu-sakura-light hover:to-white cursor-pointer group">
          <h3 className="font-heading font-bold text-suwappu-purple mb-2 group-hover:text-suwappu-magenta-mid transition-colors">
            Background Change
          </h3>
          <p className="text-sm text-suwappu-text-secondary">Hover for gradient</p>
        </div>
      </div>

      <h2 className="font-heading text-xl font-bold text-suwappu-purple-deep mt-12 mb-4">Button Hover States</h2>

      <div className="flex flex-wrap gap-4">
        <button className="px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
          Lift & Glow
        </button>

        <button className="px-6 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1 transition-all duration-300 hover:bg-suwappu-sakura-light hover:border-suwappu-magenta-mid">
          Border & Fill
        </button>

        <button className="px-6 py-3 text-suwappu-purple font-heading font-bold rounded-suwappu-pill transition-all duration-300 hover:bg-suwappu-sakura-light/50">
          Ghost Button
        </button>
      </div>
    </div>
  ),
}

export const TimingFunctions: Story = {
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-6">Timing Functions</h1>

      <div className="space-y-8">
        {[
          { name: 'default', easing: 'cubic-bezier(0.4, 0, 0.2, 1)', desc: 'Standard easing' },
          { name: 'easeIn', easing: 'cubic-bezier(0.4, 0, 1, 1)', desc: 'Accelerate' },
          { name: 'easeOut', easing: 'cubic-bezier(0, 0, 0.2, 1)', desc: 'Decelerate' },
          { name: 'bounce', easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)', desc: 'Playful bounce' },
          { name: 'spring', easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', desc: 'Spring effect' },
        ].map(({ name, easing, desc }) => (
          <div key={name} className="group">
            <div className="flex items-center gap-4 mb-2">
              <span className="font-heading font-semibold text-suwappu-purple w-20">{name}</span>
              <span className="text-sm text-suwappu-text-secondary">{desc}</span>
            </div>
            <div className="h-12 bg-white rounded-suwappu-lg shadow-suwappu-1 relative overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full w-12 bg-suwappu-gradient rounded-suwappu-lg transition-transform duration-700 group-hover:translate-x-[calc(100vw-200px)]"
                style={{ transitionTimingFunction: easing }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-suwappu-text-secondary">
        Hover over each row to see the timing function in action
      </p>
    </div>
  ),
}
