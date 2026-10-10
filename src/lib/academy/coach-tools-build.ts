/**
 * The coach tools for a set of trainees: reads (coach-tools-server.ts) → decisions
 * (coach-tools.ts) → the payload. Server-only. One function so the home's list and the
 * pace-update route agree on what the suggestion IS: the route recomputes it rather than
 * trusting numbers the phone sends back.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import type { ParsedWorkout } from '@/lib/ai/types';
import { loadTrainees, loadTraineeWeeks } from './book-server';
import { ZONE_INTENSITY, resolveIntensity } from './library';
import {
  activeAdjust, copyWeek, detectMissed, detectPaceSuggestion, isMissedDecided, isPaceSnoozed, missedKey, pickNote,
  preselectMissed, type CoachDecision, type PaceKind,
} from './coach-tools';
import {
  loadDecisions, loadEvidence, loadNotes, loadTestBasis, type TestBasis,
} from './coach-tools-server';
import type {
  CoachToolsResponse, EmptyNextPayload, MissedPayload, PaceSuggestionPayload, TraineeStrip,
} from './coach-tools-payload';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

const zone = (T: number, z: keyof typeof ZONE_INTENSITY) => {
  const { min, max } = resolveIntensity(T, ZONE_INTENSITY[z]);
  return Math.round((min + max) / 2);
};

/** Today's pace per kind straight from the test (plus the update in force), for kinds with no session. */
export function zoneCurrent(T: number, adjust: Partial<Record<PaceKind, number>>): Partial<Record<PaceKind, number>> {
  return {
    reps: zone(T, 'interval') + (adjust.reps ?? 0),
    tempo: zone(T, 'tempo') + (adjust.tempo ?? 0),
    easy: zone(T, 'easy') + (adjust.easy ?? 0),
  };
}

const km = (workouts: ParsedWorkout[], T: number | null, self: string) => {
  if (!workouts.length) return null;
  const copied = copyWeek({ workouts, sourceThresholdSec: T, targetThresholdSec: T, sameTrainee: true, mode: 'same' });
  void self;
  return Math.round(copied.reduce((s, c) => s + c.distanceM, 0) / 100) / 10;
};

export interface CoachToolsContext {
  basis: Record<string, TestBasis | null>;
  decisions: CoachDecision[];
  stored: boolean;
}

