'use client';

import React from 'react';
import { clientLogger } from '@/lib/client-logger';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    clientLogger.error(`React render error: ${error.message}`, {
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center space-y-3">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="text-sm underline"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
