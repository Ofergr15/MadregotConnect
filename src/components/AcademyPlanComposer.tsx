'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send, CheckCircle2, XCircle, Calendar, ChevronLeft, ChevronRight,
  Plus, Pencil, Trash2, BookOpen, Users, Check, AlertTriangle, ArrowDownToLine, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { COACH_ID } from '@/lib/constants';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { formatPace } from '@/lib/garmin/pace';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutEditorPanel } from '@/components/WorkoutEditor';
import { Spinner, EmptyState, Sheet, Button } from '@/components/ui';
import { canResolvePaces, effectiveOffsetSec, fmtOffsetSec, type AcademyBand } from '@/lib/academy/bands';
import { repaceWeek } from '@/lib/academy/repace';
import { laneForBand, laneWorkouts, lanesDiffer, LANE_MARKS, type Lane } from '@/lib/academy/group-lane';

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

function sundayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().split('T')[0];
}
function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().split('T')[0];
}
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
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  // Day-of-week (0=Sun..6=Sat) → the workout planned for that day.
  const [slots, setSlots] = useState<Record<number, ParsedWorkout>>({});
  // Whether the board holds edits that were never saved. Guards the seed-load
  // below: switching recipient mid-build must not silently discard the workout
  // the coach just wrote.
  const [dirty, setDirty] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [library, setLibrary] = useState<LibraryWorkout[]>([]);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
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
        const next: Record<number, ParsedWorkout> = {};
        for (const w of workouts) if (typeof w?.dayOfWeek === 'number') next[w.dayOfWeek] = w;
        setSlots(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [primary, weekStart, dirty]);

  const filledDays = Object.keys(slots).map(Number).sort((a, b) => a - b);

  const setSlot = (day: number, workout: ParsedWorkout) => {
    setSlots(prev => ({ ...prev, [day]: { ...workout, dayOfWeek: day } }));
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
  const unresolved = selected.filter(a => !canResolvePaces(a.paceOffsetSec, a.band));
  const noGarmin = selected.filter(a => !a.hasGarmin);

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
    const base = filledDays.map(d => slots[d]);
    const outcomes: PushOutcome[] = [];

    try {
      for (const athlete of selected) {
        const offset = effectiveOffsetSec(athlete.paceOffsetSec, athlete.band);
        const workouts = repaceWeek(base, offset);

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

        if (!athlete.hasGarmin) {
          // Worth saving anyway: adherence works off the plan row, and a trainee
          // on Strava has a plan to follow even with no watch to push to.
          outcomes.push({
            id: athlete.id, name: athlete.name, ok: !!planId,
            msg: planId ? 'התוכנית נשמרה · אין גרמין מחובר, לא נשלח לשעון' : 'שמירת התוכנית נכשלה',
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
            // setting.
            paceAlerts: offset !== null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const results = data.results || [];
        const ok = res.ok && results.length > 0 && results.every((r: any) => r.status === 'success');
        const failed = results.find((r: any) => r.status === 'failed');
        const count = workouts.length === 1 ? 'אימון אחד' : `${workouts.length} אימונים`;
        outcomes.push({
          id: athlete.id,
          name: athlete.name,
          ok,
          msg: ok
            ? `נשלחו ${count}${offset ? ` · הקצבים הוזזו ב־${fmtOffsetSec(offset)} ש׳/ק״מ` : ''}`
            : (failed?.error || data.message || data.error || 'השליחה נכשלה'),
        });

        if (planId) {
          bearerHeaders().then((headers) => fetch('/api/plans', {
            method: 'PUT', headers,
            body: JSON.stringify({ plan_id: planId, status: ok ? 'pushed' : 'partial' }),
          })).catch(() => {});
        }
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
  }, [filledDays, slots, selected, weekStart]);

  if (!athletes.length) {
    return (
      <EmptyState
        title="עדיין אין ספורטאי אקדמיה"
        description="הוספת ספורטאים בלשונית הרשימה תאפשר לבנות להם תוכניות אישיות."
      />
    );
  }

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
            <button onClick={() => setWeekStart(w => shiftWeek(w, -1))} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page">
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-sm text-ink-700 font-medium px-1 flex items-center gap-1.5 min-w-[150px] justify-center">
              <Calendar className="h-3.5 w-3.5 text-ink-400" /> {fmtWeekLabel(weekStart)}
            </span>
            <button onClick={() => setWeekStart(w => shiftWeek(w, 1))} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page">
              <ChevronLeft className="h-4 w-4" />
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

      {/* Day slots */}
      <div className="space-y-2">
        {DAY_LABELS.map((label, day) => {
          const w = slots[day];
          return (
            <div key={day} className="flex items-center gap-3 bg-card/50 border border-page/50 rounded-xl p-3">
              <div className="w-10 text-center shrink-0">
                <div className="text-xs font-bold text-ink-500">{label}</div>
              </div>
              {w ? (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-700 truncate" dir="auto">{w.name}</div>
                    <div className="text-xs text-ink-400 truncate">
                      {w.steps.map(stepSummary).join(' · ')}
                    </div>
                  </div>
                  <button onClick={() => setEditingDay(day)} className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page" title="עריכה">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => clearSlot(day)} className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-accent-red hover:bg-accent-red/10" title="הסרה">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-xs text-ink-400 flex-1 min-w-0 truncate">מנוחה / אין אימון</span>
                  <button
                    onClick={() => { setSlot(day, emptyWorkout(day)); setEditingDay(day); }}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-brand-600/20 text-brand-600 hover:bg-brand-600/30 text-xs font-semibold shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" /> בנייה
                  </button>
                  <button
                    onClick={() => setImportDay(day)}
                    disabled={!groupPlan}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-page text-ink-500 hover:bg-ink-300/40 text-xs font-semibold disabled:opacity-40 shrink-0"
                    title={groupPlan ? 'ייבוא מתוכנית הקבוצה' : 'אין תוכנית קבוצה לשבוע הזה'}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" /> מהקבוצה
                  </button>
                  <button
                    onClick={() => setPickerDay(day)}
                    disabled={library.length === 0}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-page text-ink-500 hover:bg-ink-300/40 text-xs font-semibold disabled:opacity-40 shrink-0"
                    title={library.length ? 'בחירה מהספרייה' : 'הספרייה ריקה'}
                  >
                    <BookOpen className="h-3.5 w-3.5" /> ספרייה
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
          {filledDays.length} אימונים · {selected.length} מתאמנים
        </span>
        <Button
          variant="secondary"
          onClick={push}
          disabled={pushing || filledDays.length === 0 || selected.length === 0}
          // Sending is the one green action on this screen. `secondary` supplies
          // the pill and the border, so the fill has to bring its own foreground —
          // without it the label inherits the outline variant's blue and lands
          // blue-on-green.
          className="bg-accent-600 border-accent-600 text-white hover:opacity-90"
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
      {editingDay !== null && slots[editingDay] && (
        <WorkoutEditorPanel
          workout={slots[editingDay]}
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
              const next: Record<number, ParsedWorkout> = {};
              for (const w of ws) if (typeof w?.dayOfWeek === 'number') next[w.dayOfWeek] = w;
              return next;
            });
            setDirty(true);
            setPushResults(null);
            setImportDay(null);
          }}
          onClose={() => setImportDay(null)}
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
              <p className="flex items-start gap-2 text-xs text-band-3 leading-relaxed">
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
              <button onClick={() => onDelete(item.id)} className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-accent-red hover:bg-accent-red/10 shrink-0" title="הסרה מהספרייה" aria-label="הסרה מהספרייה">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
