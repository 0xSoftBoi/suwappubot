'use client';

import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export default class TerminalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="code-block">
          <div className="code-block__header">
            <span className="code-block__dot code-block__dot--red" />
            <span className="code-block__dot code-block__dot--yellow" />
            <span className="code-block__dot code-block__dot--green" />
            <span className="code-block__filename">@suwappu/sdk</span>
          </div>
          <div style={{ padding: '1.25rem', minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: '#999', fontSize: '0.875rem' }}>Terminal demo unavailable</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
