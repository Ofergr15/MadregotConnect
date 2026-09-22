'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send, CheckCircle2, XCircle, Calendar, ChevronLeft, ChevronRight,
  Plus, Pencil, Trash2, BookOpen, Users, Check, AlertTriangle, ArrowDownToLine, Search, Archive,
} from 'lucide-react';
import { cn, planWeekStartOf, shiftWeekStart } from '@/lib/utils';
import { COACH_ID } from '@/lib/constants';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { formatPace } from '@/lib/garmin/pace';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutEditorPanel } from '@/components/WorkoutEditor';
import { Spinner, EmptyState, Sheet, Button } from '@/components/ui';
import { effectiveOffsetSec, fmtOffsetSec, type AcademyBand } from '@/lib/academy/bands';
import { laneForBand, laneWorkouts, lanesDiffer, LANE_MARKS, type Lane } from '@/lib/academy/group-lane';
import {
  entryHeadline, entryShape, entryVolume, filterLibrary, type LibraryEntry,
} from '@/lib/academy/library';
import { ZONE_LABEL } from '@/components/academy/libraryText';
import {
  bookEntryIds, materialiseWeek, weekGaps, type PlanSlot, type Recipient,
} from '@/lib/academy/plan-slot';
import { raceCountdown, weekFit, type PlannedDay } from '@/lib/academy/plan-fit';
import type { PlanInputs } from '@/lib/academy/characterization';
import { getWorkoutKm } from '@/lib/plans/workout-parsing';

interface AcademyAthlete {
  id: string;
  name: string;
  hasGarmin?: boolean;
  /** The goal band, for resolving paces and for defaulting a group-plan lane. */
  band?: AcademyBand | null;
  /** Per-trainee sec/km override; a stored 0 is a real decision, so not `|| null`. */
  paceOffsetSec?: number | null;
}

interface LibraryWorkout {
  id: string;
  name: string;
  workout: ParsedWorkout;
  created_at: string;
}

interface PushOutcome {
  id: string;
  name: string;
  ok: boolean;
  msg: string;
}

const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const DAY_FULL = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

function fmtWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${start.toLocaleDateString('he-IL', opts)} – ${end.toLocaleDateString('he-IL', opts)}`;
}

function emptyWorkout(dayOfWeek: number): ParsedWorkout {
  return {
    dayOfWeek,
    name: `אימון ${DAY_FULL[dayOfWeek]}`,
    steps: [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
    ],
  };
}

/**
 * A book entry in one line, with no pace in it.
 *
 * The same three facts the book's own list shows — structure, volume, effort — because the
 * coach is recognising a session they already know. `stepSummary` would print `@ 4:33` here,
 * which is the one thing an entry cannot honestly say until a trainee is named.
 */
function bookSummary(entry: Pick<LibraryEntry, 'steps'>): string {
  const shape = entryShape(entry.steps);
  const { distanceM, durationSec } = entryVolume(entry.steps);
  const headline = entryHeadline(entry.steps);
  const effort = !headline
    ? null
    : headline.kind === 'hr'
      ? 'דופק'
      : (headline.zone && ZONE_LABEL[headline.zone]) || `${headline.fastPct}% מהסף`;
  // BOTH measures when an entry has both, which most of them do: a 30-minute test opens with
  // a 2 km warm-up, and printing only the kilometres made `טסט 30 דקות` read as a 2 km jog —
  // the thirty minutes, which is the entire session, was the part left off the line.
  return [
    shape && shape.kind === 'reps' ? `${shape.count}×${shape.distanceM}` : null,
    distanceM ? `${Number.isInteger(distanceM / 1000) ? distanceM / 1000 : (distanceM / 1000).toFixed(1)} ק"מ` : null,
    durationSec ? `${Math.round(durationSec / 60)} דק'` : null,
    effort,
  ].filter(Boolean).join(' · ');
}

function stepSummary(step: WorkoutStep): string {
  const dur = step.durationType === 'distance'
    ? `${((step.durationValue || 0) / 1000).toFixed(1)} ק"מ`
    : step.durationType === 'time'
      ? `${Math.round((step.durationValue || 0) / 60)} דק'`
      : 'הקפה';
  let pace = '';
  if (step.notes && /\d+:\d{2}/.test(step.notes)) pace = step.notes;
  else if (step.targetPaceMinPerKm) {
    const min = step.targetPaceMinPerKm, max = step.targetPaceMaxPerKm;
    pace = max && max !== min ? `${formatPace(min)}-${formatPace(max)}` : formatPace(min);
  }
  const rep = step.repeatCount ? `${step.repeatCount}× ` : '';
  return `${rep}${dur}${pace ? ` @ ${pace}` : ''}`;
}

/** Short label for a trainee's resolved pace offset, or null when unresolved. */
function offsetLabel(a: AcademyAthlete): string | null {
  const off = effectiveOffsetSec(a.paceOffsetSec, a.band);
  return off === null ? null : `${fmtOffsetSec(off)} ש׳/ק״מ`;
}

