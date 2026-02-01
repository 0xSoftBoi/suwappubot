import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const { login } = useAuth()
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return

    setLoading(true)
    setError('')

    const success = await login(key.trim())
    if (!success) {
      setError('Invalid admin key')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-suwappu-bg p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-heading font-bold bg-suwappu-gradient bg-clip-text text-transparent">
            Suwappu
          </h1>
          <p className="text-sm text-suwappu-text-secondary mt-2">Admin Dashboard</p>
        </div>

        <div className="bg-white/80 backdrop-blur-xl border border-suwappu-sakura-light/20 rounded-suwappu-xl shadow-suwappu-3 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-suwappu-text mb-1.5">
                Admin API Key
              </label>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your admin key"
                autoFocus
                className="w-full px-4 py-2.5 text-sm bg-white border border-suwappu-sakura-light/30 rounded-suwappu-md focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30 focus:border-suwappu-magenta/50 placeholder:text-suwappu-text-secondary/50"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !key.trim()}
              className="w-full py-2.5 text-sm font-semibold text-white bg-suwappu-gradient rounded-suwappu-pill hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Validating...' : 'Sign In'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}
