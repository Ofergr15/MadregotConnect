import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession, type SessionUser } from '@/lib/auth-session';
import { CONTENT_KINDS, levelsFor, readGrants, seesAny, type ContentKind, type ContentLevels } from '@/lib/access/grants';

/**
 * A Content route's gate by level (lib/access/grants.ts): `min` 1 to read a part,
 * 3 to publish in it; `kind` null = any part at all (the hub's own reads).
 * `legacy` is the route's own rule from before grants, kept exactly — whoever it
 * let in still gets in with every part; a grant only ever adds people to it.
 */
export async function requireContentLevel(request: Request, kind: ContentKind | null, min: 1 | 3, legacy: (u: SessionUser) => boolean): Promise<
  { denied: Response; user?: undefined; levels?: undefined } | { denied: null; user: SessionUser; levels: ContentLevels }
> {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth) };
  if (legacy(auth.user)) return { denied: null, user: auth.user, levels: Object.fromEntries(CONTENT_KINDS.map((k) => [k, 3])) as ContentLevels };
  const grant = auth.user.athleteId ? (await readGrants(createServerClient()))[auth.user.athleteId] : undefined;
  const levels = levelsFor({ role: 'runner' }, grant);
  const ok = kind ? levels[kind] >= min : seesAny(levels);
  if (!ok) return { denied: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  return { denied: null, user: auth.user, levels };
}
