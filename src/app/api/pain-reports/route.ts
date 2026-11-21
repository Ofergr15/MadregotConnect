import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { isFeatureEnabled } from '@/lib/features/server';
import { parsePainInput } from '@/lib/feedback/pain';
import { PAIN_SELECT, callerMaySeePain, sendPainAlert, shapePain, type PainRow } from '@/lib/feedback/pain-server';
import { notifyStaff } from '@/lib/notifications/staff';
import { availabilityChangeCopy } from '@/lib/notifications/copy';

export const dynamic = 'force-dynamic';

// Pain reports — NAMED HEALTH DATA WITH A BODY LOCATION (lib/feedback/pain.ts).
//
// GET  /api/pain-reports                    → the caller's own history (feature-gated)
// GET  /api/pain-reports?athleteId=…        → that runner's history, for scoped staff only
// GET  /api/pain-reports?staff=1            → open reports of runners in the caller's scope
// POST /api/pain-reports {area, side, …}    → file one as YOURSELF; feature must be on for you
//
// Never member-visible: a teammate gets 403. Never in the feed. Skipped by swr-persist.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get('staff') === '1') {
      if (!caller.isStaff && !caller.isSuperUser) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
      const { data, error } = await db.from('pain_reports').select(`${PAIN_SELECT}, athletes!athlete_id(name, avatar_url)`)
        .in('status', ['open', 'withdrawn']).order('created_at', { ascending: false }).limit(200);
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ items: [], migrationPending: true });
        return NextResponse.json({ error: 'Failed to load', details: error.message }, { status: 500 });
      }
      const items = [];
      for (const r of (data || []) as Array<PainRow & { athletes?: { name?: string; avatar_url?: string } | null }>) {
        if ((await callerMaySeePain(db, caller, r.athlete_id)) !== 'staff') continue;
        items.push({ ...shapePain(r), athleteName: r.athletes?.name ?? null, avatarUrl: r.athletes?.avatar_url ?? null });
      }
      return NextResponse.json({ items });
    }

    const target = searchParams.get('athleteId') || caller.athleteId;
    if (!target) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    const access = await callerMaySeePain(db, caller, target);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (access === 'owner' && !(await isFeatureEnabled('feedback_pain', target, db))) {
      return NextResponse.json({ enabled: false, items: [] });
    }
    const { data, error } = await db.from('pain_reports').select(PAIN_SELECT).eq('athlete_id', target)
      .order('created_at', { ascending: false }).limit(100);
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ enabled: true, items: [], migrationPending: true });
      return NextResponse.json({ error: 'Failed to load', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ enabled: true, items: ((data || []) as PainRow[]).map(shapePain) });
  } catch (error: any) {
    console.error('[pain-reports] GET failed', error);
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'athlete account required' }, { status: 403 });
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const db = createServerClient();
  try {
    const body = await request.json().catch(() => ({}));
    // A body athleteId naming someone else is refused, not ignored: pain is filed by its owner.
    if (body?.athleteId && body.athleteId !== caller.athleteId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (!(await isFeatureEnabled('feedback_pain', caller.athleteId, db))) {
      return NextResponse.json({ error: 'feature_disabled' }, { status: 403 });
    }
    const parsed = parsePainInput(body || {});
    if (!parsed.ok) return NextResponse.json({ error: `invalid ${parsed.field}` }, { status: 400 });
    const v = parsed.value;
    const { data, error } = await db.from('pain_reports').insert({
      athlete_id: caller.athleteId, area: v.area, side: v.side, severity: v.severity, since: v.since,
      effect: v.effect, note: v.note, activity_id: v.activityId,
    }).select(PAIN_SELECT).single();
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ error: 'migration_pending', details: 'migration 191 not applied' }, { status: 503 });
      return NextResponse.json({ error: 'Failed to save', details: error.message }, { status: 500 });
    }
    const row = data as PainRow;
    const recipients = await sendPainAlert(db, row);

    let availability: string | null = null;
    if (v.markInjured) {
      const { data: a, error: aErr } = await db.from('athletes')
        .update({ availability: 'injured', availability_set_by: 'self', availability_since: new Date().toISOString() })
        .eq('id', caller.athleteId).select('name, avatar_url, availability').maybeSingle();
      if (!aErr && a) {
        availability = a.availability;
        await notifyStaff({
          kind: 'availability_change', url: '/dashboard', tag: `availability-${caller.athleteId}`,
          category: 'management', actorAthleteId: caller.athleteId, icon: a.avatar_url?.trim() || undefined,
          copy: (locale) => availabilityChangeCopy(locale, { athleteName: a.name || '', availability: 'injured' }),
        });
      }
    }
    return NextResponse.json({ report: shapePain(row), recipients, availability });
  } catch (error: any) {
    console.error('[pain-reports] POST failed', error);
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
