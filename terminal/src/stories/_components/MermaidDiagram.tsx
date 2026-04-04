import { useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'

let mermaidInitialized = false
let diagramCounter = 0

function initializeMermaid() {
  if (mermaidInitialized) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    fontFamily: 'Inter, system-ui, sans-serif',
    themeVariables: {
      darkMode: true,
      background: '#0f0f18',
      primaryColor: '#12121a',
      primaryTextColor: '#e8e6e3',
      primaryBorderColor: '#2a2a40',
      secondaryColor: '#1a1a2e',
      secondaryTextColor: '#e8e6e3',
      secondaryBorderColor: '#ff2d78',
      tertiaryColor: '#050508',
      tertiaryTextColor: '#b7b7c9',
      tertiaryBorderColor: '#3a3a56',
      lineColor: '#8a8a9c',
      textColor: '#e8e6e3',
      mainBkg: '#0f0f18',
      nodeBorder: '#2a2a40',
      edgeLabelBackground: '#0f0f18',
      clusterBkg: '#0f0f18',
      clusterBorder: '#2a2a40',
      titleColor: '#e8e6e3',
      cScale0: '#12121a',
      cScale1: '#1a1a2e',
      cScale2: '#12121a',
      cScale3: '#1a1a2e',
      cScale4: '#12121a',
      cScale5: '#1a1a2e',
      pie1: '#ff2d78',
      pie2: '#22c55e',
      pie3: '#f59e0b',
      pie4: '#3b82f6',
      pie5: '#8b5cf6',
      pie6: '#6fbcf0',
      pie7: '#f97316',
    },
  })

  mermaidInitialized = true
}

export function MermaidDiagram({
  chart,
  title,
}: {
  chart: string
  title: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  const diagramId = useMemo(() => {
    diagramCounter += 1
    return `mermaid-diagram-${diagramCounter}`
  }, [])

  useEffect(() => {
    initializeMermaid()

    let cancelled = false
    setError(null)

    mermaid
      .render(diagramId, chart)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !containerRef.current) return
        containerRef.current.innerHTML = svg
        bindFunctions?.(containerRef.current)
      })
      .catch((renderError: unknown) => {
        if (cancelled) return
        setError(renderError instanceof Error ? renderError.message : String(renderError))
      })

    return () => {
      cancelled = true
    }
  }, [chart, diagramId])

  if (error) {
    return (
      <div className="terminal-panel p-4">
        <div className="mb-2 text-sm font-semibold text-bear">Mermaid render failed</div>
        <div className="mb-3 text-xs text-terminal-text-muted">{title}</div>
        <pre className="overflow-x-auto rounded bg-terminal-bg p-3 text-[11px] text-terminal-text-secondary">
          {error}
        </pre>
        <pre className="mt-3 overflow-x-auto rounded bg-terminal-bg p-3 text-[11px] text-terminal-text-secondary">
          {chart}
        </pre>
      </div>
    )
  }

  return (
    <div className="terminal-panel overflow-hidden p-4">
      <div
        ref={containerRef}
        className="[&_svg]:h-auto [&_svg]:w-full"
      />
    </div>
  )
}
