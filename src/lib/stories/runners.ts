import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { readStorySettings, storyGateMany, type StoryFeature, type StorySettingsRow } from './gate';
import { assertNotPreview, claimPush, effectiveFor, pushDueAt, readInstances, type CustomText } from './instances';
import { annualPeriod, recentBirthday } from './schedule';
import type { BirthdayStory } from '@/lib/birthday-year/server';

/**
 * The cron side of the birthday and annual stories (called from /api/cron/tick on every
 * tick, not once a day: a per-person publish time — 07:30, "דחה למחר" — must be honoured).
 *
 * Order per person: the gate (state, testers, active, opt-out) → the overrides
 * (skipped / enabled=false narrow it) → the publish window (no push before publish_at,
 * none more than 3h after it — no backfill) → min runs → the claim. The claim is the
 * idempotency: the story_instances UNIQUE key + `pushed_at IS NULL`, so a tick that runs
 * twice sends once. Before 157 is pasted it falls back to a per-person ledger tag.
 */

type Db = SupabaseClient;
export interface Ledger { already: (tag: string) => Promise<boolean>; markFired: (tag: string, n: number) => Promise<void> }

export interface RunnerDeps {
  readSettings: (f: StoryFeature) => Promise<StorySettingsRow | null>;
  gateMany: (f: StoryFeature, ids: string[]) => Promise<Set<string>>;
  loadBirthday: (db: Db, athleteId: string, today: string) => Promise<BirthdayStory | null>;
  loadAnnual: (db: Db, athleteId: string, year: number, today: string) => Promise<BirthdayStory | null>;
  notify: (o: { athleteId: string; kind: string; copy: (l: 'he' | 'en') => { title: string; body: string }; url: string; tag: string }) => Promise<unknown>;
}

async function defaultDeps(): Promise<RunnerDeps> {
  const { loadStory, loadAnnualStory } = await import('@/lib/birthday-year/server');
  const { notifyAthlete } = await import('@/lib/push');
  return {
    readSettings: (f) => readStorySettings(f),
    gateMany: (f, ids) => storyGateMany(f, ids),
    loadBirthday: (db, id, today) => loadStory(db, id, today, { lookbackDays: 31 }),
    loadAnnual: loadAnnualStory,
    notify: (o) => notifyAthlete(o as never),
  };
}

const pushText = (base: { title: string; body: string }, ct: CustomText | null, locale: string) =>
  locale === 'he' && ct ? { title: ct.push_title || base.title, body: ct.push_body || base.body } : base;

interface Candidate { id: string; period: string }

async function runFor(
  db: Db, feature: 'birthday' | 'annual', now: Date, ledger: Ledger, deps: RunnerDeps,
  candidates: Candidate[],
  load: (c: Candidate, today: string) => Promise<BirthdayStory | null>,
  copy: (story: BirthdayStory, locale: 'he' | 'en') => { title: string; body: string },
  url: string,
): Promise<number> {
  const settings = await deps.readSettings(feature);
  if (!settings || settings.state === 'off' || settings.state === 'self' || candidates.length === 0) return 0;
  const today = israelToday(now);
  const gated = await deps.gateMany(feature, candidates.map((c) => c.id));
  const open = candidates.filter((c) => gated.has(c.id));
  if (open.length === 0) return 0;
  const { map } = await readInstances(db, feature, open.map((c) => c.period)).catch(() => ({ map: new Map(), ready: false }));
  let sent = 0;
  for (const c of open) {
    const inst = map.get(`${c.id}:${c.period}`) ?? null;
    const e = effectiveFor(settings, c.period, inst);
    if (!pushDueAt(e, now, inst?.pushed_at)) continue;
    try {
      const story = await load(c, today);
      if (!story || story.birthday !== c.period) continue;
      const withRuns = effectiveFor(settings, c.period, inst, story.stats.runs);
      if (!withRuns.on || story.stats.runs === 0) continue;
      if (story.config?.published === false) continue; // legacy per-story switch: can only close
      const tag = `story:${feature}:${c.id}:${c.period}`;
      const claim = await claimPush(db, c.id, feature, c.period, now);
      if (claim === 'taken') continue;
      if (claim === 'no_table') {
        if (await ledger.already(tag)) continue;
        await ledger.markFired(tag, 1);
      }
      assertNotPreview({ preview: false });
      await deps.notify({
        athleteId: c.id,
        kind: feature === 'birthday' ? 'birthday_year' : 'annual_story',
        copy: (locale) => pushText(copy(story, locale), withRuns.customText, locale),
        url,
        tag,
      });
      sent++;
    } catch (err) {
      console.error(`story ${feature} push ${c.id} failed:`, err);
    }
  }
  return sent;
}

/** Every tick from 06:00: birthday people whose story is due now. */
export async function runBirthdayStoryPushes(db: Db, now: Date, ledger: Ledger, deps?: RunnerDeps): Promise<number> {
  const d = deps ?? (await defaultDeps());
  const today = israelToday(now);
  const settings = await d.readSettings('birthday');
  if (!settings || settings.state === 'off' || settings.state === 'self') return 0;
  const { data } = await db.from('athletes').select('id, birth_date')
    .eq('coach_id', COACH_ID).eq('status', 'active').not('birth_date', 'is', null);
  const candidates: Candidate[] = [];
  for (const a of (data || []) as Array<{ id: string; birth_date: string | null }>) {
    const period = recentBirthday(a.birth_date, today, 31);
    if (period) candidates.push({ id: a.id, period });
  }
  const { birthdayYearCopy } = await import('@/lib/notifications/copy');
  return runFor(db, 'birthday', now, ledger, { ...d, readSettings: async () => settings }, candidates,
    (c, t) => d.loadBirthday(db, c.id, t),
    (s, locale) => birthdayYearCopy(locale, { name: s.name, km: s.stats.km }),
    '/feed?birthdayYear=1');
}

/** Every tick: the annual story, from Dec 31 at its time (18:00) while January lasts. */
export async function runAnnualStoryPushes(db: Db, now: Date, ledger: Ledger, deps?: RunnerDeps): Promise<number> {
  const d = deps ?? (await defaultDeps());
  const today = israelToday(now);
  const settings = await d.readSettings('annual');
  const period = annualPeriod(today, settings?.annual_date || '12-31');
  if (!period || !settings) return 0;
  const { data } = await db.from('athletes').select('id').eq('coach_id', COACH_ID).eq('status', 'active');
  const candidates = ((data || []) as { id: string }[]).map((a) => ({ id: a.id, period }));
  const year = Number(period.slice(0, 4));
  return runFor(db, 'annual', now, ledger, { ...d, readSettings: async () => settings }, candidates,
    (c, t) => d.loadAnnual(db, c.id, year, t),
    (s, locale) => (locale === 'he'
      ? { title: `🏁 ${s.name}, השנה שלך בריצה`, body: `${s.stats.km.toLocaleString('en-US')} ק״מ ב־${year}. לחיצה ותראה.` }
      : { title: `🏁 ${s.name}, your year of running`, body: `${s.stats.km.toLocaleString('en-US')} km in ${year}. Tap to see it.` }),
    '/feed?annualStory=1');
}
