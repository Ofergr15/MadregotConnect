import { NextResponse } from 'next/server';
import { clubUpdatesCaller, forbidden } from '@/lib/club-updates/access';
import { roleLabel, writeConfig } from '@/lib/club-updates/server';
import { COACH_ID } from '@/lib/constants';
import { CLUB_ACCOUNT_ROLE } from '@/lib/notifications/prefs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/club-updates — the switch, the writers, and the members to pick from.
 * PUT { enabled?, writerIds? } — the admin only (Ofer, 2026-10-18: "admin כרגע רק יכול
 * להפעיל ולהגדיר מי יוכל לעדכן").
 */
export async function GET(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  if (!c.access.admin) return forbidden();
  const { data } = await c.db.from('athletes').select('id, name, avatar_url, role, extra_roles')
    .eq('coach_id', COACH_ID).eq('status', 'active').order('name');
  const people = ((data || []) as Array<{ id: string; name: string | null; avatar_url: string | null; role: string | null; extra_roles?: unknown }>)
    .filter((p) => p.role !== CLUB_ACCOUNT_ROLE)
    .map((p) => ({ id: p.id, name: (p.name || '').trim(), avatarUrl: p.avatar_url, role: roleLabel(p.role, p.extra_roles) }));
  const { error: probe } = await c.db.from('club_updates').select('id', { head: true, count: 'exact' }).limit(1);
  return NextResponse.json({ config: c.cfg, people, me: c.athleteId, tablesReady: !probe });
}

export async function PUT(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  if (!c.access.admin) return forbidden();
  const b = (await request.json().catch(() => null)) as { enabled?: unknown; writerIds?: unknown } | null;
  const next = {
    enabled: typeof b?.enabled === 'boolean' ? b.enabled : c.cfg.enabled,
    writerIds: Array.isArray(b?.writerIds) ? [...new Set(b.writerIds.filter((x): x is string => typeof x === 'string'))] : c.cfg.writerIds,
  };
  if (!(await writeConfig(c.db, next))) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  return NextResponse.json({ config: next });
}
