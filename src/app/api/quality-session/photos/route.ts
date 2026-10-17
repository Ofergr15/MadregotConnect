import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isStoryEditor } from '@/lib/quality-session/access';
import { loadQualitySession } from '@/lib/quality-session/server';
import { sanitizeMediaList } from '@/lib/feed/media';
import { notifyAthlete } from '@/lib/push';
import { addDaysToDateStr } from '@/lib/utils';
import { sessionPhotosCopy } from '@/lib/notifications/copy';
import {
  MAX_SESSION_PHOTOS, SESSION_PHOTOS_KIND, cleanPhotosLink, toSessionPhotos,
  type SessionPhotosPayload,
} from '@/lib/quality-session/photos';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// /api/quality-session/photos — the day's "photos from the session" card (#106).
// Same gate as the quality-session screen it lives on: the super user and the
// "אינסטגרם" editors (lib/quality-session/access.ts).

type Db = ReturnType<typeof createServerClient>;

async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth) } as const;
  const supabase = createServerClient();
  if (!auth.user.athleteId || (!auth.user.isSuperUser && !(await isStoryEditor(supabase, auth.user.athleteId)))) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  return { auth, supabase } as const;
}

async function cardFor(supabase: Db, date: string) {
  const { data } = await supabase
    .from('feed_items')
    .select('id, payload, media')
    .eq('type', 'announcement')
    .eq('payload->>kind', SESSION_PHOTOS_KIND)
    .eq('payload->>date', date)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle<{ id: string; payload: Record<string, unknown>; media: unknown[] | null }>();
  return data;
}

/** Who marked "coming" that morning. Attendance weeks start on Sunday. */
async function attendees(supabase: Db, date: string): Promise<string[]> {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data } = await supabase.from('workout_attendance')
    .select('athlete_id')
    .eq('week_start_date', addDaysToDateStr(date, -dow))
    .eq('day_of_week', dow)
    .eq('attending', true);
  return [...new Set(((data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id))];
}

// GET ?date= -> { card: { id, link, media } | null }
export async function GET(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const row = await cardFor(g.supabase, date);
  const p = toSessionPhotos(row?.payload);
  return NextResponse.json({ card: row && p ? { id: row.id, link: p.link, media: row.media || [] } : null });
}

// POST { date, link, media?, notify? } -> { id, told }
//   Publishes the day's card, or updates it: one card per day, so a second POST
//   replaces the link and photos instead of adding a second card. Members who
//   marked "coming" are told on the first publish only, unless `notify` is false.
export async function POST(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const { auth, supabase } = g;
  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const link = cleanPhotosLink(body?.link);
  if (!link) return NextResponse.json({ error: 'bad-link' }, { status: 400 });
  const raw = Array.isArray(body?.media) ? body.media : [];
  if (raw.length > MAX_SESSION_PHOTOS) return NextResponse.json({ error: 'too-many' }, { status: 400 });
  // Only photos this caller uploaded (/api/feed/media files them under their id).
  const media = sanitizeMediaList(raw, auth.user.athleteId!).map((m) => ({
    ...m,
    url: supabase.storage.from('feed-media').getPublicUrl(m.path).data.publicUrl,
  }));

  try {
    const session = await loadQualitySession(supabase, date).catch(() => null);
    const workoutName = session?.workout?.name || null;
    const payload: SessionPhotosPayload = {
      kind: SESSION_PHOTOS_KIND, date, workoutName, link, byAthleteId: auth.user.athleteId,
    };
    const existing = await cardFor(supabase, date);
    if (existing) {
      const { error } = await supabase.from('feed_items')
        .update({ payload, media: media.length ? media : null })
        .eq('id', existing.id);
      if (error) throw error;
      return NextResponse.json({ id: existing.id, updated: true, told: 0 });
    }

    const { data: created, error } = await supabase.from('feed_items').insert({
      type: 'announcement',
      author_athlete_id: null,
      body: null,
      media: media.length ? media : null,
      payload,
      // Now, not the session's morning: the card is news when the photos land.
      occurred_at: new Date().toISOString(),
    }).select('id').single();
    if (error) throw error;

    let told = 0;
    if (body?.notify !== false) {
      for (const athleteId of (await attendees(supabase, date)).filter((id) => id !== auth.user.athleteId)) {
        try {
          await notifyAthlete({
            athleteId,
            kind: 'session_photos',
            actorAthleteId: auth.user.athleteId,
            copy: (locale) => sessionPhotosCopy(locale, { workout: workoutName }),
            url: `/feed?item=${created.id}`,
            tag: `session-photos-${date}`,
          });
          told += 1;
        } catch { /* one phone must not stop the rest */ }
      }
    }
    return NextResponse.json({ id: created.id, told });
  } catch (err) {
    console.error('[quality-session/photos] POST failed:', err);
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
}

// DELETE ?date= -> { ok } — takes the day's card down (soft, like a post).
export async function DELETE(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const row = await cardFor(g.supabase, date);
  if (!row) return NextResponse.json({ ok: true });
  const { error } = await g.supabase.from('feed_items').update({ deleted_at: new Date().toISOString() }).eq('id', row.id);
  if (error) return NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
