import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_SUPABASE_URL } from './tests/race-live/seeded-race';

/**
 * Race-live smoke (tests/race-live, round 6 task 174). Like the a11y run (#242), it builds
 * and serves the app with PLACEHOLDER env, so it can never touch a real database; the spec
 * answers every request. Separate from playwright.config.ts, which drives `npm run dev`
 * against a real .env.local.
 */
const PLACEHOLDER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: FIXTURE_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
  ANTHROPIC_API_KEY: 'placeholder',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
};

export default defineConfig({
  testDir: './tests/race-live',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3101', ...devices['Pixel 7'], locale: 'he-IL', timezoneId: 'Europe/Madrid' },
  projects: [{ name: 'chromium-mobile', use: { browserName: 'chromium' } }],
  webServer: {
    command: process.env.RACE_SKIP_BUILD ? 'npx next start -p 3101' : 'npm run build && npx next start -p 3101',
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    timeout: 900_000,
    env: PLACEHOLDER_ENV,
  },
});
