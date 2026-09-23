import type { DayRow } from '@/lib/admin/club-week';

/**
 * Who opened the app, read back from PostHog — the one thing the database can't
 * answer. A member who opens the app every day but hasn't run this week looks
 * identical to one who deleted it, until you ask PostHog.
 *
 * Needs a PERSONAL API key (Settings → Personal API keys, scope `query:read`):
 * the NEXT_PUBLIC project token the browser uses can only send events. Without
 * the key this returns null and the tile hides — the admin home must never wait
 * on, or fail because of, an analytics vendor. Same for a slow answer: 3s cap.
 *
 * Counts by the `athlete_id` person property PostHogIdentity sets on identify,
 * so staff sessions and anonymous visitors don't count as members.
 */

const DEFAULT_HOST = 'https://eu.posthog.com';
const DEFAULT_PROJECT = '109306';

export async function fetchAppOpens(sinceDays = 15): Promise<DayRow[] | null> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) return null;
  const host = process.env.POSTHOG_API_HOST || DEFAULT_HOST;
  const project = process.env.POSTHOG_PROJECT_ID || DEFAULT_PROJECT;

  const query = [
    "SELECT DISTINCT person.properties.athlete_id, toString(toDate(timestamp, 'Asia/Jerusalem'))",
    'FROM events',
    "WHERE event = '$pageview'",
    `AND timestamp >= now() - INTERVAL ${Math.max(1, Math.floor(sinceDays))} DAY`,
    "AND notEmpty(toString(person.properties.athlete_id))",
    'LIMIT 10000',
  ].join(' ');

  try {
    const res = await fetch(`${host}/api/projects/${project}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: unknown[][] };
    if (!Array.isArray(body.results)) return null;
    return body.results
      .filter(r => typeof r[0] === 'string' && typeof r[1] === 'string')
      .map(r => ({ athleteId: r[0] as string, day: r[1] as string }));
  } catch {
    return null;
  }
}
