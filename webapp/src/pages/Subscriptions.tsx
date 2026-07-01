import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { api } from '../lib/api'
import { openExternalLink } from '../lib/telegram'
import { a11yToast } from '../lib/a11yToast'

interface Plan {
  id: string
  name: string
  price: number
  period: 'month' | 'year'
  features: string[]
  popular?: boolean
  current?: boolean
}

const plans: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: 'month',
    features: [
      '5 swaps per day',
      'Basic price alerts',
      'Standard gas settings',
      'Community support',
    ],
    current: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 9.99,
    period: 'month',
    features: [
      'Unlimited swaps',
      'Advanced price alerts',
      'Priority gas settings',
      'Copy trading access',
      'Limit orders',
      'Priority support',
    ],
    popular: true,
  },
  {
    id: 'premium',
    name: 'Whale',
    price: 29.99,
    period: 'month',
    features: [
      'Everything in Pro',
      'API access',
      'Custom strategies',
      'Dedicated account manager',
      'Early feature access',
      'Zero platform fees',
    ],
  },
]

function PlanCard({ plan, onSelect }: { plan: Plan; onSelect: (id: string) => void }) {
  return (
    <div className={`relative bg-white rounded-suwappu-xl shadow-suwappu-1 p-4 ${
      plan.popular ? 'ring-2 ring-suwappu-magenta-mid' : ''
    }`}>
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-suwappu-magenta-mid text-white text-xs font-bold rounded-full">
          Most Popular
        </div>
      )}
      
      <div className="text-center mb-4">
        <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep">{plan.name}</h3>
        <div className="flex items-baseline justify-center gap-1 mt-2">
          <span className="text-3xl font-heading font-bold text-suwappu-text">
            ${plan.price}
          </span>
          {plan.price > 0 && (
            <span className="text-sm text-suwappu-text-secondary">/{plan.period}</span>
          )}
        </div>
      </div>

      <ul className="space-y-2 mb-4">
        {plan.features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="text-suwappu-success mt-0.5">✓</span>
            <span className="text-suwappu-text">{feature}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={() => onSelect(plan.id)}
        disabled={plan.current}
        className={`w-full py-2.5 rounded-suwappu-lg font-heading font-semibold text-sm transition-colors ${
          plan.current
            ? 'bg-suwappu-sakura-light text-suwappu-text-secondary cursor-default'
            : plan.popular
            ? 'bg-linear-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white'
            : 'bg-suwappu-purple-deep text-white hover:bg-suwappu-purple-deep/90'
        }`}
      >
        {plan.current ? 'Current Plan' : plan.price === 0 ? 'Downgrade' : 'Upgrade'}
      </button>
    </div>
  )
}

export function Subscriptions() {
  const navigate = useNavigate()
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [payingCard, setPayingCard] = useState(false)

  const handleSelect = (planId: string) => {
    if (planId === 'free') return
    setSelectedPlan(planId)
    setShowConfirm(true)
  }

  const plan = plans.find(p => p.id === selectedPlan)

  const handlePayWithCard = async () => {
    if (!plan || (plan.id !== 'pro' && plan.id !== 'premium')) return
    setPayingCard(true)
    try {
      const { url } = await api.createStripeCheckout(plan.id)
      setShowConfirm(false)
      openExternalLink(url)
    } catch {
      a11yToast.error("Couldn't start card checkout. Please try again or pay with crypto.")
    } finally {
      setPayingCard(false)
    }
  }

  return (
    <AppLayout 
      header={<AppHeader title="Premium" showBack onBack={() => navigate(-1)} />} 
      activeNav="settings"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Header */}
        <div className="text-center py-4">
          <div className="w-16 h-16 mx-auto mb-3 bg-linear-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-full flex items-center justify-center">
            <span className="text-3xl">👑</span>
          </div>
          <h2 className="font-heading font-bold text-xl text-suwappu-purple-deep">
            Upgrade to Premium
          </h2>
          <p className="text-sm text-suwappu-text-secondary mt-1">
            Unlock powerful trading features
          </p>
        </div>

        {/* Plans */}
        <div className="space-y-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onSelect={handleSelect} />
          ))}
        </div>

        {/* FAQ */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
              FAQ
            </span>
          </div>
          <div className="divide-y divide-suwappu-sakura-mid/10">
            <div className="p-3">
              <p className="font-medium text-sm text-suwappu-text mb-1">Can I cancel anytime?</p>
              <p className="text-xs text-suwappu-text-secondary">
                Yes! Cancel anytime with no fees. You'll keep premium until the end of your billing period.
              </p>
            </div>
            <div className="p-3">
              <p className="font-medium text-sm text-suwappu-text mb-1">What payment methods?</p>
              <p className="text-xs text-suwappu-text-secondary">
                We accept crypto (ETH, USDC, SOL) and cards via Stripe.
              </p>
            </div>
            <div className="p-3">
              <p className="font-medium text-sm text-suwappu-text mb-1">Is there a free trial?</p>
              <p className="text-xs text-suwappu-text-secondary">
                Pro plan includes a 7-day free trial. Cancel before it ends to avoid charges.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Confirm Modal */}
      {showConfirm && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowConfirm(false)}>
          <div 
            className="bg-white w-full max-w-sm rounded-suwappu-xl p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-magenta-light/30 rounded-full flex items-center justify-center">
                <span className="text-2xl">👑</span>
              </div>
              <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep">
                Upgrade to {plan.name}
              </h3>
              <p className="text-sm text-suwappu-text-secondary">
                ${plan.price}/{plan.period}
              </p>
            </div>

            <div className="space-y-2 mb-4">
              <button className="w-full py-3 bg-suwappu-purple-deep text-white rounded-suwappu-lg font-medium text-sm flex items-center justify-center gap-2">
                <span>Pay with ETH</span>
                <span className="text-white/70">Ξ</span>
              </button>
              <button className="w-full py-3 bg-suwappu-success text-white rounded-suwappu-lg font-medium text-sm flex items-center justify-center gap-2">
                <span>Pay with USDC</span>
                <span className="text-white/70">$</span>
              </button>
              <button
                onClick={handlePayWithCard}
                disabled={payingCard}
                className="w-full py-3 bg-gray-800 text-white rounded-suwappu-lg font-medium text-sm disabled:opacity-60"
              >
                {payingCard ? 'Opening checkout…' : 'Pay with Card'}
              </button>
            </div>

            <button
              onClick={() => setShowConfirm(false)}
              className="w-full py-2 text-suwappu-text-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
