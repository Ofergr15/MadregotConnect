import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession, type SessionUser } from '@/lib/auth-session';
import { levelsFor, readGrants, type ContentKind } from '@/lib/access/grants';
import { addDraft, type DraftPath } from '@/lib/access/drafts';
import { notifyAthlete } from '@/lib/push';
import { SUPER_USER_EMAIL } from '@/lib/constants';

/**
 * The gate of a Content publish route (lib/access/grants + drafts). The route's own rule
 * from before grants (`legacy`) still publishes, exactly as it did; level 3 publishes
 * too; level 2 keeps the request as a draft for an admin (answered here: { draft: true })
 * and tells the club owner; anything else is refused.
 */
export async function publishGate(request: Request, kind: ContentKind, path: DraftPath, legacy: (u: SessionUser) => boolean): Promise<
  { denied: Response; user?: undefined } | { denied: null; user: SessionUser }
> {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth) };
  const user = auth.user;
  if (legacy(user)) return { denied: null, user };
  const db = createServerClient();
  const grant = user.athleteId ? (await readGrants(db))[user.athleteId] : undefined;
  const level = levelsFor({ role: 'runner' }, grant)[kind];
  if (level >= 3) return { denied: null, user };
  if (level !== 2) return { denied: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };

  const body = await request.clone().json().catch(() => null);
  const { data: me } = user.athleteId ? await db.from('athletes').select('name').eq('id', user.athleteId).maybeSingle() : { data: null };
  const byName = (me as { name?: string } | null)?.name ?? user.email ?? null;
  const draft = await addDraft(db, { kind, path, body, byId: user.athleteId ?? null, byName });
  try {
    const { data: owner } = await db.from('athletes').select('id').eq('email', SUPER_USER_EMAIL).maybeSingle();
    const ownerId = (owner as { id?: string } | null)?.id;
    if (ownerId) {
      await notifyAthlete({ athleteId: ownerId, kind: 'content_draft', url: '/dashboard/content', tag: `draft:${draft.id}`,
        title: `📝 ${byName ?? 'מישהו'} מבקש לפרסם`, body: draft.title || 'בתוכן — מחכה לאישורך' });
    }
  } catch { /* the draft is kept either way */ }
  return { denied: NextResponse.json({ ok: true, draft: true, id: draft.id }, { status: 202 }) };
}
