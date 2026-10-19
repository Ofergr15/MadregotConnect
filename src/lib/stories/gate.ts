import { createServerClient } from '@/lib/supabase/server';
import { isPrefsColumnMissing, optedOut, parseStoryPrefs } from './prefs';

/**
 * THE STORIES GATE (phase 1, migration 156). One server-side answer to "may this
 * athlete get this story right now?", used by every surface — the Saturday push in
 * /api/cron/tick, the feed card and the share deep link through /api/stories/weekly —
 * so a push and a screen can never disagree.
 *
 * It fails CLOSED. A missing settings row, any read error (including the tables not
 * existing before 156 is pasted) and `app_settings.stories_paused='on'` all mean no,
 * for admins too. There is no code default and no env bypass.
 *
 *   off      nobody
 *   self     only an admin / super-user, as a PREVIEW (never a push)
 *   testers  only active athletes listed in story_testers; an admin who is not
 *            listed gets a preview only
 *   all      every active athlete
 *
 * Phase 2 (migration 157): birthday and annual run on it too, and the athlete's own
 * opt-out (athletes.story_prefs) closes it for them. Per-person overrides
 * (story_instances, lib/stories/instances.ts) are applied AFTER this and can only narrow.
 */

export type StoryFeature = 'weekly' | 'birthday' | 'annual';
export type StoryState = 'off' | 'self' | 'testers' | 'all';
export const STORY_FEATURES: StoryFeature[] = ['weekly', 'birthday', 'annual'];
export const STORY_STATES: StoryState[] = ['off', 'self', 'testers', 'all'];

export type GateReason =
  | 'paused' | 'no_settings' | 'db_error' | 'off' | 'not_admin'
  | 'not_tester' | 'inactive' | 'no_athlete' | 'opted_out' | 'ok';

export interface GateResult {
  allowed: boolean;
  reason: GateReason;
  /** Allowed only to look: no push, no marks. */
  preview: boolean;
  /** The reader is on the tester list and the feature is in testing — show the badge. */
  tester: boolean;
  state: StoryState | null;
}

/** Everything the decision needs, already read. `null` settings = row missing. */
export interface GateFacts {
  paused: boolean;
  dbError: boolean;
  state: StoryState | null;
  athleteId: string | null;
  athleteActive: boolean;
  isTester: boolean;
  isAdmin: boolean;
  /** athletes.story_prefs[feature] === false. Missing = not opted out. */
  optedOut?: boolean;
}

const no = (reason: GateReason, state: StoryState | null = null): GateResult =>
  ({ allowed: false, reason, preview: false, tester: false, state });

/** The pure decision — every branch here has a unit test (src/__tests__/storyGate.test.ts). */
export function decideStoryGate(f: GateFacts): GateResult {
  if (f.dbError) return no('db_error');
  if (f.paused) return no('paused', f.state);
  if (!f.state || !STORY_STATES.includes(f.state)) return no('no_settings');
  const state = f.state;
  if (state === 'off') return no('off', state);
  if (f.optedOut && f.athleteId && state !== 'self') {
    // The athlete said no: nothing for them; an admin may still look (preview, no push).
    return f.isAdmin ? { allowed: true, reason: 'ok', preview: true, tester: false, state } : no('opted_out', state);
  }
  if (state === 'self') {
    return f.isAdmin ? { allowed: true, reason: 'ok', preview: true, tester: false, state } : no('not_admin', state);
  }
  if (!f.athleteId) {
    return f.isAdmin ? { allowed: true, reason: 'ok', preview: true, tester: false, state } : no('no_athlete', state);
  }
  if (state === 'testers') {
    if (f.isTester && f.athleteActive) return { allowed: true, reason: 'ok', preview: false, tester: true, state };
    if (f.isAdmin) return { allowed: true, reason: 'ok', preview: true, tester: false, state };
    return no(f.isTester ? 'inactive' : 'not_tester', state);
  }
  // all
  if (f.athleteActive) return { allowed: true, reason: 'ok', preview: false, tester: false, state };
  if (f.isAdmin) return { allowed: true, reason: 'ok', preview: true, tester: false, state };
  return no('inactive', state);
}

type Db = ReturnType<typeof createServerClient>;

interface Shared { paused: boolean; dbError: boolean; state: StoryState | null; sendPush: boolean }

async function readShared(db: Db, feature: StoryFeature): Promise<Shared> {
  try {
    const [p, s] = await Promise.all([
      db.from('app_settings').select('value').eq('key', 'stories_paused').maybeSingle(),
      db.from('story_feature_settings').select('state, send_push').eq('feature', feature).maybeSingle(),
    ]);
    if (p.error || s.error) return { paused: false, dbError: true, state: null, sendPush: false };
    return {
      paused: (p.data as { value?: string } | null)?.value === 'on',
      dbError: false,
      state: ((s.data as { state?: StoryState } | null)?.state) ?? null,
      // Only an explicit true sends; the screens stay open either way.
      sendPush: (s.data as { send_push?: boolean } | null)?.send_push === true,
    };
  } catch {
    return { paused: false, dbError: true, state: null, sendPush: false };
  }
}