export async function buildCoachTools(supabase: Db, athleteIds: string[], opts: { now?: Date; withMissedKm?: boolean } = {}): Promise<CoachToolsResponse & { context: CoachToolsContext }> {
  const now = opts.now ?? new Date();
  const today = israelToday(now);
  const thisWeek = planWeekStartOf(today);
  const nextWeek = addDaysToDateStr(thisWeek, 7);
  const trainees = (await loadTrainees(supabase, athleteIds)).filter(t => t.isAcademy && t.active);
  const ids = trainees.map(t => t.id);
  const nameOf = new Map(trainees.map(t => [t.id, t.name]));

  const [basis, decided, notes, nextWeeks, thisWeeks] = await Promise.all([
    loadTestBasis(supabase, ids),
    loadDecisions(supabase, ids),
    loadNotes(supabase, ids, new Date(now.getTime() - 14 * 86_400_000).toISOString()),
    loadTraineeWeeks(supabase, ids, nextWeek),
    loadTraineeWeeks(supabase, ids, thisWeek),
  ]);
  const thresholds = Object.fromEntries(ids.map(id => [id, basis[id]?.thresholdSec ?? null]));
  const evidence = await loadEvidence(supabase, ids, thresholds, today);
  const decisions = decided.rows;

  // ── Pace ──
  const pace: PaceSuggestionPayload[] = [];
  for (const id of ids) {
    const b = basis[id];
    if (!b) continue;
    const active = activeAdjust(decisions.filter(d => d.athleteId === id), b.testDate);
    const sug = detectPaceSuggestion({
      athleteId: id,
      name: nameOf.get(id) ?? '',
      basisTestDate: b.testDate,
      since: active.fromWeek,
      sessions: evidence[id]?.paceSessions ?? [],
      fallbackCurrent: zoneCurrent(b.thresholdSec, active.adjust),
    });
    if (!sug) continue;
    if (isPaceSnoozed(decisions, id, b.testDate, now.getTime())) continue;
    pace.push(sug);
  }

  // ── Missed ──
  const missed: MissedPayload[] = [];
  for (const id of ids) {
    const weeks = evidence[id]?.weeks ?? [];
    const found = detectMissed(weeks, today);
    if (!found) continue;
    if (isMissedDecided(decisions, id, found.weekStart)) continue;
    const week = weeks.find(w => w.weekStart === found.weekStart);
    const targetWeek = addDaysToDateStr(found.weekStart, 7);
    const note = pickNote(notes[id] ?? [], addDaysToDateStr(found.weekStart, -3));
    let targetKm: number | null = null, lightKm: number | null = null, missedKm: number | null = null;
    if (opts.withMissedKm !== false) {
      const T = thresholds[id];
      const [target, missedPlan] = await Promise.all([
        loadTraineeWeeks(supabase, [id], targetWeek),
        loadTraineeWeeks(supabase, [id], found.weekStart),
      ]);
      const targetWorkouts = target[id]?.workouts ?? [];
      const missedWorkouts = missedPlan[id]?.workouts ?? [];
      targetKm = km(targetWorkouts, T, id);
      missedKm = km(missedWorkouts, T, id);
      const base = targetWorkouts.length ? targetWorkouts : missedWorkouts;
      if (base.length) {
        const light = copyWeek({ workouts: base, sourceThresholdSec: T, targetThresholdSec: T, sameTrainee: true, mode: 'light' });
        lightKm = Math.round(light.reduce((s, c) => s + c.distanceM, 0) / 100) / 10;
      }
    }
    missed.push({
      key: missedKey(id, found.weekStart),
      athleteId: id,
      name: nameOf.get(id) ?? '',
      weekStart: found.weekStart,
      targetWeek,
      rule: found.rule,
      missed: found.missed,
      planned: found.planned,
      sessions: week?.sessions ?? [],
      note: note ? { text: note.text, at: note.at, reason: note.reason } : null,
      preselect: preselectMissed(note?.reason ?? null),
      targetKm,
      lightKm,
      missedKm,
    });
  }

  // ── Empty next week ──
  const empty = ids.filter(id => (nextWeeks[id]?.workouts.length ?? 0) === 0);
  const withThisWeek = ids.filter(id => (thisWeeks[id]?.workouts.length ?? 0) > 0);
  let emptyNext: EmptyNextPayload | null = null;
  if (empty.length && withThisWeek.length) {
    const most = (list: string[]) => [...list].sort((a, b) =>
      (thisWeeks[b]?.workouts.length ?? 0) - (thisWeeks[a]?.workouts.length ?? 0) || (nameOf.get(a) ?? '').localeCompare(nameOf.get(b) ?? ''))[0];
    const fromEmpty = empty.filter(id => withThisWeek.includes(id));
    emptyNext = {
      key: `copy:${nextWeek}:${[...empty].sort().join(',')}`,
      weekStart: nextWeek,
      trainees: empty.map(id => ({ id, name: nameOf.get(id) ?? '' })).sort((a, b) => a.name.localeCompare(b.name)),
      sourceId: (fromEmpty.length ? most(fromEmpty) : most(withThisWeek)) ?? null,
    };
  }

  // ── This week, per trainee ──
  const strips: TraineeStrip[] = ids.map(id => {
    const w = (evidence[id]?.weeks ?? []).find(x => x.weekStart === thisWeek);
    const sessions = w?.sessions ?? [];
    return {
      athleteId: id,
      name: nameOf.get(id) ?? '',
      planned: sessions.length,
      done: sessions.filter(s => s.color !== 'red' && s.color !== 'grey').length,
      colors: sessions.map(s => s.color),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    today, thisWeek, nextWeek, stored: decided.stored, pace, missed, emptyNext, strips,
    context: { basis, decisions, stored: decided.stored },
  };
}
