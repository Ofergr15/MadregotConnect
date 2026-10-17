'use client';

import { Component, type ReactNode } from 'react';

/**
 * A card that throws renders nothing instead of taking the screen down with it,
 * and tries again when `resetKey` changes (its data arrived). For the cards above
 * the feed, which open on data saved by the previous release (lib/swr-persist,
 * CROSS_RELEASE_KEYS): if a release changed an answer's shape, the old copy may
 * not fit the new card, and the right outcome is "the card a second later", not a
 * blank feed.
 */
export class QuietBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { failed: boolean; key?: unknown }> {
  state: { failed: boolean; key?: unknown } = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { failed: boolean; key?: unknown }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.warn('[QuietBoundary] card hidden after an error', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
