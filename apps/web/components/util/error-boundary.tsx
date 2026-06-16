"use client";

import { Component, type ReactNode } from "react";

/**
 * Minimal error boundary. Wrap a non-critical widget that lives in always-present chrome (e.g. the
 * header notification bell) so a render throw inside it degrades to a fallback instead of blanking the
 * whole app. Keeps a single crash from taking down every route.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
