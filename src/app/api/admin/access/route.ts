import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { SUPER_USER_EMAIL } from '@/lib/constants';
import { CONTENT_KINDS, DRAFTABLE, readGrants, readLog, setContentLevel, type ContentKind, type Level } from '@/lib/access/grants';

export const dynamic = 'force-dynamic';

/**
 * ניהול ← הרשאות (mockups/access-hub.html, Ofer 10-23). The people themselves come
 * from /api/admin/roles; this is the Content layer on top of them.
 *   GET -> { grants, log }
 *   PUT { athleteId, kind, level: 0|1|2|3 } -> { grants }   one part, one person, logged (2 only where a draft can be approved)
 * The super user and admins, like the roles screen.
 */
async function gate(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied } as const;
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) } as const;
  return { caller } as const;
}

export async function GET(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const db = createServerClient();
  const [grants, log, supers, byEmail] = await Promise.all([
    readGrants(db), readLog(db),
    db.from('athletes').select('id').eq('is_super_user', true),
    db.from('athletes').select('id').eq('email', SUPER_USER_EMAIL),
  ]);
  const ids = [...((supers.data || []) as { id: string }[]), ...((byEmail.data || []) as { id: string }[])].map((a) => a.id);
  return NextResponse.json({ grants, log: log.slice(0, 100), supers: [...new Set(ids)] });
}

export async function PUT(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const b = (await request.json().catch(() => null)) as { athleteId?: unknown; kind?: unknown; level?: unknown } | null;
  const athleteId = typeof b?.athleteId === 'string' ? b.athleteId : '';
  const kind = CONTENT_KINDS.includes(b?.kind as ContentKind) ? (b!.kind as ContentKind) : null;
  const level = b?.level === 0 || b?.level === 1 || b?.level === 3 || (b?.level === 2 && DRAFTABLE.includes(b?.kind as ContentKind)) ? (b.level as Level) : null;
  if (!athleteId || !kind || level === null) return NextResponse.json({ error: 'athleteId, kind, level' }, { status: 400 });
  const db = createServerClient();
  const { data: who } = await db.from('athletes').select('id, name').eq('id', athleteId).maybeSingle();
  if (!who) return NextResponse.json({ error: 'No such person' }, { status: 404 });
  const { data: me } = g.caller.athleteId ? await db.from('athletes').select('name').eq('id', g.caller.athleteId).maybeSingle() : { data: null };
  try {
    const grants = await setContentLevel(db, {
      athleteId, kind, level, by: g.caller.athleteId ?? null,
      byName: (me as { name?: string } | null)?.name ?? g.caller.email ?? null, name: (who as { name?: string }).name ?? null,
    });
    return NextResponse.json({ grants });
  } catch (err) {
    console.error('[admin/access] PUT failed:', err);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
}
