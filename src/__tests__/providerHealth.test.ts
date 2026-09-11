import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_HEALTH_COLUMNS_101,
  STALE_AFTER_DAYS,
  connectionState,
  looksLikeAuthFailure,
} from '@/lib/providers/health';

/**
 * The bug these exist for: "Connected" meant `garmin_auth IS NOT NULL`, a value
 * that never changes after the day someone connects. Two properties matter more
 * than the rest — a working connection must never be told to reconnect (that sends
 * a member to re-enter a password for nothing), and a rejected credential must
 * never keep saying "Connected" (that hides missing runs indefinitely).
 */

const root = join(__dirname, '..', '..');
const NOW = Date.parse('2026-09-11T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('connectionState', () => {
  it('has no opinion about a row with no credential', () => {
    expect(connectionState({ hasAuth: false, lastSyncAt: ago(1) }, NOW)).toBe('none');
  });

  it('calls a recently synced credential healthy', () => {
    expect(connectionState({ hasAuth: true, lastSyncAt: ago(0.2) }, NOW)).toBe('ok');
  });

  it('reads an unstamped credential as unknown, not as broken', () => {
    // The whole pre-101 club, and every connection in the first hour of its life.
    // 'unknown' renders as plain "Connected" — the pre-101 wording — because the
    // alternative is accusing ~20 working accounts on the deploy that ships this.
    expect(connectionState({ hasAuth: true, lastSyncAt: null, authFailedAt: null }, NOW)).toBe('unknown');
    expect(connectionState({ hasAuth: true }, NOW)).toBe('unknown');
  });

  it('goes stale only after the grace window', () => {
    expect(connectionState({ hasAuth: true, lastSyncAt: ago(STALE_AFTER_DAYS - 1) }, NOW)).toBe('ok');
    expect(connectionState({ hasAuth: true, lastSyncAt: ago(STALE_AFTER_DAYS + 1) }, NOW)).toBe('stale');
  });

  it('reports a refused credential as failed', () => {
    expect(connectionState({ hasAuth: true, authFailedAt: ago(0.5), lastSyncAt: null }, NOW)).toBe('failed');
    expect(connectionState({ hasAuth: true, authFailedAt: ago(0.5), lastSyncAt: ago(3) }, NOW)).toBe('failed');
  });

  it('lets a later success overrule an earlier failure', () => {
    // A sync clears the flag, but ordering by timestamp too means a failure whose
    // clearing write was lost (pre-101, or a dropped update) cannot pin a working
    // account on "Reconnect needed" forever.
    expect(connectionState({ hasAuth: true, authFailedAt: ago(3), lastSyncAt: ago(0.1) }, NOW)).toBe('ok');
    expect(connectionState({ hasAuth: true, authFailedAt: ago(40), lastSyncAt: ago(30) }, NOW)).toBe('stale');
  });

  it('ignores an unparseable timestamp instead of guessing', () => {
    expect(connectionState({ hasAuth: true, lastSyncAt: 'not a date' }, NOW)).toBe('unknown');
    expect(connectionState({ hasAuth: true, authFailedAt: 'not a date', lastSyncAt: ago(1) }, NOW)).toBe('ok');
  });
});

describe('looksLikeAuthFailure', () => {
  it('recognises the shapes the two providers actually throw', () => {
    // StravaClient throws StravaApiError, which carries `status`.
    expect(looksLikeAuthFailure(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(true);
    expect(looksLikeAuthFailure({ status: 403 })).toBe(true);
    // garmin-connect surfaces the status inside the message.
    expect(looksLikeAuthFailure(new Error('Request failed with status code 401'))).toBe(true);
    expect(looksLikeAuthFailure(new Error('invalid_grant'))).toBe(true);
    expect(looksLikeAuthFailure(new Error('OAuth token expired'))).toBe(true);
  });

  it('does not flag a provider outage or a network error', () => {
    // The expensive false positive: this state tells a member to go and re-enter
    // their Garmin password, so a Garmin 500 must not trigger it for the club.
    expect(looksLikeAuthFailure(new Error('fetch failed'))).toBe(false);
    expect(looksLikeAuthFailure(Object.assign(new Error('Server Error'), { status: 500 }))).toBe(false);
    expect(looksLikeAuthFailure(new Error('socket hang up'))).toBe(false);
    expect(looksLikeAuthFailure(new Error('Too Many Requests'))).toBe(false);
    expect(looksLikeAuthFailure(null)).toBe(false);
  });
});

describe('migration 101', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/101_provider_connection_health.sql'), 'utf8');

  it('adds every column the select fragment names', () => {
    for (const column of PROVIDER_HEALTH_COLUMNS_101.split(',').map(c => c.trim())) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column} TIMESTAMPTZ`);
    }
  });

  it('backfills nothing', () => {
    // Deliberate: NULL is "not stamped yet", which the UI shows as the old
    // wording. A backfill would have to invent a sync time.
    expect(sql).not.toMatch(/^\s*UPDATE\s+athletes/mi);
  });
});

describe('the profile screen', () => {
  const page = readFileSync(join(root, 'src/app/(app)/dashboard/profile/page.tsx'), 'utf8');

  it('no longer asserts "Connected" when the request fails', () => {
    // The literal bug: an effect on `meError` ran setHasGarmin(true) and
    // setDataSource('garmin'), so any 401 or blip painted a confident
    // "Connected · Garmin Connect" that nothing ever cleared.
    expect(page).not.toMatch(/if \(!meError\) return;/);
    expect(page).toContain('const connectionUnknown = !!meError && !meData;');
  });

  it('revalidates after the writes that change a connection', () => {
    // Connecting a watch and switching source both used to edit local state only,
    // leaving the cached /api/athletes/me — the source of the pill — behind.
    expect(page.match(/mutateMe\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
