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
 * DELETE ?id → off the table (soft).
 */
export async function GET(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const db = createServerClient();
  const { ready, rows } = await readResults(db);
  const { data: used } = ready ? await db.from('race_results').select('activity_id').is('deleted_at', null).not('activity_id', 'is', null) : { data: [] };
  const taken = new Set(((used || []) as { activity_id: string }[]).map((r) => r.activity_id));
  const suggestions = await readSuggestions(db, taken).catch(() => []);
  return NextResponse.json({ ready, results: rows.sort((a, b) => b.raceDate.localeCompare(a.raceDate)), suggestions });
}

export async function POST(request: Request) {
  const { denied, athleteId: by } = await requireContentStaff(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
