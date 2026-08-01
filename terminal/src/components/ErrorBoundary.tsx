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
          className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-6 text-center"
        >
          <div className="terminal-theme-caption font-mono text-[10px] uppercase text-bear">
            {this.props.label ? `${this.props.label} failed to render` : 'Something went wrong'}
          </div>
          <p className="max-w-sm text-[12px] leading-[1.5] text-terminal-text-secondary">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <p className="max-w-sm text-[11px] leading-[1.5] text-terminal-text-muted">
            Retry re-renders this panel only; Reload restarts the terminal. Your
            positions and orders are unaffected.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              onClick={this.reset}
              className="terminal-button-secondary font-mono text-[11px]"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="terminal-button-secondary font-mono text-[11px]"
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
