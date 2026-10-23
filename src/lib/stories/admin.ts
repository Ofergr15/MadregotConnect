import { STORY_STATES, type StoryState } from './gate';
import { cleanLayout } from '@/lib/week-story/layout';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Pure: an admin PUT body → the story_feature_settings patch, or an error. */
export function settingsPatch(body: Record<string, unknown>): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {};
  if ('state' in body) {
    if (!STORY_STATES.includes(body.state as StoryState)) return { ok: false, error: 'bad state' };
    patch.state = body.state;
  }
  if ('generate_at' in body) {
    if (typeof body.generate_at !== 'string' || !TIME.test(body.generate_at)) return { ok: false, error: 'bad time' };
    patch.generate_at = body.generate_at;
  }
  if ('display_days' in body) {
    const n = Number(body.display_days);
    if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: 'display_days 1-31' };
    patch.display_days = n;
  }
  if ('min_runs' in body) {
    const n = Number(body.min_runs);
    if (!Number.isInteger(n) || n < 0 || n > 365) return { ok: false, error: 'min_runs 0-365' };
    patch.min_runs = n;
  }
  for (const k of ['feed_post', 'send_push'] as const) {
    if (k in body) {
      if (typeof body[k] !== 'boolean') return { ok: false, error: `bad ${k}` };
      patch[k] = body[k];
    }
  }
  // The weekly story's layout, edited on the story itself (lib/week-story/layout.ts).
  if ('layout' in body) {
    if (!body.layout || typeof body.layout !== 'object' || Array.isArray(body.layout)) return { ok: false, error: 'bad layout' };
    patch.layout = cleanLayout(body.layout);
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'nothing to change' };
  return { ok: true, patch };
}


import { decideStoryGate, type StorySettingsRow } from './gate';
import { effectiveFor, overrideSummary, type StoryInstance } from './instances';

export type RowStatus = 'ready' | 'preview_only' | 'gate_off' | 'paused' | 'not_tester' | 'opted_out' | 'inactive' | 'skipped' | 'disabled';

/** One upcoming row's status + chip, from the same gate + overrides the cron uses. Pure. */
export function rowStatus(
  settings: StorySettingsRow, paused: boolean, period: string,
  person: { id: string; active: boolean; tester: boolean; optedOut: boolean },
  inst: Partial<StoryInstance> | null,
): { status: RowStatus; summary: string; publishAt: string; until: string } {
  const e = effectiveFor(settings, period, inst);
  const g = decideStoryGate({ paused, dbError: false, state: settings.state, athleteId: person.id, athleteActive: person.active, isTester: person.tester, isAdmin: false, optedOut: person.optedOut });
  let status: RowStatus = 'ready';
  if (paused) status = 'paused';
  else if (settings.state === 'off') status = 'gate_off';
  else if (settings.state === 'self') status = 'preview_only';
  else if (!g.allowed) status = g.reason === 'opted_out' ? 'opted_out' : g.reason === 'not_tester' ? 'not_tester' : 'inactive';
  else if (e.reason === 'skipped') status = 'skipped';
  else if (e.reason === 'disabled') status = 'disabled';
  return { status, summary: overrideSummary(e), publishAt: e.publishAt.toISOString(), until: e.until.toISOString() };
}

/** The upcoming weekly Saturday (or today, when it is Saturday). */
export function nextSaturday(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
