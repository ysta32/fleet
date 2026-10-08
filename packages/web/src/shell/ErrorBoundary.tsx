import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  /** What stopped, in the operator's words: "The 3D view", "The dashboard". */
  area: string;
  /** What still works while this area is down. */
  fallbackHint: string;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[fleet] ${this.props.area} crashed`, error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="state-panel state-error" role="alert">
        <Icon name="x" className="state-icon" />
        <h2 className="state-title">{this.props.area} stopped.</h2>
        <p>
          {error.message || 'An unexpected error was thrown while rendering.'} {this.props.fallbackHint}
        </p>
        <div className="state-actions">
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            <Icon name="replay" />
            Reload view
          </button>
        </div>
      </div>
    );
  }
}
