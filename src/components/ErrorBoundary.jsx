import { Component } from 'react'
import { ErrorState } from './ui'

/**
 * The last line of defence around a routed page.
 *
 * Without one, a single render error unmounts the whole tree and leaves a blank
 * screen with nothing but a console line to go on. This keeps the shell drawn
 * and puts the failure on the page, with the reload the rest of the app uses
 * for a failed read.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ui] a page failed to render', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card">
        <ErrorState
          title="This page could not be displayed."
          description={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    )
  }
}
