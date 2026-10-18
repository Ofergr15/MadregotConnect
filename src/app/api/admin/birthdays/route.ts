import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { daysBetweenIso } from '@/lib/birthday-year/stats';
import { PHOTO_SLOTS, SEND_KEY, readConfig, sendingOn, storyBirthday, writeConfig, type BirthdayConfig } from '@/lib/birthday-year/server';
import { requireBirthdayAdmin } from '@/lib/birthday-year/access';

export const dynamic = 'force-dynamic';

/** GET — birthdays from a week ago to three weeks ahead, each with what is prepared; and the switch. */
export async function GET(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const today = israelToday();
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
  return NextResponse.json({ today, sending: await sendingOn(supabase), rows });
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : null) || null;

/** PUT { athleteId, birthday, displayName, message, momentSeconds, photos } or { sending: boolean }. */
export async function PUT(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await request.json().catch(() => ({}));
  if (typeof body.sending === 'boolean') {
    const { error } = await supabase.from('app_settings')
      .upsert({ key: SEND_KEY, value: body.sending ? 'on' : 'off', updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return error ? NextResponse.json({ error: 'Failed to save' }, { status: 500 }) : NextResponse.json({ sending: body.sending });
  }
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
    published: typeof body.published === 'boolean' ? body.published : null,
    photos,
  };
  return (await writeConfig(supabase, athleteId, birthday, cfg))
    ? NextResponse.json({ config: cfg })
    : NextResponse.json({ error: 'Failed to save' }, { status: 500 });
}
