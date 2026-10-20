import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStoryAdmin } from '@/lib/birthday-year/access';
import { israelToday } from '@/lib/utils';
import { loadAnnualStory, loadStory } from '@/lib/birthday-year/server';
import { birthdayYearCopy } from '@/lib/notifications/copy';
import { STORY_FEATURES, readStorySettings, type StoryFeature } from '@/lib/stories/gate';
import { publishBirthdayPosts } from '@/lib/feed/birthday-publish';
import { effectiveFor, quickAction, readInstance, resetOverrides, validateOverrides, writeOverrides, type Overrides, type StoryInstance } from '@/lib/stories/instances';

export const dynamic = 'force-dynamic';

/**
 * The person sheet. Admin only, server-side.
 * GET    ?athleteId&feature&period — the preview (push text, the numbers, the headline) and
 *        the effective values. Reads only: never pushes, never marks viewed.
 * PATCH  {athleteId, feature, period, action?: plus_day|postpone|skip_year|unskip, ...overrides}
 *        → upsert; returns `previous` (the overrides before), which the undo snackbar PATCHes back.
 *        action=publish_now (today's birthday only): publish_at = now, and the public post /
 *        circle goes up on this request; the push follows on the next tick.
 * DELETE ?athleteId&feature&period — "בטל שינויים": every override back to default.
 */
const OVERRIDE_KEYS = ['publish_at', 'display_days', 'feed_post', 'custom_text', 'slide_order', 'enabled', 'skipped', 'placement', 'send_push', 'until_at'] as const;

function readKey(sp: URLSearchParams | Record<string, unknown>) {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : (sp[k] as string | undefined)) ?? null;
  const athleteId = get('athleteId');
  const feature = get('feature') as StoryFeature | null;
  const period = get('period');
  if (!athleteId || !feature || !STORY_FEATURES.includes(feature) || !/^\d{4}-\d{2}-\d{2}$/.test(period || '')) return null;
  return { athleteId, feature, period: period! };
}

export async function GET(request: Request) {
  const { denied } = await requireStoryAdmin(request);
  if (denied) return denied;
  const key = readKey(new URL(request.url).searchParams);
  if (!key) return NextResponse.json({ error: 'bad key' }, { status: 400 });
  const db = createServerClient();
  const settings = await readStorySettings(key.feature, { db: db as never });
  if (!settings) return NextResponse.json({ error: 'not ready' }, { status: 409 });
  const today = israelToday();
  const inst = await readInstance(db, key.athleteId, key.feature, key.period);
  const { data: a } = await db.from('athletes').select('name, avatar_url').eq('id', key.athleteId).maybeSingle();
  let numbers: { km: number; runs: number; streak: number | null } | null = null;
  let push: { title: string; body: string } | null = null;
  try {
    const story = key.feature === 'birthday'
      ? await loadStory(db, key.athleteId, today, { preview: true, lookbackDays: 31 })
      : key.feature === 'annual' ? await loadAnnualStory(db, key.athleteId, Number(key.period.slice(0, 4)), today) : null;
    if (story) {
      const s = story.stats;
      numbers = { km: s.km, runs: s.runs, streak: s.streak?.days ?? null };
      push = key.feature === 'birthday' ? birthdayYearCopy('he', { name: story.name, km: s.km })
        : { title: `🏁 ${story.name}, השנה שלך בריצה`, body: `${s.km.toLocaleString('en-US')} ק״מ ב־${key.period.slice(0, 4)}. לחיצה ותראה.` };
    }
  } catch { /* the sheet shows "no numbers yet" */ }
  // The week's numbers exist only on Saturday (the cron builds them); the push's shape is fixed.
  if (key.feature === 'weekly') push = { title: 'השבוע שלך מוכן 🏅', body: 'הק״מ של השבוע ומה שבלט בו — לחיצה לסטורי של השבוע.' };
  const e = effectiveFor(settings, key.period, inst, numbers?.runs ?? null);
  const ct = inst?.custom_text;
  return NextResponse.json({
    ...key,
    name: (a as { name?: string | null } | null)?.name ?? null,
    avatarUrl: (a as { avatar_url?: string | null } | null)?.avatar_url ?? null,
    instance: inst,
    effective: { on: e.on, reason: e.reason, publishAt: e.publishAt.toISOString(), until: e.until.toISOString(), displayDays: e.displayDays, feedPost: e.feedPost, placement: e.placement, sendPush: e.sendPush, manualUntil: !!inst?.until_at, overridden: e.overridden },
    state: settings.state,
    today,
    settings: { feed_post: settings.feed_post, min_runs: settings.min_runs, send_push: settings.send_push },
    numbers,
    push: push ? { title: ct?.push_title || push.title, body: ct?.push_body || push.body } : null,
    headline: ct?.headline || null,
    pushed: !!inst?.pushed_at,
  });
}

