import { defineConfig, devices } from '@playwright/test';

/**
 * Accessibility run (tests/a11y). Separate from playwright.config.ts on purpose: that
 * one drives `npm run dev` against a real .env.local; this one builds and serves the
 * app with PLACEHOLDER env so it can never touch a real database. See tests/a11y/axe.spec.ts.
 */
const PLACEHOLDER_ENV = {
  // Not 'placeholder': the client refuses that host. A made-up project; the spec answers every request to it.
  NEXT_PUBLIC_SUPABASE_URL: 'https://a11y-fixture.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
  ANTHROPIC_API_KEY: 'placeholder',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
};

export default defineConfig({
  testDir: './tests/a11y',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3100', ...devices['Pixel 7'], locale: 'he-IL' },
  projects: [{ name: 'chromium-mobile', use: { browserName: 'chromium' } }],
  webServer: {
    command: process.env.A11Y_SKIP_BUILD ? 'npx next start -p 3100' : 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 600_000,
    env: PLACEHOLDER_ENV,
  },
});