export interface StorySettingsRow {
  feature: StoryFeature;
  state: StoryState;
  send_push: boolean;
  feed_post: boolean;
  generate_at: string;
  weekday: number | null;
  annual_date: string | null;
  display_days: number;
  min_runs: number;
  updated_at?: string;
}

/** The whole settings row, or null on a missing row / any error (callers then do nothing). */
export async function readStorySettings(feature: StoryFeature, opts: { db?: Db } = {}): Promise<StorySettingsRow | null> {
  try {
    const db = opts.db ?? createServerClient();
    const { data, error } = await db.from('story_feature_settings').select('*').eq('feature', feature).maybeSingle();
    if (error || !data) return null;
    return data as StorySettingsRow;
  } catch {
    return null;
  }
}

/** One athlete's status + story opt-out for `feature`. A pre-157 DB (no story_prefs) = no opt-out. */
async function readAthleteFacts(db: Db, athleteId: string, feature: StoryFeature): Promise<{ active: boolean; optedOut: boolean; error: boolean }> {
  let r = await db.from('athletes').select('status, story_prefs').eq('id', athleteId).maybeSingle();
  if (r.error && isPrefsColumnMissing(r.error)) r = await db.from('athletes').select('status').eq('id', athleteId).maybeSingle();
  if (r.error) return { active: false, optedOut: false, error: true };
  const row = r.data as { status?: string; story_prefs?: unknown } | null;
  return { active: row?.status === 'active', optedOut: optedOut(parseStoryPrefs(row?.story_prefs), feature), error: false };
}

/** One athlete (a screen / route). */
export async function storyGate(
  feature: StoryFeature,
  athleteId: string | null,
  opts: { isAdmin?: boolean; db?: Db } = {},
): Promise<GateResult> {
  const db = opts.db ?? createServerClient();
  const shared = await readShared(db, feature);
  let athleteActive = false;
  let isTester = false;
  let isOptedOut = false;
  let dbError = shared.dbError;
  if (!dbError && athleteId) {
    try {
      const [a, t] = await Promise.all([
        readAthleteFacts(db, athleteId, feature),
        db.from('story_testers').select('athlete_id').eq('athlete_id', athleteId).maybeSingle(),
      ]);
      if (a.error || t.error) dbError = true;
      athleteActive = a.active;
      isOptedOut = a.optedOut;
      isTester = !!t.data;
    } catch {
      dbError = true;
    }
  }
  const { sendPush: _sendPush, ...facts } = shared;
  void _sendPush;
  return decideStoryGate({ ...facts, dbError, athleteId, athleteActive, isTester, isAdmin: !!opts.isAdmin, optedOut: isOptedOut });
}

/**
 * Many athletes at once, for the cron. No admin preview here: a push is never a
 * preview, so 'self' lets nobody through. Callers pass only ACTIVE athletes.
 * Returns the ids that may receive the PUSH; any error, or send_push=false, = empty set.
 */
export async function storyGateMany(
  feature: StoryFeature,
  activeAthleteIds: string[],
  opts: { db?: Db; /** false = who may HAVE it (the feed post), not who gets the push. Default true. */ forPush?: boolean } = {},
): Promise<Set<string>> {
  const out = new Set<string>();
  if (activeAthleteIds.length === 0) return out;
  const db = opts.db ?? createServerClient();
  const shared = await readShared(db, feature);
  // send_push=false: the story stays on screen for whoever the gate opens it to, but no push goes out.
  if (opts.forPush !== false && !shared.sendPush) return out;
  let testers = new Set<string>();
  let dbError = shared.dbError;
  if (!dbError && shared.state === 'testers') {
    try {
      const { data, error } = await db.from('story_testers').select('athlete_id');
      if (error) dbError = true;
      testers = new Set(((data || []) as { athlete_id: string }[]).map((r) => r.athlete_id));
    } catch {
      dbError = true;
    }
  }
  // The athletes' own opt-outs. No column yet (157 not pasted) = nobody opted out;
  // any other error closes it for everyone.
  const opted = new Set<string>();
  if (!dbError && shared.state && shared.state !== 'off' && shared.state !== 'self') {
    try {
      const { data, error } = await db.from('athletes').select('id, story_prefs').in('id', activeAthleteIds);
      if (error && !isPrefsColumnMissing(error)) dbError = true;
      for (const r of ((error ? [] : data) || []) as { id: string; story_prefs?: unknown }[]) {
        if (optedOut(parseStoryPrefs(r.story_prefs), feature)) opted.add(r.id);
      }
    } catch {
      dbError = true;
    }
  }
  for (const id of activeAthleteIds) {
    const r = decideStoryGate({ paused: shared.paused, state: shared.state, dbError, athleteId: id, athleteActive: true, isTester: testers.has(id), isAdmin: false, optedOut: opted.has(id) });
    if (r.allowed && !r.preview) out.add(id);
  }
  return out;
}
