import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { daysBetweenIso } from '@/lib/birthday-year/stats';
import { PHOTO_SLOTS, readConfig, sendingOn, storyBirthday, writeConfig, type BirthdayConfig } from '@/lib/birthday-year/server';
import { readStorySettings } from '@/lib/stories/gate';
import { requireBirthdayAdmin } from '@/lib/birthday-year/access';

export const dynamic = 'force-dynamic';

/** The prep screens open only once birthday is not 'off' (stories gate; a read error = off). */
async function birthdayState(): Promise<string> {
  return (await readStorySettings('birthday'))?.state ?? 'off';
}

/**
 * GET — birthdays from a week ago to three weeks ahead, each with what is prepared.
 * Admin only, AND no athlete data while the birthday feature is 'off' (the page is still
 * reachable — it links to the place that turns it on).
 */
export async function GET(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const today = israelToday();
  const state = await birthdayState();
  if (state === 'off') return NextResponse.json({ today, state, rows: [] });
  const { data } = await supabase.from('athletes').select('id, name, avatar_url, birth_date')
    .eq('coach_id', COACH_ID).eq('status', 'active').not('birth_date', 'is', null);
  const rows = [];
  for (const a of (data || []) as Array<{ id: string; name: string | null; avatar_url: string | null; birth_date: string }>) {
    const birthday = storyBirthday(a.birth_date, today, { preview: true });
    if (!birthday) continue;
    const inDays = daysBetweenIso(today, birthday);
    if (inDays > 21) continue;
    rows.push({ athleteId: a.id, name: a.name, avatarUrl: a.avatar_url, birthday, inDays, config: await readConfig(supabase, a.id, birthday) });
  }
  rows.sort((x, y) => x.inDays - y.inDays);
  // legacySending: the old switch, shown for reference only — it opens nothing now.
  return NextResponse.json({ today, state, legacySending: await sendingOn(supabase), rows });
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : null) || null;

/**
 * PUT { athleteId, birthday, displayName, message, momentSeconds, photos, published }.
 * The old `{ sending }` club switch is gone (410): /api/admin/stories decides who gets it.
 * `published` may only be false (hide this one story) or null.
 */
export async function PUT(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await request.json().catch(() => ({}));
  if ('sending' in body) return NextResponse.json({ error: 'moved to /dashboard/stories' }, { status: 410 });
  if ((await birthdayState()) === 'off') return NextResponse.json({ error: 'birthday stories are off' }, { status: 409 });
  const athleteId = typeof body.athleteId === 'string' ? body.athleteId : '';
  const birthday = typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday) ? body.birthday : '';
  if (!athleteId || !birthday) return NextResponse.json({ error: 'athleteId and birthday are required' }, { status: 400 });
  const photos: BirthdayConfig['photos'] = {};
  for (const slot of PHOTO_SLOTS) {
    const url = body.photos?.[slot];
    if (typeof url === 'string' && /^https:\/\//.test(url)) photos[slot] = url;
  }
  const secs = Number(body.momentSeconds);
  const cfg: BirthdayConfig = {
    displayName: clean(body.displayName, 40),
    message: clean(body.message, 600),
    momentSeconds: Number.isFinite(secs) && secs > 600 && secs < 86_400 ? Math.round(secs) : null,
    momentTitle: clean(body.momentTitle, 40),
    published: body.published === false ? false : null,
    photos,
  };
  return (await writeConfig(supabase, athleteId, birthday, cfg))
    ? NextResponse.json({ config: cfg })
    : NextResponse.json({ error: 'Failed to save' }, { status: 500 });
}
