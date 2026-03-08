import { useState } from 'react'

export default function TryIt() {
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('/v1/agent/chains')
  const [headers, setHeaders] = useState('Authorization: Bearer YOUR_API_KEY')
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)

  const send = async () => {
    setLoading(true)
    setResponse(null)
    setStatus(null)

    try {
      const headerObj: Record<string, string> = { 'Content-Type': 'application/json' }
      headers.split('\n').filter(Boolean).forEach((line) => {
        const idx = line.indexOf(':')
        if (idx > 0) {
          headerObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
        }
      })

      const res = await fetch(url, {
        method,
        headers: headerObj,
        ...(method !== 'GET' && method !== 'HEAD' && body ? { body } : {}),
      })

      setStatus(res.status)
      const text = await res.text()
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2))
      } catch {
        setResponse(text)
      }
    } catch (err) {
      setResponse(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md"
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 px-3 py-2 text-sm font-mono bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md"
          placeholder="/v1/agent/..."
        />
        <button
          onClick={send}
          disabled={loading}
          className="px-4 py-2 text-sm font-semibold text-white bg-suwappu-gradient rounded-suwappu-pill hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>

      <div>
        <label className="text-xs font-semibold text-suwappu-text-secondary dark:text-gray-400 uppercase">Headers (one per line)</label>
        <textarea
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          rows={2}
          className="w-full mt-1 px-3 py-2 text-xs font-mono bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md resize-none"
        />
      </div>

      {method !== 'GET' && method !== 'HEAD' && (
        <div>
          <label className="text-xs font-semibold text-suwappu-text-secondary dark:text-gray-400 uppercase">Body (JSON)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full mt-1 px-3 py-2 text-xs font-mono bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md resize-none"
            placeholder='{"key": "value"}'
          />
        </div>
      )}

      {response !== null && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-suwappu-text-secondary dark:text-gray-400 uppercase">Response</span>
            {status !== null && (
              <span className={`text-xs font-mono font-bold ${status < 400 ? 'text-green-600' : 'text-red-500'}`}>
                {status}
              </span>
            )}
          </div>
          <pre className="text-xs font-mono bg-gray-50 dark:bg-dark-bg p-3 rounded-suwappu-md overflow-auto max-h-64 border border-suwappu-sakura-light/20 dark:border-dark-border">
            {response}
          </pre>
        </div>
      )}
    </div>
  )
}
