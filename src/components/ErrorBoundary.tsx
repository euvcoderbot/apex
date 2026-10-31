import {Component, type ReactNode} from 'react';

/**
 * One failing view must not blank the page or the other views. The page renders again whenever its data
 * or selection changes, which hands this boundary new children, so it retries then.
 */
export class ErrorBoundary extends Component<{children: ReactNode; name?: string}, {error: Error | null}> {
  state: {error: Error | null} = {error: null};

  static getDerivedStateFromError(error: Error) { return {error}; }

  componentDidCatch(error: Error) { console.error(`View "${this.props.name || 'unknown'}" failed to render`, error); }

  componentDidUpdate(previous: {children: ReactNode}) {
    if (this.state.error && previous.children !== this.props.children) this.setState({error: null});
  }

  render() {
    return this.state.error
      ? <div className="view-error" role="alert">This view could not be displayed. Change the selection or reload the page to try again.</div>
      : this.props.children;
  }
}
