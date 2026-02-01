import { useState, useEffect } from 'react'
import { publicFetch } from '../../api/client'

interface PathItem {
  summary?: string
  description?: string
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: { type: string } }>
  requestBody?: { content?: { 'application/json'?: { schema?: Record<string, unknown> } } }
  responses?: Record<string, { description?: string }>
}

interface OpenApiSpec {
  info?: { title?: string; version?: string; description?: string }
  paths?: Record<string, Record<string, PathItem>>
}

export default function ApiDocViewer() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    publicFetch<OpenApiSpec>('/v1/agent/openapi')
      .then(setSpec)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="text-suwappu-error text-sm">Failed to load API spec: {error}</p>
  if (!spec) return <p className="text-sm text-suwappu-text-secondary dark:text-gray-400">Loading API spec...</p>

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const methodColors: Record<string, string> = {
    get: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    post: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    put: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    patch: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }

  return (
    <div className="space-y-2">
      {spec.info && (
        <div className="mb-4">
          <h3 className="text-lg font-heading font-bold dark:text-dark-text">
            {spec.info.title} <span className="text-sm font-normal text-suwappu-text-secondary">v{spec.info.version}</span>
          </h3>
          {spec.info.description && <p className="text-sm text-suwappu-text-secondary dark:text-gray-400 mt-1">{spec.info.description}</p>}
        </div>
      )}

      {spec.paths && Object.entries(spec.paths).map(([path, methods]) =>
        Object.entries(methods).map(([method, details]) => {
          const key = `${method}-${path}`
          const isOpen = expanded.has(key)
          return (
            <div key={key} className="border border-suwappu-sakura-light/20 dark:border-dark-border rounded-suwappu-md overflow-hidden">
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-suwappu-sakura-light/5 dark:hover:bg-dark-border/20 transition-colors"
              >
                <span className={`px-2 py-0.5 text-xs font-bold uppercase rounded ${methodColors[method] || 'bg-gray-100 text-gray-600'}`}>
                  {method}
                </span>
                <code className="text-sm font-mono dark:text-dark-text">{path}</code>
                <span className="text-xs text-suwappu-text-secondary dark:text-gray-400 ml-auto">{details.summary}</span>
                <svg className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-suwappu-sakura-light/10 dark:border-dark-border/50 space-y-3 pt-3">
                  {details.description && <p className="text-sm text-suwappu-text-secondary dark:text-gray-400">{details.description}</p>}
                  {details.parameters && details.parameters.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-suwappu-text-secondary dark:text-gray-400 mb-1">Parameters</p>
                      <div className="space-y-1">
                        {details.parameters.map((p) => (
                          <div key={p.name} className="flex items-center gap-2 text-xs">
                            <code className="font-mono dark:text-dark-text">{p.name}</code>
                            <span className="text-suwappu-text-secondary dark:text-gray-500">({p.in})</span>
                            {p.required && <span className="text-suwappu-error text-[10px]">required</span>}
                            {p.schema?.type && <span className="text-suwappu-purple dark:text-suwappu-sakura-mid">{p.schema.type}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {details.requestBody?.content?.['application/json']?.schema && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-suwappu-text-secondary dark:text-gray-400 mb-1">Request Body</p>
                      <pre className="text-xs bg-gray-50 dark:bg-dark-bg p-2 rounded overflow-auto max-h-48">
                        {JSON.stringify(details.requestBody.content['application/json'].schema, null, 2)}
                      </pre>
                    </div>
                  )}
                  {details.responses && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-suwappu-text-secondary dark:text-gray-400 mb-1">Responses</p>
                      {Object.entries(details.responses).map(([code, resp]) => (
                        <div key={code} className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold dark:text-dark-text">{code}</span>
                          <span className="text-suwappu-text-secondary dark:text-gray-400">{resp.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
