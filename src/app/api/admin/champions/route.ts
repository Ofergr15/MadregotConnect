import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireContentStaff } from '@/lib/auth/require-content-staff';
import { israelToday } from '@/lib/utils';
import { mentionToken } from '@/lib/feed/mentions';
import { publishClubPost } from '@/lib/publish/server';
import { isMissing163, readResults, readSuggestions } from '@/lib/champions/server';
import { CHAMP_DISTANCES, DISTANCE_LONG, TOP, enteredVerb, fmtRaceTime, placeOf, type ChampDistance } from '@/lib/champions/table';

export const dynamic = 'force-dynamic';

/**
 * Staff side of אלופי המדרגות.
 * GET    → { results, suggestions }: what counts, and race-day runs that could.
 * POST   { athleteId, distance, seconds, raceName?, raceDate, activityId? } → an official
 *        result. Landing in the top 10 posts "X נכנס/ה למקום N" to the feed and the
 *        circles (a celebration, 3 days).
 * POST   { bulk: [...] } → many at once ("לאשר הכל"), quietly: no feed cards. An item with
 *        rejected:true is stored removed — a suggestion turned down stays down.
 * PATCH  { id, seconds?, distance?, raceName?, raceDate? } → the admin's edit.
 * DELETE ?id → off the table (soft).
 */
export async function GET(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const db = createServerClient();
  const { ready, rows } = await readResults(db);
  const { data: used } = ready ? await db.from('race_results').select('activity_id').not('activity_id', 'is', null) : { data: [] };
  const taken = new Set(((used || []) as { activity_id: string }[]).map((r) => r.activity_id));
  const suggestions = await readSuggestions(db, taken).catch(() => []);
  return NextResponse.json({ ready, results: rows.sort((a, b) => b.raceDate.localeCompare(a.raceDate)), suggestions });
}

export async function POST(request: Request) {
  const { denied, athleteId: by } = await requireContentStaff(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (Array.isArray(b.bulk)) return bulk(b.bulk as Array<Record<string, unknown>>, by);
  const distance = b.distance as ChampDistance;
  const seconds = Number(b.seconds);
  const raceDate = String(b.raceDate || '');
  if (typeof b.athleteId !== 'string' || !CHAMP_DISTANCES.includes(distance) || !Number.isInteger(seconds) || seconds <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
    return NextResponse.json({ error: 'bad result' }, { status: 400 });
  }
  const db = createServerClient();
  const { data, error } = await db.from('race_results').insert({
    athlete_id: b.athleteId, distance, seconds, race_date: raceDate,
    race_name: typeof b.raceName === 'string' && b.raceName.trim() ? b.raceName.trim().slice(0, 80) : null,
    activity_id: typeof b.activityId === 'string' ? b.activityId : null, created_by: by,
  }).select('id').single();
  if (error) return NextResponse.json({ error: isMissing163(error) ? 'migration 163' : 'save failed' }, { status: isMissing163(error) ? 409 : 500 });
  const id = (data as { id: string }).id;
  // Where it landed — and a card when it's the top 10.
  const { rows } = await readResults(db);
  const mine = rows.find((r) => r.id === id);
  const today = israelToday();
  const place = mine ? placeOf(rows, mine, today) : null;
  let posted = false;
  if (mine && place && place <= TOP && raceDate >= addDays(today, -30)) {
    const until = addDays(today, 3);
    await publishClubPost(db, {
      body: `🏅 ${mentionToken(mine.name, mine.athleteId)} ${enteredVerb(mine.gender)} למקום ${place} באלופי המדרגות · ${DISTANCE_LONG[distance]} · ${fmtRaceTime(seconds)}`,
      payload: { kind: 'celebration', celebrationType: 'achievement', honoreeIds: [mine.athleteId], honoreeId: mine.athleteId, date: today, until, champions: { distance, place, resultId: id } },
    }).then(() => { posted = true; }).catch((e) => console.warn('champions post failed', e));
  }
  return NextResponse.json({ ok: true, id, place, posted });
}

export async function DELETE(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id' }, { status: 400 });
  const { error } = await createServerClient().from('race_results').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  return error ? NextResponse.json({ error: 'failed' }, { status: 500 }) : NextResponse.json({ ok: true });
}

const valid = (x: Record<string, unknown>) =>
  typeof x.athleteId === 'string' && CHAMP_DISTANCES.includes(x.distance as ChampDistance)
  && Number.isInteger(Number(x.seconds)) && Number(x.seconds) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(x.raceDate || ''));

async function bulk(items: Array<Record<string, unknown>>, by: string | null) {
  const db = createServerClient();
  const rows = items.filter(valid).slice(0, 500).map((x) => ({
    athlete_id: x.athleteId, distance: x.distance, seconds: Number(x.seconds), race_date: x.raceDate,
    race_name: typeof x.raceName === 'string' && x.raceName.trim() ? x.raceName.trim().slice(0, 80) : null,
    activity_id: typeof x.activityId === 'string' ? x.activityId : null, created_by: by,
    // "לא" on a suggestion: kept as a removed row, so that run never comes back as one.
    ...(x.rejected === true ? { deleted_at: new Date().toISOString() } : {}),
  }));
  if (!rows.length) return NextResponse.json({ error: 'nothing to add' }, { status: 400 });
  // One by one, so a run already in the table (the unique activity index) skips instead of failing the rest.
  let added = 0;
  for (const row of rows) {
    const { error } = await db.from('race_results').insert(row);
    if (!error) added++;
    else if (isMissing163(error)) return NextResponse.json({ error: 'migration 163' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, added });
}

export async function PATCH(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.id !== 'string') return NextResponse.json({ error: 'id' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if ('seconds' in b) { const n = Number(b.seconds); if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: 'bad time' }, { status: 400 }); patch.seconds = n; }
  if ('distance' in b) { if (!CHAMP_DISTANCES.includes(b.distance as ChampDistance)) return NextResponse.json({ error: 'bad distance' }, { status: 400 }); patch.distance = b.distance; }
  if ('raceDate' in b) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.raceDate))) return NextResponse.json({ error: 'bad date' }, { status: 400 }); patch.race_date = b.raceDate; }
  if ('raceName' in b) patch.race_name = typeof b.raceName === 'string' && b.raceName.trim() ? b.raceName.trim().slice(0, 80) : null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to change' }, { status: 400 });
  const { error } = await createServerClient().from('race_results').update(patch).eq('id', b.id).is('deleted_at', null);
  return error ? NextResponse.json({ error: 'failed' }, { status: 500 }) : NextResponse.json({ ok: true });
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
