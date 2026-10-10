import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { hasWatchSchema, watchNotEnabled } from '@/lib/watch/schema';
import { registerDevice } from '@/lib/watch/devices';
import { json, readJson } from '@/lib/watch/http';

/**
 * POST /api/device/register — the companion iPhone app, signed in as the athlete
 * (a normal Supabase session, `Authorization: Bearer <supabase JWT>`), trades that
 * session for long-lived device credentials. The refresh token is returned ONCE;
 * only its hash is kept. See docs/apple-watch.md.
 *
 * The athlete is the session's and nobody else's: there is no athlete id in the
 * body, and a super user viewing as someone cannot register a phone for them.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = createServerClient();
  if (!(await hasWatchSchema(supabase))) return watchNotEnabled();

  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  if (auth.user.viewingAsBy) return json({ error: 'view-as cannot register a device' }, 403);

  const body = await readJson(request, 16 * 1024);
  if (!body) return json({ error: 'JSON body required' }, 400);

  const result = await registerDevice(supabase, auth.user.athleteId, body);
  if ('error' in result) return json({ error: result.error }, result.status);
  return json(result, 201);
}
