import posthog from 'posthog-js';

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

// Keep local development and unconfigured deployments free of analytics noise.
if (projectToken) {
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
}
