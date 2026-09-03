import type { PostHog } from 'posthog-js';

/**
 * Lazy loader for posthog-js.
 *
 * `instrumentation-client.ts` used to import the SDK at the top level, which put
 * ~200 KB of analytics into the bundle EVERY page has to download and parse
 * before React hydrates — on a phone that is time the athlete spends looking at a
 * screen that doesn't respond yet, spent on code whose only job is to report on
 * them. Loading it after first paint costs a fraction of a second of early
 * autocapture and nothing else; PostHog still captures the entry pageview when it
 * initialises.
 *
 * `loadPostHog` is idempotent, so several callers (the instrumentation hook, the
 * identity component) can each ask for it and only one init happens.
 */

let pending: Promise<PostHog | null> | null = null;
let instance: PostHog | null = null;

export function loadPostHog(): Promise<PostHog | null> {
  if (pending) return pending;

  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  // Keep local development and unconfigured deployments free of analytics noise.
  if (!projectToken) {
    pending = Promise.resolve(null);
    return pending;
  }

  pending = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(projectToken, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        defaults: '2026-05-30',
        capture_pageview: 'history_change',
        capture_pageleave: true,
        autocapture: true,
        person_profiles: 'identified_only',
        session_recording: {
          // Training plans and account details can be entered in forms. Keep those
          // values out of recordings while retaining navigation and click behavior.
          maskAllInputs: true,
        },
      });
      instance = posthog;
      return posthog;
    })
    .catch(() => null); // A blocked analytics bundle must never break the page.

  return pending;
}

/** Run `fn` once PostHog is ready, loading it if needed. No-op when unconfigured. */
export function withPostHog(fn: (posthog: PostHog) => void): void {
  void loadPostHog().then(posthog => {
    if (posthog) fn(posthog);
  });
}

/**
 * Run `fn` only if PostHog is ALREADY loaded — for teardown-ish calls such as
 * `reset()` on sign-out, where pulling the SDK down just to forget an identity
 * we never recorded would defeat the point of deferring it.
 */
export function withLoadedPostHog(fn: (posthog: PostHog) => void): void {
  if (instance) fn(instance);
}
