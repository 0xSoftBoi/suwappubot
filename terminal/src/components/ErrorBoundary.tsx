import React from 'react'

interface Props {
  children: React.ReactNode
  /** Optional label so a panel-level boundary can name what failed. */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render-time crashes so one broken panel (or a bad API shape) doesn't
 * take down the whole terminal with a blank white screen. Shows a compact,
 * on-brand fallback with a retry. Wrap the app at the root and, ideally, each
 * major panel individually.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console for debugging; a telemetry hook can go here later.
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <div className="font-mono text-xs uppercase tracking-wider text-red-400">
            {this.props.label ? `${this.props.label} failed to render` : 'Something went wrong'}
          </div>
          <p className="max-w-sm text-[11px] text-neutral-400">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="rounded border border-neutral-700 px-3 py-1 font-mono text-[11px] text-neutral-200 hover:bg-neutral-800"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded border border-neutral-700 px-3 py-1 font-mono text-[11px] text-neutral-200 hover:bg-neutral-800"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
