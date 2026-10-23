import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { groupByPush, readDeliveries, shownRate, silentPeople, stateOf, tally, SELF_KIND, type DeliveryRow } from '@/lib/push-deliveries';

export const dynamic = 'force-dynamic';

/**
 * ניהול ← בריאות ההתראות (mockups/push-health.html, Ofer 10-23).
 *   GET          -> { ready, tally, rate, byKind, recent, silent }   the last 24 hours
 *   GET ?nid=…   -> { push, recipients }                           one push, everyone it went to
 * The super user and admins.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  const db = createServerClient();
  const nid = new URL(request.url).searchParams.get('nid');

  if (nid) {
    const { data, error } = await db.from('push_deliveries')
      .select('id, nid, athlete_id, subscription_id, kind, title, sent_at, accepted, error, shown_at').eq('nid', nid);
    if (error) return NextResponse.json({ ready: false });
    const rows = (data || []) as DeliveryRow[];
    const ids = [...new Set(rows.map((r) => r.athlete_id).filter(Boolean))] as string[];
    const subIds = [...new Set(rows.map((r) => r.subscription_id).filter(Boolean))] as string[];
    const [who, subs] = await Promise.all([
      ids.length ? db.from('athletes').select('id, name, avatar_url').in('id', ids) : Promise.resolve({ data: [] }),
      subIds.length ? db.from('push_subscriptions').select('id, user_agent').in('id', subIds) : Promise.resolve({ data: [] }),
    ]);
    const name = new Map(((who.data || []) as { id: string; name: string | null; avatar_url: string | null }[]).map((a) => [a.id, a]));
    const ua = new Map(((subs.data || []) as { id: string; user_agent: string | null }[]).map((s) => [s.id, s.user_agent]));
    return NextResponse.json({
      ready: true,
      push: groupByPush(rows)[0] ?? null,
      recipients: rows.map((r) => ({
        athleteId: r.athlete_id, name: name.get(r.athlete_id ?? '')?.name ?? '—', avatarUrl: name.get(r.athlete_id ?? '')?.avatar_url ?? null,
        device: deviceOf(ua.get(r.subscription_id ?? '') ?? null), sentAt: r.sent_at, shownAt: r.shown_at, state: stateOf(r), error: r.error,
      })),
    });
  }

  const rows = await readDeliveries(db, new Date(Date.now() - 24 * 3600_000).toISOString());
  if (!rows) return NextResponse.json({ ready: false });
  const judged = rows.filter((r) => r.kind !== SELF_KIND);
  const t = tally(judged);
  const kinds = new Map<string, DeliveryRow[]>();
  for (const r of judged) kinds.set(r.kind ?? 'other', [...(kinds.get(r.kind ?? 'other') ?? []), r]);
  const silent = silentPeople(judged);
  const { data: names } = silent.length ? await db.from('athletes').select('id, name').in('id', silent.map((s) => s.athleteId)) : { data: [] };
  const nameOf = new Map(((names || []) as { id: string; name: string | null }[]).map((a) => [a.id, a.name]));
  return NextResponse.json({
    ready: true,
    tally: t, rate: shownRate(t),
    byKind: [...kinds.entries()].map(([kind, rs]) => { const k = tally(rs); return { kind, title: rs[0].title, tally: k, rate: shownRate(k) }; })
      .sort((a, b) => b.tally.sent - a.tally.sent),
    recent: groupByPush(judged).slice(0, 30),
    silent: silent.map((s) => ({ ...s, name: nameOf.get(s.athleteId) ?? '—' })),
  });
}

function deviceOf(ua: string | null): string {
  if (!ua) return '—';
  if (/iPhone/.test(ua)) return 'אייפון';
  if (/iPad/.test(ua)) return 'אייפד';
  if (/Android/.test(ua)) return 'אנדרואיד';
  return 'מחשב';
}
