import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { readDrafts, takeDraft, type DraftPath } from '@/lib/access/drafts';
import { notifyAthlete } from '@/lib/push';
import { POST as publishMessage } from '@/app/api/admin/publish/message/route';
import { POST as publishCheer } from '@/app/api/admin/cheers/route';
import { POST as publishSurvey } from '@/app/api/admin/surveys/route';
import { POST as publishStory } from '@/app/api/admin/club-stories/route';

export const dynamic = 'force-dynamic';

/**
 * "מחכה לאישורך" — what level-2 publishers sent (lib/access/drafts).
 *   GET                                  -> { drafts }
 *   POST { id, action: approve|reject }  -> { ok, result? }
 * Approving replays the kept request through its own route as THIS admin, so it is
 * published exactly as if they had sent it. Approvers and the super user decide.
 */
const ROUTES: Record<DraftPath, (r: Request) => Promise<Response>> = {
  '/api/admin/publish/message': publishMessage,
  '/api/admin/cheers': publishCheer,
  '/api/admin/surveys': publishSurvey,
  '/api/admin/club-stories': publishStory,
};

async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth) } as const;
  if (!auth.user.isSuperUser && !auth.user.canApprove) return { denied: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) } as const;
  return { user: auth.user } as const;
}

export async function GET(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  return NextResponse.json({ drafts: await readDrafts(createServerClient()) });
}

export async function POST(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const b = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = typeof b?.id === 'string' ? b.id : '';
  const action = b?.action === 'approve' || b?.action === 'reject' ? b.action : null;
  if (!id || !action) return NextResponse.json({ error: 'id and action' }, { status: 400 });
  const db = createServerClient();
  // Read, not taken: a draft leaves the list only once it went out (or was turned down).
  const draft = (await readDrafts(db)).find((d) => d.id === id);
  if (!draft) return NextResponse.json({ error: 'Already handled' }, { status: 404 });

  let ok = true;
  let result: unknown = null;
  if (action === 'approve') {
    // The approver's own credentials, the kept body: the route sees the admin sending it.
    const headers = new Headers();
    for (const k of ['authorization', 'cookie', 'x-requested-with']) { const v = request.headers.get(k); if (v) headers.set(k, v); }
    headers.set('content-type', 'application/json');
    const res = await ROUTES[draft.path](new Request(new URL(draft.path, request.url), { method: 'POST', headers, body: JSON.stringify(draft.body ?? {}) }));
    ok = res.ok;
    result = await res.json().catch(() => null);
    if (!ok) return NextResponse.json({ error: 'Publish failed', result }, { status: 502 });
  }
  if (!(await takeDraft(db, id))) return NextResponse.json({ ok, result, note: 'handled twice' });
  if (draft.byId) {
    await notifyAthlete({
      athleteId: draft.byId, kind: 'content_draft', url: '/dashboard/content', tag: `draft:${draft.id}:done`,
      title: action === 'approve' ? '✅ אושר ופורסם' : 'לא אושר הפעם',
      body: draft.title || (action === 'approve' ? 'מה ששלחת לאישור פורסם' : 'מה ששלחת לאישור לא יצא'),
    }).catch(() => null);
  }
  return NextResponse.json({ ok, result });
}
