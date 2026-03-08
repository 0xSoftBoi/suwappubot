import { useState } from 'react'
import GlassCard from '../components/layout/GlassCard'
import ApiDocViewer from '../components/docs/ApiDocViewer'
import TryIt from '../components/docs/TryIt'

export default function DeveloperPage() {
  const [tab, setTab] = useState<'docs' | 'try' | 'register'>('docs')
  const [regName, setRegName] = useState('')
  const [regDesc, setRegDesc] = useState('')
  const [regCallback, setRegCallback] = useState('')
  const [regResult, setRegResult] = useState<string | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegLoading(true)
    setRegResult(null)

    try {
      const res = await fetch('/v1/agent/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName,
          description: regDesc || undefined,
          callback_url: regCallback || undefined,
        }),
      })
      const data = await res.json()
      setRegResult(JSON.stringify(data, null, 2))
    } catch (err) {
      setRegResult(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setRegLoading(false)
    }
  }

  const copyApiKey = () => {
    if (!regResult) return
    try {
      const parsed = JSON.parse(regResult)
      const key = parsed?.agent?.api_key
      if (key) {
        navigator.clipboard.writeText(key)
        setCopiedKey(true)
        setTimeout(() => setCopiedKey(false), 2000)
      }
    } catch {}
  }

  const tabs = [
    { id: 'docs' as const, label: 'API Docs' },
    { id: 'try' as const, label: 'Try It' },
    { id: 'register' as const, label: 'Register Agent' },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-heading font-bold dark:text-dark-text">Developer Portal</h2>

      <div className="flex gap-1 border-b border-suwappu-sakura-light/20 dark:border-dark-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-suwappu-magenta text-suwappu-magenta'
                : 'border-transparent text-suwappu-text-secondary dark:text-gray-400 hover:text-suwappu-text dark:hover:text-dark-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <GlassCard className="p-6">
        {tab === 'docs' && <ApiDocViewer />}
        {tab === 'try' && <TryIt />}
        {tab === 'register' && (
          <div className="space-y-6 max-w-lg">
            <div>
              <h3 className="text-lg font-heading font-bold dark:text-dark-text mb-1">Register a New Agent</h3>
              <p className="text-sm text-suwappu-text-secondary dark:text-gray-400">
                Create an API key for an external AI agent to use the Suwappu API.
              </p>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium dark:text-dark-text mb-1">Agent Name *</label>
                <input
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30"
                  placeholder="my-trading-agent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium dark:text-dark-text mb-1">Description</label>
                <textarea
                  value={regDesc}
                  onChange={(e) => setRegDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30 resize-none"
                  placeholder="Agent description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium dark:text-dark-text mb-1">Callback URL</label>
                <input
                  value={regCallback}
                  onChange={(e) => setRegCallback(e.target.value)}
                  type="url"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30"
                  placeholder="https://your-agent.com/webhook"
                />
              </div>
              <button
                type="submit"
                disabled={regLoading || !regName.trim()}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-suwappu-gradient rounded-suwappu-pill hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {regLoading ? 'Registering...' : 'Register Agent'}
              </button>
            </form>

            {regResult && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-suwappu-text-secondary dark:text-gray-400 uppercase">Result</span>
                  <button
                    onClick={copyApiKey}
                    className="text-xs text-suwappu-magenta hover:underline"
                  >
                    {copiedKey ? 'Copied!' : 'Copy API Key'}
                  </button>
                </div>
                <pre className="text-xs font-mono bg-gray-50 dark:bg-dark-bg p-3 rounded-suwappu-md overflow-auto max-h-64 border border-suwappu-sakura-light/20 dark:border-dark-border">
                  {regResult}
                </pre>
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  )
}
