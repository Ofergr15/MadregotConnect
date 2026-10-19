import { createServerClient } from '@/lib/supabase/server';

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
 * Phase 1 wires ONLY 'weekly'. Birthday still runs on its own app_settings switch.
 */

export type StoryFeature = 'weekly' | 'birthday' | 'annual';
export type StoryState = 'off' | 'self' | 'testers' | 'all';
export const STORY_FEATURES: StoryFeature[] = ['weekly', 'birthday', 'annual'];
export const STORY_STATES: StoryState[] = ['off', 'self', 'testers', 'all'];

export type GateReason =
  | 'paused' | 'no_settings' | 'db_error' | 'off' | 'not_admin'
  | 'not_tester' | 'inactive' | 'no_athlete' | 'ok';

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
  let dbError = shared.dbError;
  if (!dbError && athleteId) {
    try {
      const [a, t] = await Promise.all([
        db.from('athletes').select('status').eq('id', athleteId).maybeSingle(),
        db.from('story_testers').select('athlete_id').eq('athlete_id', athleteId).maybeSingle(),
      ]);
      if (a.error || t.error) dbError = true;
      athleteActive = (a.data as { status?: string } | null)?.status === 'active';
      isTester = !!t.data;
    } catch {
      dbError = true;
    }
  }
  const { sendPush: _sendPush, ...facts } = shared;
  void _sendPush;
  return decideStoryGate({ ...facts, dbError, athleteId, athleteActive, isTester, isAdmin: !!opts.isAdmin });
}

/**
 * Many athletes at once, for the cron. No admin preview here: a push is never a
 * preview, so 'self' lets nobody through. Callers pass only ACTIVE athletes.
 * Returns the ids that may receive the PUSH; any error, or send_push=false, = empty set.
 */
export async function storyGateMany(feature: StoryFeature, activeAthleteIds: string[], opts: { db?: Db } = {}): Promise<Set<string>> {
  const out = new Set<string>();
  if (activeAthleteIds.length === 0) return out;
  const db = opts.db ?? createServerClient();
  const shared = await readShared(db, feature);
  // send_push=false: the story stays on screen for whoever the gate opens it to, but no push goes out.
  if (!shared.sendPush) return out;
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
  for (const id of activeAthleteIds) {
    const r = decideStoryGate({ paused: shared.paused, state: shared.state, dbError, athleteId: id, athleteActive: true, isTester: testers.has(id), isAdmin: false });
    if (r.allowed && !r.preview) out.add(id);
  }
  return out;
}