export function AcademyPlanComposer({ athletes }: { athletes: AcademyAthlete[] }) {
  // One board, one or more recipients — "each week the coach decides whether to
  // push a specific workout to one or more athletes". Selection order matters:
  // the first pick is the trainee whose saved week seeds the board.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [weekStart, setWeekStart] = useState(() => planWeekStartOf());
  // Day-of-week (0=Sun..6=Sat) → what is planned for that day: either a written workout
  // carrying absolute paces, or a book entry carrying none. See `lib/academy/plan-slot.ts` —
  // the slot remembers which, because the two are priced for a trainee by different
  // mechanisms and applying both to one workout is pace math done twice.
  const [slots, setSlots] = useState<Record<number, PlanSlot>>({});
  // Whether the board holds edits that were never saved. Guards the seed-load
  // below: switching recipient mid-build must not silently discard the workout
  // the coach just wrote.
  const [dirty, setDirty] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [library, setLibrary] = useState<LibraryWorkout[]>([]);
  const [book, setBook] = useState<LibraryEntry[]>([]);
  /** athleteId → their latest approved test's threshold pace, in sec/km. */
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  /**
   * athleteId → what they said on the characterization call, for whoever is selected.
   *
   * An athlete missing from this map has no answers on file, which most of the club does not:
   * the form is newer than the roster. `plan-fit.ts` says nothing at all about those people
   * rather than assuming they train every day.
   */
  const [planInputs, setPlanInputs] = useState<Record<string, PlanInputs>>({});
  const [sourceDay, setSourceDay] = useState<number | null>(null);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
  const [bookDay, setBookDay] = useState<number | null>(null);
  const [importDay, setImportDay] = useState<number | null>(null);
  const [whoOpen, setWhoOpen] = useState(false);
  const [groupPlans, setGroupPlans] = useState<any[]>([]);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResults, setPushResults] = useState<PushOutcome[] | null>(null);

  const byId = useMemo(() => new Map(athletes.map(a => [a.id, a])), [athletes]);
  const selected = useMemo(
    () => selectedIds.map(id => byId.get(id)).filter(Boolean) as AcademyAthlete[],
    [selectedIds, byId],
  );
  const primary = selected[0] || null;

  useEffect(() => {
    if (!selectedIds.length && athletes.length) setSelectedIds([athletes[0].id]);
  }, [athletes, selectedIds.length]);

  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/workouts');
      const data = await res.json();
      setLibrary(data.workouts || []);
    } catch { /* library is optional */ }
  }, []);

  useEffect(() => { fetchLibrary(); }, [fetchLibrary]);

  // The book, and the thresholds that price it.
  //
  // Both are optional in the same way the library is: the book's table is pasted in by hand
  // like every migration here, and this screen worked before either existed. A failed fetch
  // leaves the board with the sources it always had rather than an error — but a MISSING
  // threshold is never treated as a default, see `materialiseWeek`.
  useEffect(() => {
    let cancelled = false;
    bearerHeaders(false)
      .then(headers => fetch('/api/academy/library', { headers }))
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setBook(d?.entries || []); })
      .catch(() => {});
    bearerHeaders(false)
      // The registry's own protocol default. A 2000m and a 30-minute effort give different
      // paces at the same fitness, so the board prices the book off ONE protocol — mixing
      // them would make a trainee's session depend on which test they last happened to run.
      .then(headers => fetch('/api/academy/tests?protocol=30min', { headers }))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const row of d?.rows || []) {
          if (typeof row?.lastPaceSec === 'number' && row.lastPaceSec > 0) next[row.athleteId] = row.lastPaceSec;
        }
        setThresholds(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // What the characterization call said about the trainees currently selected.
  //
  // Keyed on the joined id list rather than on the array, so re-selecting the same people in a
  // different order does not refetch. Optional in the same way the book and the thresholds are:
  // migration 111 is hand-pasted, most of the roster predates the form, and a failed fetch
  // leaves the board exactly as it was before this existed.
  const selectedKey = selectedIds.join(',');
  useEffect(() => {
    if (!selectedKey) { setPlanInputs({}); return; }
    let cancelled = false;
    bearerHeaders(false)
      .then(headers => fetch(`/api/academy/plan-inputs?athleteIds=${encodeURIComponent(selectedKey)}`, { headers }))
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setPlanInputs(d?.inputs || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedKey]);

  /** One trainee, with both pace mechanisms resolved — the input `materialiseWeek` takes. */
  const recipientOf = useCallback((a: AcademyAthlete): Recipient => ({
    athleteId: a.id,
    name: a.name,
    offsetSec: effectiveOffsetSec(a.paceOffsetSec, a.band),
    thresholdPaceSec: thresholds[a.id] ?? null,
  }), [thresholds]);

  // The club's group plan for the displayed week (athlete_id IS NULL — that's what
  // an unscoped list returns), so a trainee's week can be seeded from the session
  // the club is actually doing instead of being retyped.
  //
  // This used to fetch the whole season once and pick the week out of it, which
  // meant 245 KB of `parsed_workouts` for the ~22 KB actually rendered. Narrowed
  // to the week and refetched on navigation instead; `cancelled` already guarded
  // the race, it just now also covers week changes.
  useEffect(() => {
    let cancelled = false;
    bearerHeaders(false)
      .then(headers => fetch(`/api/plans?coach_id=${COACH_ID}&week_start_date=${weekStart}`, { headers }))
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setGroupPlans(d?.plans || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [weekStart]);

  const groupPlan = useMemo(
    () => groupPlans.find((p: any) => p.week_start_date === weekStart) || null,
    [groupPlans, weekStart],
  );

  // Seed the board from the primary trainee's saved plan for the week, so the
  // coach edits what exists rather than always rebuilding from blank. Skipped
  // while the board is dirty (see `dirty`). Falls back to an empty draft when
  // there's no saved plan (or the athlete_id column isn't migrated). Guards
  // against races when the trainee/week changes mid-fetch.
  useEffect(() => {
    setPushResults(null);
    setError(null);
    if (dirty) return;
    if (!primary) { setSlots({}); return; }
    let cancelled = false;
    setSlots({});
    bearerHeaders(false)
      // Already per-week by nature (this effect re-runs on weekStart), so the
      // narrowing costs nothing and saves the rest of the athlete's season.
      .then(headers => fetch(`/api/plans?coach_id=${COACH_ID}&athlete_id=${primary.id}&week_start_date=${weekStart}`, { headers }))
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        const plan = (d?.plans || []).find((p: any) => p.week_start_date === weekStart);
        const workouts: ParsedWorkout[] = plan?.parsed_workouts?.workouts || [];
        const next: Record<number, PlanSlot> = {};
        // A saved plan row is `written` by definition, whatever it was picked from: it holds
        // the resolved paces one trainee was sent. Re-seeding it as a book slot would re-derive
        // it from whoever the board is pointed at now.
        for (const w of workouts) if (typeof w?.dayOfWeek === 'number') next[w.dayOfWeek] = { source: 'written', workout: w };
        setSlots(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [primary, weekStart, dirty]);

  const filledDays = Object.keys(slots).map(Number).sort((a, b) => a - b);

  const setSlot = (day: number, workout: ParsedWorkout) => {
    setSlots(prev => ({ ...prev, [day]: { source: 'written', workout: { ...workout, dayOfWeek: day } } }));
    setDirty(true);
    setPushResults(null);
  };
  const setBookSlot = (day: number, entry: LibraryEntry) => {
    // The ENTRY, not a resolved copy of it. Resolving here would mean resolving against
    // somebody — and the board has several recipients, so there is no somebody yet.
    setSlots(prev => ({ ...prev, [day]: { source: 'book', entry } }));
    setDirty(true);
    setPushResults(null);
  };
  const clearSlot = (day: number) => {
    setSlots(prev => {
      const next = { ...prev };
      delete next[day];
      return next;
    });
    setDirty(true);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    setPushResults(null);
  };

  // Save a workout to the reusable library (fire-and-forget, refresh list).
  const saveToLibrary = useCallback(async (w: ParsedWorkout) => {
    try {
      await fetch('/api/academy/workouts', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ name: w.name, workout: w }),
      });
      fetchLibrary();
    } catch { /* non-blocking */ }
  }, [fetchLibrary]);

  const deleteLibraryWorkout = async (id: string) => {
    try {
      await fetch(`/api/academy/workouts?id=${id}`, { method: 'DELETE', headers: await bearerHeaders(false) });
      setLibrary(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
  };

  // Which recipients have no resolvable paces. Today that is everybody — no band
  // has an offset set — so this drives a visible warning rather than a block:
  // their workout goes out with the paces exactly as written and with the watch's
  // pace alerts suppressed.
  const noGarmin = selected.filter(a => !a.hasGarmin);

  // Whose copy of THIS board loses days, and whose loses all of them. A missing band is a
  // warning; a missing test against a book entry is a workout that cannot be written at all,
  // because the entry holds a share of a number this trainee does not have.
  //
  // Both are asked about the BOARD and not about the trainee, which is the change the book
  // forces: a week made entirely of book entries needs no band at all, so warning that a
  // trainee has no offset would be warning about a mechanism this week does not use.
  // The board against what the trainees said they could do.
  //
  // The two sources of a day's distance are read here rather than in `plan-fit.ts`, because they
  // are two different mechanisms — a written workout carries its own estimate (or the coach's own
  // figure), a book entry only has the metres in its steps — and the pure module should be
  // testable without a fixture of parsed workouts. `getWorkoutKm(...).min` is deliberately the
  // floor of the estimate: the volume warning below should fire on a week that is unambiguously
  // too big, not on the wide end of a guess about an open block.
  const plannedDays: PlannedDay[] = useMemo(() => (
    Object.entries(slots)
      .filter(([, slot]) => !!slot)
      .map(([day, slot]) => {
        const s = slot as PlanSlot;
        const km = s.source === 'written'
          ? getWorkoutKm(s.workout).min
          : entryVolume(s.entry.steps).distanceM / 1000;
        // A session written purely in minutes has no distance to compare. 0 would read as a rest
        // day and quietly shrink the week's total, so it is "unknown" instead.
        return { dayOfWeek: Number(day), km: km > 0 ? km : null };
      })
  ), [slots]);

  const fit = useMemo(() => weekFit({
    days: plannedDays,
    recipients: selected.map(a => ({ athleteId: a.id, name: a.name, inputs: planInputs[a.id] ?? null })),
    primaryId: primary?.id ?? null,
  }), [plannedDays, selected, planInputs, primary]);

  const primaryInputs = primary ? planInputs[primary.id] ?? null : null;
  const countdown = raceCountdown(primaryInputs);
  const clashByDay = useMemo(
    () => new Map(fit.clashes.map(c => [c.dayOfWeek, c.names])),
    [fit.clashes],
  );

  const gaps = selected.map(a => ({ athlete: a, ...weekGaps(slots, recipientOf(a)) }));
  const unresolved = gaps.filter(g => g.needsBand).map(g => g.athlete);
  const untested = gaps.filter(g => g.needsTest);
  const wouldGetNothing = gaps.filter(g => g.empty);

  /**
   * Send the board to every selected trainee.
   *
   * One request pair per trainee, not one push for the whole selection, because
   * each trainee's copy is genuinely different: their band offset shifts every
   * pace, and their plan row is what their own app and adherence read. A shared
   * plan row would attribute one trainee's deliveries to another's plan.
   */
  const push = useCallback(async () => {
    if (!filledDays.length || !selected.length) return;
    setPushing(true);
    setError(null);
    setPushResults(null);
    const outcomes: PushOutcome[] = [];
    // How many trainees actually ended up with a plan row holding a book entry. That, and not
    // the watch, is what `use_count` counts: a trainee on Strava was still assigned the
    // session, and a Garmin failure is a delivery problem rather than a decision reversed.
    let bookTrainees = 0;
    const writtenDays = Object.values(slots).filter(s => s.source === 'written').length;
    const usedEntries = bookEntryIds(slots);

    try {
      for (const athlete of selected) {
        const recipient = recipientOf(athlete);
        const offset = recipient.offsetSec;
        // THIS trainee's copy: written days shifted by their offset, book days derived from
        // their own threshold, and book days they have no test for left out rather than
        // guessed. See `lib/academy/plan-slot.ts`.
        const { workouts, skipped, paceAlerts } = materialiseWeek(slots, recipient);
        // Naming the days rather than counting them: the coach's next move is to look at that
        // day, and `דולג יום ג׳` is the whole message.
        const skippedNote = skipped.length
          ? ` · דולגו ${skipped.map(s => DAY_LABELS[s.dayOfWeek]).join(', ')} — אין טסט`
          : '';

        if (!workouts.length) {
          outcomes.push({
            id: athlete.id, name: athlete.name, ok: false,
            msg: 'כל האימונים בלוח הם מהספר ואין טסט סף — אין ממה לגזור קצבים',
          });
          continue;
        }

        // Save the plan (individual, flat, at THIS trainee's paces) so their app
        // and their adherence show the same numbers their watch got.
        const saveRes = await fetch('/api/plans', {
          method: 'POST',
          headers: await bearerHeaders(),
          body: JSON.stringify({
            coach_id: COACH_ID,
            week_start_date: weekStart,
            original_input: '[built in-app]',
            parsed_workouts: { workouts },
            status: 'draft',
            athlete_id: athlete.id,
          }),
        });
        const saveData = await saveRes.json().catch(() => ({}));
        const planId = saveRes.ok ? saveData.plan?.id : null;
        if (planId && workouts.length > writtenDays) bookTrainees += 1;

        if (!athlete.hasGarmin) {
          // Worth saving anyway: adherence works off the plan row, and a trainee
          // on Strava has a plan to follow even with no watch to push to.
          outcomes.push({
            id: athlete.id, name: athlete.name, ok: !!planId,
            msg: planId ? `התוכנית נשמרה · אין גרמין מחובר, לא נשלח לשעון${skippedNote}` : 'שמירת התוכנית נכשלה',
          });
          continue;
        }

        const res = await fetch('/api/garmin/push-workouts', {
          method: 'POST',
          headers: await bearerHeaders(),
          body: JSON.stringify({
            planId,
            workouts,
            athleteIds: [athlete.id],
            weekStartDate: weekStart,
            // Paces we could not resolve must not become an alert on the watch.
            // The route can only narrow this, never widen it past the academy
            // setting. `materialiseWeek` owns the answer now, because with the book in
            // play a week can be fully priced for a trainee who has no band at all —
            // and a week with one unpriced day is not fully priced even if they do.
            paceAlerts,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const results = data.results || [];
        const ok = res.ok && results.length > 0 && results.every((r: any) => r.status === 'success');
        const failed = results.find((r: any) => r.status === 'failed');
        const count = workouts.length === 1 ? 'אימון אחד' : `${workouts.length} אימונים`;
        // The two mechanisms are reported separately because they are separate claims: the
        // offset moved the paces the coach wrote, and the test produced paces nobody wrote.
        const fromBook = workouts.length - writtenDays;
        const how = [
          writtenDays && offset ? `הקצבים הוזזו ב־${fmtOffsetSec(offset)} ש׳/ק״מ` : '',
          fromBook ? `${fromBook} מהספר לפי טסט הסף` : '',
        ].filter(Boolean).join(' · ');
        outcomes.push({
          id: athlete.id,
          name: athlete.name,
          ok,
          msg: ok
            ? `נשלחו ${count}${how ? ` · ${how}` : ''}${skippedNote}`
            : (failed?.error || data.message || data.error || 'השליחה נכשלה'),
        });

        if (planId) {
          bearerHeaders().then((headers) => fetch('/api/plans', {
            method: 'PUT', headers,
            body: JSON.stringify({ plan_id: planId, status: ok ? 'pushed' : 'partial' }),
          })).catch(() => {});
        }
      }
      // Record the pushes against the book, after the fact and without blocking anything.
      //
      // Fire-and-forget on purpose: the count orders a list, and a failed increment costs a
      // row's position in the book. Reporting it would put an error on a screen whose
      // headline result — the workouts reached the watches — is a success.
      if (bookTrainees > 0) {
        for (const id of usedEntries) {
          bearerHeaders().then(headers => fetch('/api/academy/library', {
            method: 'PATCH', headers,
            body: JSON.stringify({ id, action: 'used', trainees: bookTrainees }),
          })).catch(() => {});
        }
        // Optimistic, so the picker's ordering and the `הורץ N פעמים` line match what just
        // happened without a refetch of the whole book.
        setBook(prev => prev.map(e => (usedEntries.includes(e.id)
          ? { ...e, useCount: e.useCount + bookTrainees, lastUsedAt: new Date().toISOString() }
          : e)));
      }
      setPushResults(outcomes);
      // Saved — the board now matches what's stored, so let it re-seed.
      setDirty(false);
    } catch (err: any) {
      setError(err.message || 'השליחה נכשלה');
      if (outcomes.length) setPushResults(outcomes);
    } finally {
      setPushing(false);
    }
  }, [filledDays, slots, selected, weekStart, recipientOf]);

  if (!athletes.length) {
    return (
      <EmptyState
        title="עדיין אין ספורטאי אקדמיה"
        description="הוספת ספורטאים בלשונית הרשימה תאפשר לבנות להם תוכניות אישיות."
      />
    );
  }

  // Narrowed here rather than inline: the panel edits absolute paces, and a book day has
  // none — the JSX below must not be able to hand it one.
  const editing = editingDay !== null ? slots[editingDay] : undefined;
  const editingWorkout = editing?.source === 'written' ? editing.workout : null;

  const whoLabel = selected.length === 0
    ? 'בחירת מתאמנים'
    : selected.length === 1
      ? selected[0].name
      : `${selected.length} מתאמנים`;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Recipients + week */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-ink-400 mb-1.5">אל מי שולחים</label>
          <button
            onClick={() => setWhoOpen(true)}
            className="w-full bg-page border border-page rounded-xl px-3 h-11 flex items-center gap-2 text-sm text-ink-700 hover:border-brand-600"
          >
            <Users className="h-4 w-4 text-ink-400 shrink-0" />
            <span className="truncate">{whoLabel}</span>
            {selected.length === 1 && !selected[0].hasGarmin && (
              <span className="text-xs text-ink-400 shrink-0">(אין גרמין)</span>
            )}
            <span className="ms-auto text-xs text-ink-400 shrink-0">שינוי</span>
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-400 mb-1.5">שבוע</label>
          <div className="flex items-center gap-1 bg-page border border-page rounded-xl h-11 px-1">
            <button onClick={() => setWeekStart(w => shiftWeekStart(w, -1))} aria-label="שבוע קודם" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page">
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
            <span className="text-sm text-ink-700 font-medium px-1 flex items-center gap-1.5 min-w-[150px] justify-center">
              <Calendar className="h-3.5 w-3.5 text-ink-400" /> {fmtWeekLabel(weekStart)}
            </span>
            <button onClick={() => setWeekStart(w => shiftWeekStart(w, 1))} aria-label="שבוע הבא" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page">
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </button>
          </div>
        </div>
      </div>

      {/* Whose week is on the board, once that stops being obvious. */}
      {selected.length > 1 && (
        <p className="text-xs text-ink-400 -mt-2">
          {dirty
            ? `הלוח שנבנה כאן יישלח לכל ${selected.length} הנבחרים — לכל אחד תיווצר תוכנית אישית משלו.`
            : `הלוח נטען מהתוכנית של ${primary?.name} וישלח לכל ${selected.length} הנבחרים.`}
        </p>
      )}

      {/* What the characterization call said, beside the board it was collected for.
          Context and not a warning — it is the reason the week looks the way it does — so it sits
          above the grid, while what is WRONG with the week sits below it with the pace warnings.
          Rendered only when there are answers: an empty version of this card would say "ימי אימון"
          above nothing and read as "this trainee cannot train at all". */}
      {primaryInputs && primary && (
        primaryInputs.availableDays.length > 0
        || primaryInputs.weeklyKm !== null
        || primaryInputs.limitation
        || countdown
      ) && (
        <div className="bg-page/60 border border-page rounded-xl px-4 py-3 space-y-2 -mt-1">
          <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-xs text-ink-500">
            <span className="text-ink-400">משיחת האפיון של {primary.name}:</span>
            {primaryInputs.availableDays.length > 0 && (
              <span className="flex items-center gap-1">
                {DAY_LABELS.map((d, i) => (
                  <span
                    key={i}
                    className={cn(
                      'w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold',
                      primaryInputs.availableDays.includes(i)
                        ? 'bg-brand-600/20 text-brand-600'
                        // ink-400 (4.79:1 on page) and NOT ink-300. The palette labels ink-300
                        // "1.92:1, borders only", and on this card's page-tinted backdrop it
                        // measured 1.44:1 at 10px — the audit called it invisible, correctly.
                        // The offered/not distinction does not need the text to disappear: it is
                        // carried by the filled brand chip, so the dim day can stay readable.
                        : 'text-ink-400',
                    )}
                    // All seven, with the days they did not offer dimmed rather than absent: the
                    // useful comparison is against the whole week, which is what the grid below is.
                    title={primaryInputs.availableDays.includes(i) ? 'יום שהוא פנוי בו' : 'לא הוצע'}
                  >
                    {d}
                  </span>
                ))}
              </span>
            )}
            {primaryInputs.weeklyKm !== null && (
              <span>נפח נוכחי <bdi dir="ltr">{primaryInputs.weeklyKm}</bdi> ק״מ בשבוע</span>
            )}
            {countdown && (
              <span>
                {countdown.weeks === 0
                  ? 'התחרות השבוע'
                  : <>עוד <bdi dir="ltr">{countdown.weeks}</bdi> שבועות לתחרות</>}
              </span>
            )}
          </div>
          {/* Verbatim, never summarised, and the one line here with a colour on it: this is the
              sentence that keeps somebody off intervals for a month, and it was typed during the
              call for exactly this moment. */}
          {primaryInputs.limitation && (
            <p className="text-xs leading-relaxed bg-band-3/10 border border-band-3/30 text-band-3-ink rounded-lg px-3 py-2" dir="auto">
              <span className="font-semibold">מגבלה: </span>{primaryInputs.limitation}
            </p>
          )}
        </div>
      )}

      {/* Day slots */}
      <div className="space-y-2">
        {DAY_LABELS.map((label, day) => {
          const slot = slots[day];
          const clash = clashByDay.get(day);
          return (
            <div key={day} className="flex items-center gap-3 bg-card/50 border border-page/50 rounded-xl p-3">
              <div className="w-10 text-center shrink-0">
                <div className="text-xs font-bold text-ink-500">{label}</div>
              </div>
              {slot ? (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-700 truncate" dir="auto">
                      {slot.source === 'book' ? slot.entry.name : slot.workout.name}
                    </div>
                    {/* A book day shows its STRUCTURE and its effort, and no pace — because it
                        holds none. Resolving one here for the display would mean picking a
                        trainee to price it against while the board is addressed to several,
                        and the first name on the list is not a neutral choice. */}
                    <div className="text-xs text-ink-400 truncate">
                      {slot.source === 'book'
                        ? <><span className="font-semibold text-brand-600">מהספר</span> · {bookSummary(slot.entry)}</>
                        : slot.workout.steps.map(stepSummary).join(' · ')}
                    </div>
                    {/* On the row and not in the warning stack below, because the answer is about
                        THIS day: a list at the bottom saying "ג׳ clashes" makes the coach count
                        rows to find it. Nothing is disabled — the answer is from February and the
                        coach knows things this table does not. */}
                    {clash && (
                      <div className="text-xs text-band-3-ink mt-0.5 truncate">
                        {clash.length === 1 ? `${clash[0]} לא מתאמן/ת ביום זה` : `לא מתאמנים ביום זה: ${clash.join(', ')}`}
                      </div>
                    )}
                  </div>
                  {/* No step editor on a book day: editing it would have to write absolute
                      paces, and there is nobody yet to derive them from. The book's own
                      editor is where an entry changes — for everybody who pushes it. */}
                  {slot.source === 'written' && (
                    <button onClick={() => setEditingDay(day)} aria-label="עריכת האימון" className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page" title="עריכה">
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => clearSlot(day)} aria-label="הסרת האימון" className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-accent-red active:text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10" title="הסרה">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  {/* A day the trainee offered and the week left empty. Said quietly, in the row's
                      own words, because an unused day is a choice at least as often as an
                      oversight — a three-day plan for somebody who offered five is normal. */}
                  <span className="text-xs flex-1 min-w-0 truncate">
                    {fit.unusedDays.includes(day)
                      ? <span className="text-ink-500">מנוחה — <span className="text-brand-600">הוא פנוי ביום זה</span></span>
                      : <span className="text-ink-400">מנוחה / אין אימון</span>}
                  </span>
                  <button
                    onClick={() => { setSlot(day, emptyWorkout(day)); setEditingDay(day); }}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-brand-600/20 text-brand-600 hover:bg-brand-600/30 text-xs font-semibold shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" /> בנייה
                  </button>
                  {/* One control for all three existing sources rather than a fourth button
                      on the row: at 375px the three that were here already filled it, and
                      the sheet is also the only place the coach can see that the book and
                      the old library are two different lists. */}
                  <button
                    onClick={() => setSourceDay(day)}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-page text-ink-500 hover:bg-ink-300/40 text-xs font-semibold shrink-0"
                  >
                    <BookOpen className="h-3.5 w-3.5" /> בחירה
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Two pace warnings, worst first, and they have to be told apart at a glance.
          `band-3/10` and `accent-red/10` on this background were the same pink card in the
          screenshot — so the blocking one carries a full-strength border and a bold lead,
          and the band warning keeps the softer fill it always had. The difference is real:
          a missing band still sends the coach's paces, a missing test sends nothing. */}
      {untested.length > 0 && (
        <div className="flex items-start gap-2 bg-accent-red/10 border-[1.5px] border-accent-red text-accent-red-ink rounded-xl px-4 py-3 text-xs leading-relaxed">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-bold">
              {untested.length === selected.length
                ? 'לאף אחד מהנבחרים אין טסט סף'
                : `אין טסט סף ל־${untested.map(g => g.athlete.name).join(', ')}`}
            </span>
            {' — '}
            {wouldGetNothing.length > 0
              ? 'האימונים מהספר נגזרים מהטסט, ולכן לא יישלח כלום. רישום טסט בלשונית הטסטים יפתור זאת.'
              : 'הימים שנבחרו מהספר יידלגו, ושאר הימים יישלחו כרגיל.'}
          </span>
        </div>
      )}
      {/* What will happen to the paces, before it happens. */}
      {unresolved.length > 0 && (
        <div className="flex items-start gap-2 bg-band-3/10 border border-band-3/30 text-band-3-ink rounded-xl px-4 py-3 text-xs leading-relaxed">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {unresolved.length === selected.length
              ? 'אין קצבים מוגדרים לאף אחד מהנבחרים'
              : `אין קצבים מוגדרים ל־${unresolved.map(a => a.name).join(', ')}`}
            {' — '}
            האימונים יישלחו בקצבים כפי שנכתבו, בלי התראות קצב בשעון. הגדרת ההיסטים של הדבוקות בלשונית הסקירה תפתור זאת.
          </span>
        </div>
      )}
      {/* The week against what they said they run today. Softer than the pace warnings on
          purpose: those describe what the push will DO, this describes a judgement the coach is
          entitled to make and may already have made deliberately. */}
      {fit.jumps.length > 0 && (
        <div className="flex items-start gap-2 bg-band-3/10 border border-band-3/30 text-band-3-ink rounded-xl px-4 py-3 text-xs leading-relaxed">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {fit.jumps.map(j => (
              <span key={j.athleteId} className="block">
                <span className="font-semibold">{j.name}</span>
                {' — '}
                השבוע הזה הוא <bdi dir="ltr">{j.partial ? `לפחות ${j.plannedKm}` : j.plannedKm}</bdi> ק״מ,
                {' '}<bdi dir="ltr">{Math.round(j.jump * 100)}%</bdi> יותר מ<bdi dir="ltr">{j.currentKm}</bdi> ק״מ שאמר שהוא רץ היום.
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Who the three notes above are silent about, and why. Only once there is something to be
          silent beside — a club that was never characterised would otherwise carry this line on
          every week forever. */}
      {fit.anything && fit.uncharacterised.length > 0 && (
        <p className="text-xs text-ink-400 leading-relaxed px-1">
          {fit.uncharacterised.length === selected.length
            ? 'אין שיחת אפיון מוקלטת לאף אחד מהנבחרים, ולכן אין כאן בדיקה מול ימי האימון והנפח שלהם.'
            : `אין שיחת אפיון מוקלטת ל־${fit.uncharacterised.join(', ')} — ההערות למעלה לא אומרות עליהם דבר.`}
        </p>
      )}

      {noGarmin.length > 0 && (
        <div className="flex items-start gap-2 bg-page border border-page text-ink-500 rounded-xl px-4 py-3 text-xs leading-relaxed">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            ל־{noGarmin.map(a => a.name).join(', ')} אין גרמין מחובר — התוכנית תישמר באפליקציה, אך לא תישלח לשעון.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-accent-red/10 border border-accent-red/30 text-accent-red-ink rounded-xl px-4 py-3 text-sm">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {pushResults && (
        <div className="space-y-1.5">
          {pushResults.map(r => (
            <div
              key={r.id}
              className={cn(
                'flex items-start gap-2 rounded-xl px-4 py-2.5 text-xs border leading-relaxed',
                r.ok ? 'bg-accent-600/10 border-accent-600/30 text-accent-900' : 'bg-accent-red/10 border-accent-red/30 text-accent-red-ink',
              )}
            >
              {r.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" /> : <XCircle className="h-4 w-4 shrink-0 mt-px" />}
              <span><span className="font-semibold">{r.name}</span> — {r.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Push */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-400">
          {filledDays.length === 1 ? 'אימון אחד' : `${filledDays.length} אימונים`} · {selected.length === 1 ? 'מתאמן/ת אחד' : `${selected.length} מתאמנים`}
        </span>
        <Button
          variant="secondary"
          onClick={push}
          disabled={pushing || filledDays.length === 0 || selected.length === 0}
          // Sending is the one green action on this screen. `secondary` supplies
          // the pill and the border, so the fill has to bring its own foreground —
          // without it the label inherits the outline variant's blue and lands
          // blue-on-green.
          className="bg-accent-700 border-accent-700 text-white hover:opacity-90"
        >
          {pushing ? <Spinner size={16} /> : <Send className="h-4 w-4" />}
          {pushing
            ? 'שולח…'
            : selected.length === 1
              ? `שליחה אל ${selected[0].name.split(' ')[0]}`
              : `שליחה ל־${selected.length}`}
        </Button>
      </div>

      {/* Structured builder — reuses the same editor as the group planner. On save,
          also store the workout in the library for reuse. */}
      {editingDay !== null && editingWorkout && (
        <WorkoutEditorPanel
          workout={editingWorkout}
          dayName={DAY_FULL[editingDay]}
          onChange={(w) => { setSlot(editingDay, w); saveToLibrary(w); }}
          onClose={() => setEditingDay(null)}
        />
      )}

      {/* Recipients */}
      {whoOpen && (
        <TraineePicker
          athletes={athletes}
          selectedIds={selectedIds}
          onToggle={toggleSelected}
          onSetAll={(ids) => { setSelectedIds(ids); setPushResults(null); }}
          onClose={() => setWhoOpen(false)}
        />
      )}

      {/* Import from the club's group plan for this week */}
      {importDay !== null && groupPlan && (
        <GroupPlanPicker
          day={importDay}
          plan={groupPlan}
          band={primary?.band ?? null}
          onPick={(w, day) => { setSlot(day, w); setImportDay(null); }}
          onPickWeek={(ws) => {
            setSlots(() => {
              const next: Record<number, PlanSlot> = {};
              for (const w of ws) if (typeof w?.dayOfWeek === 'number') next[w.dayOfWeek] = { source: 'written', workout: w };
              return next;
            });
            setDirty(true);
            setPushResults(null);
            setImportDay(null);
          }}
          onClose={() => setImportDay(null)}
        />
      )}

      {/* Where a day's workout comes from */}
      {sourceDay !== null && (
        <SourcePicker
          day={sourceDay}
          book={book.length}
          library={library.length}
          groupPlan={!!groupPlan}
          onPick={(source) => {
            const day = sourceDay;
            setSourceDay(null);
            if (source === 'book') setBookDay(day);
            else if (source === 'library') setPickerDay(day);
            else setImportDay(day);
          }}
          onClose={() => setSourceDay(null)}
        />
      )}

      {/* The book */}
      {bookDay !== null && (
        <BookPicker
          day={bookDay}
          entries={book}
          onPick={(entry) => { setBookSlot(bookDay, entry); setBookDay(null); }}
          onClose={() => setBookDay(null)}
        />
      )}

      {/* Library picker */}
      {pickerDay !== null && (
        <LibraryPicker
          day={pickerDay}
          library={library}
          onPick={(w) => { setSlot(pickerDay, w); setPickerDay(null); }}
          onDelete={deleteLibraryWorkout}
          onClose={() => setPickerDay(null)}
        />
      )}
    </div>
  );
}

/**
 * Who this week's board goes to.
 *
 * A sheet rather than an inline list: the board is the screen, and a checkbox row
 * per trainee would push it off the fold. Each row states the two things that
 * change what the trainee receives — their band's pace offset, and whether there
 * is a watch to push to.
 */
function TraineePicker({
  athletes, selectedIds, onToggle, onSetAll, onClose,
}: {
  athletes: AcademyAthlete[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = query ? athletes.filter(a => a.name.toLowerCase().includes(query)) : athletes;
  const allSelected = athletes.length > 0 && selectedIds.length === athletes.length;

  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={(
        <span className="flex items-center justify-center gap-2">
          <Users className="h-4 w-4 text-brand-600" /> אל מי שולחים · {selectedIds.length} נבחרו
        </span>
      )}
      bodyClassName="px-2"
    >
      <div dir="rtl" className="space-y-2">
        {athletes.length > 8 && (
          <div className="flex items-center gap-2 bg-page border border-page rounded-xl px-3 h-11 mx-1">
            <Search className="h-4 w-4 text-ink-400 shrink-0" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="חיפוש מתאמן/ת"
              className="flex-1 bg-transparent text-sm text-ink-700 placeholder:text-ink-400 focus:outline-none"
            />
          </div>
        )}

        <button
          onClick={() => onSetAll(allSelected ? [] : athletes.map(a => a.id))}
          className="mx-1 text-xs font-semibold text-brand-600 min-h-[44px] px-2"
        >
          {allSelected ? 'ניקוי הבחירה' : 'בחירת כולם'}
        </button>

        {shown.map(a => {
          const on = selectedIds.includes(a.id);
          const off = offsetLabel(a);
          return (
            <button
              key={a.id}
              onClick={() => onToggle(a.id)}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-page hover:bg-page/50 text-start"
            >
              <span className={cn(
                'w-5 h-5 rounded-md border-[1.5px] flex items-center justify-center shrink-0',
                on ? 'bg-brand-600 border-brand-600 text-white' : 'border-ink-300',
              )}>
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-ink-700 truncate" dir="auto">{a.name}</span>
                <span className="block text-xs text-ink-400 truncate">
                  {a.band ? a.band.name : 'ללא דבוקה'}{a.hasGarmin ? '' : ' · אין גרמין'}
                </span>
              </span>
              <span className={cn(
                'text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0',
                off ? 'bg-brand-600/12 text-brand-600' : 'bg-band-3/12 text-band-3-ink',
              )}>
                {off || 'אין קצב'}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/**
 * Seed a slot (or the whole week) from the club's group plan.
 *
 * The lane selector is the honest part. A club week carries up to three pace
 * lanes and the academy has six bands, so something has to choose; the trainee's
 * band picks a default, the chosen lane is stated, and the coach can change it.
 * When the week's lanes are identical — the common case, one pace for everybody —
 * there is nothing to choose and the selector is hidden rather than shown as
 * three identical options.
 */
function GroupPlanPicker({
  day, plan, band, onPick, onPickWeek, onClose,
}: {
  day: number;
  plan: any;
  band: AcademyBand | null;
  onPick: (w: ParsedWorkout, day: number) => void;
  onPickWeek: (ws: ParsedWorkout[]) => void;
  onClose: () => void;
}) {
  const differs = useMemo(() => lanesDiffer(plan?.parsed_workouts), [plan]);
  const suggested = laneForBand(band?.bandNumber);
  const [lane, setLane] = useState<Lane | null>(differs ? suggested : 1);

  const workouts = useMemo(
    () => (lane ? laneWorkouts(plan?.parsed_workouts, lane) : []),
    [plan, lane],
  );
  // The day the coach opened the sheet on comes first — that's the slot being
  // filled — with the rest of the week behind it for a different day's session.
  const ordered = useMemo(
    () => [...workouts].sort((a, b) => (a.dayOfWeek === day ? -1 : b.dayOfWeek === day ? 1 : a.dayOfWeek - b.dayOfWeek)),
    [workouts, day],
  );

  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={(
        <span className="flex items-center justify-center gap-2">
          <ArrowDownToLine className="h-4 w-4 text-brand-600" /> ייבוא מתוכנית הקבוצה · {DAY_FULL[day]}
        </span>
      )}
      bodyClassName="px-2"
    >
      <div dir="rtl" className="space-y-3">
        {differs && (
          <div className="mx-1 space-y-2">
            <p className="text-xs text-ink-500">באיזה קצב לייבא?</p>
            <div className="flex gap-2">
              {([1, 2, 3] as Lane[]).map(l => (
                <button
                  key={l}
                  onClick={() => setLane(l)}
                  className={cn(
                    'flex-1 min-h-[44px] rounded-xl text-xs font-bold border',
                    lane === l ? 'bg-brand-600 border-brand-600 text-white' : 'bg-page border-page text-ink-500',
                  )}
                >
                  {LANE_MARKS[l]} קבוצה {l}
                </button>
              ))}
            </div>
            {lane === null ? (
              <p className="flex items-start gap-2 text-xs text-band-3-ink leading-relaxed">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                אין דבוקה למתאמן/ת, ולכן אין ברירת מחדל — צריך לבחור קצב.
              </p>
            ) : lane === suggested ? (
              <p className="text-xs text-accent-600 leading-relaxed">
                נבחר אוטומטית לפי {band?.name}.
              </p>
            ) : null}
          </div>
        )}

        {lane === null ? null : ordered.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-8">
            אין אימונים בתוכנית הקבוצה לשבוע הזה.
          </p>
        ) : (
          <>
            {ordered.map((w, i) => (
              <button
                key={`${w.dayOfWeek}-${i}`}
                onClick={() => onPick(w, day)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-page hover:bg-page/50 text-start"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink-700 truncate" dir="auto">{w.name}</span>
                  <span className="block text-xs text-ink-400 truncate">
                    {DAY_LABELS[w.dayOfWeek]} · {(w.steps || []).map(stepSummary).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
            <div className="pt-1 px-1">
              <Button onClick={() => onPickWeek(workouts)} className="w-full justify-center">
                <ArrowDownToLine className="h-4 w-4" /> ייבוא השבוע כולו
              </Button>
              <p className="text-[11px] text-ink-400 mt-2 leading-relaxed">
                מחליף את כל הימים בלוח. האימונים מועתקים — עריכה כאן לא משנה את תוכנית הקבוצה.
              </p>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function LibraryPicker({
  day, library, onPick, onDelete, onClose,
}: {
  day: number;
  library: LibraryWorkout[];
  onPick: (w: ParsedWorkout) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={(
        <span className="flex items-center justify-center gap-2">
          <BookOpen className="h-4 w-4 text-brand-600" /> ספריית אימונים · {DAY_FULL[day]}
        </span>
      )}
      bodyClassName="px-2"
    >
      <div dir="rtl">
        {library.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-8">
            הספרייה ריקה. בניית אימון תשמור אותו כאן לשימוש חוזר.
          </p>
        ) : (
          library.map(item => (
            <div key={item.id} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-page/50 transition-colors">
              <button onClick={() => onPick(item.workout)} className="flex-1 min-w-0 text-start min-h-[44px]">
                <div className="font-medium text-ink-700 text-sm truncate" dir="auto">{item.name}</div>
                <div className="text-xs text-ink-400 truncate">
                  {(item.workout.steps || []).map(stepSummary).join(' · ')}
                </div>
              </button>
              <button onClick={() => onDelete(item.id)} className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-accent-red active:text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10 shrink-0" title="הסרה מהספרייה" aria-label="הסרה מהספרייה">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}

/**
 * Which of the three sources a day comes from.
 *
 * A chooser and not three buttons on the row, for the reason the row comment gives — but it
 * also puts a real question in front of the coach in words: the academy currently has TWO
 * lists of saved workouts. `ספר האימונים` (migration 109) stores shares of a threshold and
 * prices them per trainee; `ספרייה` (migration 020) stores one coach's absolute paces and was
 * filled automatically by every workout ever built on this board. They overlap, and which one
 * survives is Ofer's call rather than something to settle by deleting a button. Until then the
 * sheet states what each one is, which is the least this screen can do about it.
 */
function SourcePicker({
  day, book, library, groupPlan, onPick, onClose,
}: {
  day: number;
  book: number;
  library: number;
  groupPlan: boolean;
  onPick: (source: 'book' | 'library' | 'group') => void;
  onClose: () => void;
}) {
  const sources: {
    key: 'book' | 'library' | 'group';
    icon: React.ReactNode;
    title: string;
    note: string;
    count: number | null;
    disabled: boolean;
  }[] = [
    {
      key: 'book', icon: <BookOpen className="h-4 w-4 text-brand-600" />,
      title: 'ספר האימונים',
      note: 'הקצבים נגזרים מטסט הסף של כל מתאמן/ת בנפרד',
      count: book, disabled: book === 0,
    },
    {
      key: 'group', icon: <ArrowDownToLine className="h-4 w-4 text-brand-600" />,
      title: 'תוכנית הקבוצה',
      note: groupPlan ? 'האימון שהמועדון עושה בשבוע הזה' : 'אין תוכנית קבוצה לשבוע הזה',
      count: null, disabled: !groupPlan,
    },
    {
      key: 'library', icon: <Archive className="h-4 w-4 text-ink-400" />,
      title: 'ספרייה',
      note: 'אימונים שנבנו כאן, עם הקצבים שנכתבו בהם',
      count: library, disabled: library === 0,
    },
  ];

  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={<span className="flex items-center justify-center gap-2">בחירת אימון · {DAY_FULL[day]}</span>}
      bodyClassName="px-2"
    >
      <div dir="rtl" className="space-y-2">
        {sources.map(s => (
          <button
            key={s.key}
            onClick={() => onPick(s.key)}
            disabled={s.disabled}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-page text-start hover:bg-page/50 disabled:opacity-40"
          >
            <span className="shrink-0">{s.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-ink-700 truncate">{s.title}</span>
              <span className="block text-xs text-ink-400">{s.note}</span>
            </span>
            {s.count !== null && (
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0 bg-page text-ink-500 tabular-nums">
                {s.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Pick an entry out of the book.
 *
 * The canon first and the coach's own shelf after it, which is the book's own order and the
 * order that matters here: the academy's session is the default, and a private draft is the
 * exception a coach reaches for deliberately. Nothing in this sheet shows a pace — see
 * `bookSummary`, and the note at the bottom, which is on screen because a coach looking for
 * the pace and not finding one would otherwise read it as broken.
 */
function BookPicker({
  day, entries, onPick, onClose,
}: {
  day: number;
  entries: LibraryEntry[];
  onPick: (entry: LibraryEntry) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const matched = filterLibrary(entries, { query: q });
    return [...matched].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'academy' ? -1 : 1;
      return b.useCount - a.useCount;
    });
  }, [entries, q]);

  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={(
        <span className="flex items-center justify-center gap-2">
          <BookOpen className="h-4 w-4 text-brand-600" /> ספר האימונים · {DAY_FULL[day]}
        </span>
      )}
      bodyClassName="px-2"
    >
      <div dir="rtl" className="space-y-2">
        {entries.length > 8 && (
          <div className="flex items-center gap-2 bg-page border border-page rounded-xl px-3 h-11 mx-1">
            <Search className="h-4 w-4 text-ink-400 shrink-0" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="חיפוש אימון"
              className="flex-1 bg-transparent text-[16px] text-ink-700 placeholder:text-ink-400 focus:outline-none"
            />
          </div>
        )}

        {shown.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-8">
            {entries.length === 0 ? 'הספר ריק עדיין.' : 'אין אימון בשם הזה.'}
          </p>
        ) : shown.map(entry => (
          <button
            key={entry.id}
            onClick={() => onPick(entry)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-page text-start hover:bg-page/50"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-ink-700 truncate" dir="auto">{entry.name}</span>
              {/* No kind label: it printed `אינטרוולים · 6×1000 · 9.5 ק"מ · אינטרוולים`,
                  which is the same word twice on a line 200px wide. The shape and the effort
                  are what tell two interval sessions apart; the kind tells them apart from
                  nothing. */}
              <span className="block text-xs text-ink-400 truncate">{bookSummary(entry)}</span>
            </span>
            {/* Which shelf, because pushing the academy's session and pushing your own draft
                are different acts — and the canon is what the trainee's coach would expect
                to see in their week. */}
            <span className={cn(
              'text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0',
              entry.scope === 'academy' ? 'bg-brand-600/12 text-brand-600' : 'bg-page text-ink-500',
            )}>
              {entry.scope === 'academy' ? 'האקדמיה' : 'שלי'}
            </span>
          </button>
        ))}

        <p className="text-[11px] text-ink-400 leading-relaxed px-1 pt-1">
          אימון מהספר לא מחזיק קצבים — הוא מחזיק אחוזים מהסף. הקצב נגזר בשליחה, לכל מתאמן/ת
          מהטסט שלו/שלה, ולכן אותו אימון יוצא במספרים שונים לכל אחד.
        </p>
      </div>
    </Sheet>
  );
}