const pick = (inst: StoryInstance | null): Overrides => {
  const o: Record<string, unknown> = {};
  for (const k of OVERRIDE_KEYS) o[k] = inst ? (inst as unknown as Record<string, unknown>)[k] ?? (k === 'skipped' ? false : null) : (k === 'skipped' ? false : null);
  return o as Overrides;
};

export async function PATCH(request: Request) {
  const { denied, caller } = await requireStoryAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = readKey(body);
  if (!key) return NextResponse.json({ error: 'bad key' }, { status: 400 });
  const db = createServerClient();
  const settings = await readStorySettings(key.feature, { db: db as never });
  if (!settings) return NextResponse.json({ error: 'not ready' }, { status: 409 });
  const now = new Date();
  const inst = await readInstance(db, key.athleteId, key.feature, key.period);
  let raw: Record<string, unknown> = {};
  for (const k of OVERRIDE_KEYS) if (k in body) raw[k] = body[k];
  const action = body.action as string | undefined;
  const publishNow = action === 'publish_now';
  if (publishNow) {
    // Only on the day itself, and only while the feature is really on for people.
    if (key.feature !== 'birthday' || key.period !== israelToday(now)) return NextResponse.json({ error: 'publish_now is for today only' }, { status: 400 });
    if (settings.state !== 'testers' && settings.state !== 'all') return NextResponse.json({ error: 'feature off' }, { status: 409 });
    raw = { ...raw, publish_at: now.toISOString() };
  } else if (action) {
    if (!['plus_day', 'postpone', 'skip_year', 'unskip'].includes(action)) return NextResponse.json({ error: 'bad action' }, { status: 400 });
    raw = { ...raw, ...quickAction(action as 'plus_day', effectiveFor(settings, key.period, inst), now) };
  }
  // The undo snackbar restores what was there, even a publish time that has since passed.
  const v = validateOverrides(raw, now, { allowPast: body.undo === true });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (Object.keys(v.value).length === 0) return NextResponse.json({ error: 'nothing to change' }, { status: 400 });
  const ok = await writeOverrides(db, key.athleteId, key.feature, key.period, v.value, caller.athleteId);
  if (!ok) return NextResponse.json({ error: 'save failed (migration 157?)' }, { status: 500 });
  // The post / circle now; publishBirthdayPosts applies the gate and this person's choices.
  const posted = publishNow ? await publishBirthdayPosts(db, key.period, now, { athleteId: key.athleteId }) : 0;
  return NextResponse.json({ ok: true, previous: pick(inst), saved: v.value, posted, ...(ok === 'needs_162' ? { warning: 'migration 162' } : {}) });
}

export async function DELETE(request: Request) {
  const { denied, caller } = await requireStoryAdmin(request);
  if (denied) return denied;
  const key = readKey(new URL(request.url).searchParams);
  if (!key) return NextResponse.json({ error: 'bad key' }, { status: 400 });
  const db = createServerClient();
  const inst = await readInstance(db, key.athleteId, key.feature, key.period);
  const ok = await resetOverrides(db, key.athleteId, key.feature, key.period, caller.athleteId);
  return ok ? NextResponse.json({ ok: true, previous: pick(inst) }) : NextResponse.json({ error: 'reset failed' }, { status: 500 });
}
