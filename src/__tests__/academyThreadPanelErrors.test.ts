import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The academy chat sheet (?thread=mine) spun forever when the open failed:
// the token-mint failure, a missing session and a failed Stream watch() all
// left a spinner. Source-level, like academyIntake.test.ts — the panel needs
// Stream + Supabase to mount.
const src = readFileSync(join(__dirname, '../components/academy/AcademyThreadPanel.tsx'), 'utf8');

describe('AcademyThreadPanel — a failed open is an error with a retry, not a spinner', () => {
  it('reads the token mint failure, not only its data', () => {
    expect(src).toContain('useStreamTokenState(supabaseToken, attempt)');
    expect(src).toMatch(/token\.failed && autoRetry\.current\.exhausted \? THREAD_ERROR_FALLBACK/);
  });

  it('a missing session is an error', () => {
    expect(src).toMatch(/if \(!access && !failOpen\('session'\)\) setError\(THREAD_ERROR_FALLBACK\)/);
  });

  it('a failed watch() is checked before the !channel spinner', () => {
    const errorAt = src.indexOf('if (!channel && error)');
    const spinnerAt = src.indexOf('if (!client || !channel)');
    expect(errorAt).toBeGreaterThan(-1);
    expect(errorAt).toBeLessThan(spinnerAt);
  });

  it('offers נסה שוב', () => {
    expect(src).toContain('נסה שוב');
    expect(src.match(/<RetryButton onRetry=/g)?.length).toBe(2);
  });
});
