'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, MessageSquarePlus, Send, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';
import { apiHeaders } from '@/lib/api';
import { Spinner } from '@/components/ui';
import {
  ACTION_LABELS,
  EFFORT_LABELS,
  EXECUTION_LABELS,
  NOTE_MAX,
  LAP_COMMENT_MAX,
  emptyFeedback,
  renderFeedbackHebrew,
  suggestExecutionTags,
  validateFeedback,
  type ActionTag,
  type EffortTag,
  type ExecutionTag,
  type WorkoutFeedback,
} from '@/lib/academy/feedback';
import type { SegmentReport, SegmentVerdict } from '@/lib/academy/segments';

// ── The mentor's weekly review, as one screen ───────────────────────────────
//
// The pain this replaces, in the coach's own description: open the plan, open the
// execution, open the screens, then type free text into WhatsApp. So everything the
// mentor needs is on one screen and the writing is reduced to choosing — the lap
// table is commentable in place, the chips carry the club's vocabulary, and the
// Hebrew the trainee will read is shown before it is sent.
//
// Two rules the screen enforces rather than asks about:
//  · a step is compared on the metric the PLAN was written in. An HR session shows an
//    HR target column and an HR verdict; the pace is still printed, because a mentor
//    wants to see it, but it is not what makes the step right or wrong.
//  · a lap is named by its repeat number, never by the watch's lap index — the warmup
//    and the recoveries take laps of their own, so "lap 8" and "rep 4" are different
//    things and only one of them is what the mentor and the trainee mean.

// The INK variants, not the fill colours: `text-accent-600` on a light row measures
// 3.30:1 and `text-band-3` 3.23:1, both under AA — which the palette already knew,
// which is why `accent-900` and `band-3-ink` exist. This column is the one a mentor
// scans, so it is the last place to spend contrast on hue fidelity.
const STATUS_STYLE: Record<string, string> = {
  on_target: 'text-accent-900',
  faster: 'text-accent-red',
  slower: 'text-band-3-ink',
  unknown: 'text-ink-400',
};

const STATUS_LABEL: Record<string, string> = {
  on_target: 'בטווח',
  faster: 'מהיר יותר',
  slower: 'לאט יותר',
  unknown: '—',
};

/** For HR the same statuses mean effort, not clock — so they get their own words. */
const HR_STATUS_LABEL: Record<string, string> = {
  on_target: 'בטווח',
  faster: 'דופק גבוה',
  slower: 'דופק נמוך',
  unknown: '—',
};

export interface SavedFeedback {
  id: string;
  execution: ExecutionTag[];
  effort: EffortTag | null;
  action: ActionTag | null;
  lapComments: { index: number; text: string }[];
  note: string;
  rendered: string;
  sentAt: string | null;
}

interface Props {
  athleteId: string;
  date: string;
  activityId?: string | null;
  workoutName: string;
  report: SegmentReport;
  mentorName?: string;
}

export function WorkoutFeedbackPanel({ athleteId, date, activityId, workoutName, report, mentorName }: Props) {
  const [fb, setFb] = useState<WorkoutFeedback>(emptyFeedback());
  const [openLap, setOpenLap] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // What the data already says, pre-selected. This is the minute the screen saves:
  // the mentor confirms or corrects "opened too fast and faded" instead of reading
  // twelve laps and composing a sentence. Never the ACTION though — a form that
  // pre-picks the decision gets rubber-stamped.
  const suggested = useMemo(() => suggestExecutionTags(report), [report]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/academy/feedback?athleteId=${encodeURIComponent(athleteId)}&date=${date}`,
          { headers: await apiHeaders() }
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.feedback) {
          const f = data.feedback as SavedFeedback;
          setSaved(f);
          setFb({
            execution: f.execution ?? [],
            effort: f.effort ?? null,
            action: f.action ?? null,
            lapComments: f.lapComments ?? [],
            note: f.note ?? '',
          });
        } else {
          setFb(prev => ({ ...prev, execution: suggested }));
        }
      } catch {
        if (!cancelled) setFb(prev => ({ ...prev, execution: suggested }));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // suggested is derived from `report`, which is stable for a given workout.
  }, [athleteId, date, suggested]);

  const rows = report.segments;
  const metric: 'pace' | 'hr' | 'mixed' | 'none' = dominantMetric(rows);
  const problems = validateFeedback(fb);
  const preview = renderFeedbackHebrew(fb, { workoutName, mentorName, segments: rows });

  const commentFor = (index: number) => fb.lapComments.find(c => c.index === index)?.text ?? '';

  const setComment = (index: number, text: string) => {
    setFb(prev => {
      const rest = prev.lapComments.filter(c => c.index !== index);
      return { ...prev, lapComments: text.trim() ? [...rest, { index, text }].sort((a, b) => a.index - b.index) : rest };
    });
  };

  const toggleExecution = (tag: ExecutionTag) => {
    setFb(prev => ({
      ...prev,
      execution: prev.execution.includes(tag)
        ? prev.execution.filter(t => t !== tag)
        // "בוצע לפי התוכנית" is exclusive by meaning, so picking it clears the rest
        // instead of failing validation after the fact.
        : tag === 'on_plan' ? ['on_plan'] : [...prev.execution.filter(t => t !== 'on_plan'), tag],
    }));
  };

  const save = async () => {
    if (problems.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({
          athleteId, date, activityId, workoutName, mentorName, metric,
          execution: fb.execution, effort: fb.effort, action: fb.action,
          lapComments: fb.lapComments, note: fb.note,
          segments: rows,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'שמירת הפידבק נכשלה'); return; }
      setSaved(data.feedback);
    } catch {
      setError('שמירת הפידבק נכשלה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-3">
      {/* ── plan vs execution, commentable in place ── */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 px-2.5 text-3xs font-semibold text-ink-400">
          <span className="flex-1">מקטע</span>
          <span className="w-[68px] text-center">{metric === 'hr' ? 'דופק יעד' : 'יעד'}</span>
          <span className="w-[42px] text-center">בפועל</span>
          <span className="w-[46px] text-end">פער</span>
          <span className="w-9" />
        </div>
        {rows.map(s => {
          const isHr = s.metric === 'hr';
          const gradable = s.graded || isHr;
          const comment = commentFor(s.index);
          return (
            <div key={s.index}>
              <div className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs',
                gradable ? 'bg-page/50' : 'bg-page/20')}>
                <span className="text-ink-400 flex-1 min-w-0 truncate" dir="auto">{s.label}</span>
                <span className="w-[68px] text-center text-ink-400 tabular-nums" dir="ltr">
                  {isHr ? hrBandLabel(s) : paceBandLabel(s.plannedPaceMin, s.plannedPaceMax)}
                </span>
                <span className="w-[42px] text-center text-ink-500 tabular-nums" dir="ltr">
                  {isHr
                    ? (s.actualHr != null ? `${s.actualHr}` : '—')
                    : (s.actualPace != null ? formatPace(s.actualPace) : '—')}
                </span>
                {/* The magnitude, not just the direction. A mentor deciding whether to
                    soften next week needs "12 seconds" rather than "faster" — and it is
                    also what the weekly queue will sort trainees by, so the number the
                    mentor reads here and the number that ordered the queue are one thing.
                    Each metric keeps its own natural sign: pace negative = ran faster,
                    HR positive = beat higher. */}
                <span className={cn('w-[46px] text-end font-semibold tabular-nums', STATUS_STYLE[s.status])} dir="ltr">
                  {gradable ? gapLabel(s) : '—'}
                </span>
                {/* A comment on ONE step. The thing no tool they use today has. */}
                <button
                  type="button"
                  onClick={() => setOpenLap(openLap === s.index ? null : s.index)}
                  aria-label={`הערה על ${s.label}`}
                  // 36px box + a 4px pseudo-element halo = a 44px target, which is what iOS
                  // wants for the row's primary action. A bigger halo on a smaller box was
                  // the first attempt and it measured WORSE: the halos of adjacent rows
                  // overlapped, so a tap near a row edge opened the neighbour's comment.
                  className={cn('relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    'after:absolute after:-inset-1 after:content-[""]',
                    comment ? 'bg-brand-600/15 text-brand-600' : 'text-ink-400 hover:bg-page')}
                >
                  {comment ? <MessageSquare className="h-3.5 w-3.5" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
                </button>
              </div>
              {openLap === s.index && (
                <div className="px-2.5 pb-1.5 pt-1">
                  <input
                    autoFocus
                    value={comment}
                    onChange={e => setComment(s.index, e.target.value.slice(0, LAP_COMMENT_MAX))}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setOpenLap(null); }}
                    placeholder="הערה על המקטע הזה"
                    aria-label={`הערה על ${s.label}`}
                    dir="auto"
                    // 16px, not the table's 12px: Safari on iOS ZOOMS the whole page when a
                    // field under 16px takes focus, so a mentor typing a lap comment gets the
                    // layout yanked sideways mid-sentence. Applies to the note field too.
                    // min-h and not just padding: at 16px text the field measured 38px
                    // tall, which is under the touch floor for the one control the mentor
                    // has to re-tap to correct a typo.
                    className="w-full min-h-[44px] rounded-lg bg-page px-2.5 py-2 text-base text-ink-900 placeholder:text-ink-400"
                  />
                </div>
              )}
              {comment && openLap !== s.index && (
                <p className="px-2.5 pb-1 text-[11px] text-ink-500" dir="auto">{comment}</p>
              )}
            </div>
          );
        })}
        {metric === 'hr' && (
          <p className="px-2.5 pt-1 text-[11px] text-ink-400">
            האימון נכתב בדופק, ולכן הוא נמדד בדופק. הקצב מוצג לידיעה — מי שרץ קצב טוב בדופק גבוה מהיעד לא ביצע את האימון.
          </p>
        )}
        {rows.some(s => s.hrUngradedReason === 'no_anchor') && (
          <p className="px-2.5 text-[11px] text-band-3-ink">
            יעד הדופק כתוב באחוזים ואין דופק מקסימלי שמור למתאמן, ולכן אי אפשר לדרג אותו.
          </p>
        )}
      </div>

      {/* ── the uniform form ── */}
      {!loaded ? (
        <div className="flex items-center gap-2 py-2 text-xs text-ink-400"><Spinner size={14} /> טוען פידבק…</div>
      ) : (
        <div className="rounded-xl bg-page/50 p-3 space-y-3">
          <Chips
            title="מה קרה באימון"
            hint={suggested.length && !saved ? 'סומן לפי הנתונים — אשר או תקן' : undefined}
            labels={EXECUTION_LABELS}
            selected={fb.execution}
            onToggle={t => toggleExecution(t as ExecutionTag)}
            suggested={saved ? [] : suggested}
          />
          <Chips
            title="תחושה (לפי מה שהמתאמן דיווח)"
            labels={EFFORT_LABELS}
            selected={fb.effort ? [fb.effort] : []}
            onToggle={t => setFb(prev => ({ ...prev, effort: prev.effort === t ? null : (t as EffortTag) }))}
          />
          <Chips
            title="מה ממשיכים מכאן"
            labels={ACTION_LABELS}
            selected={fb.action ? [fb.action] : []}
            onToggle={t => setFb(prev => ({ ...prev, action: prev.action === t ? null : (t as ActionTag) }))}
          />

          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold text-ink-400">הערה כללית</span>
              <span className="text-2xs text-ink-400 tabular-nums" dir="ltr">
                {fb.note.length}/{NOTE_MAX}
              </span>
            </div>
            <textarea
              value={fb.note}
              onChange={e => setFb(prev => ({ ...prev, note: e.target.value.slice(0, NOTE_MAX) }))}
              rows={2}
              dir="auto"
              aria-label="הערה כללית על האימון"
              placeholder="מה שהצ׳יפים לא אומרים"
              className="mt-1 w-full rounded-lg bg-white px-2.5 py-2 text-base text-ink-900 placeholder:text-ink-400"
            />
          </div>

          {/* What the trainee will actually read, before it is sent. */}
          <div>
            <span className="text-[11px] font-semibold text-ink-400">מה המתאמן יקבל</span>
            <pre
              dir="auto"
              className="mt-1 whitespace-pre-wrap rounded-lg bg-white px-2.5 py-2 text-xs leading-relaxed text-ink-900 font-sans"
            >{preview}</pre>
          </div>

          {error && <p className="text-[11px] text-accent-red">{error}</p>}
          {problems.length > 0 && <p className="text-[11px] text-ink-400">{problems[0].message}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={problems.length > 0 || saving}
              className={cn('flex items-center gap-1.5 rounded-xl px-3 min-h-[44px] text-xs font-semibold',
                problems.length > 0 || saving
                  ? 'bg-page text-ink-400'
                  : 'bg-brand-600 text-white')}
            >
              {saving ? <Spinner size={14} /> : <Send className="h-3.5 w-3.5" />}
              {saved ? 'עדכון הפידבק' : 'שליחת הפידבק'}
            </button>
            {saved?.sentAt && (
              <span className="flex items-center gap-1 text-[11px] text-accent-900">
                <Check className="h-3.5 w-3.5" /> נשלח
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chips({ title, hint, labels, selected, onToggle, suggested = [] }: {
  title: string;
  hint?: string;
  labels: Record<string, string>;
  selected: string[];
  onToggle: (tag: string) => void;
  suggested?: string[];
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-ink-400">{title}</span>
        {hint && <span className="text-2xs text-ink-400">{hint}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {Object.entries(labels).map(([tag, label]) => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              // Brand blue for "selected", never the success green: accent-600 means
              // "good" everywhere else in the app, and a filled green "דעיכה לקראת הסוף"
              // reads as praise for the thing the mentor is flagging.
              // min-h keeps a thumb-sized chip on a phone; the form is a column of
              // these and 29px rows are a mis-tap machine.
              className={cn('rounded-full px-3 min-h-[44px] min-w-[44px] text-[11px] font-medium',
                on ? 'bg-brand-600 text-white'
                  : suggested.includes(tag) ? 'bg-white text-ink-500 ring-1 ring-brand-600/40'
                  : 'bg-white text-ink-500')}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Which metric this workout is graded on overall — what gets stored with the feedback. */
export function dominantMetric(rows: SegmentVerdict[]): 'pace' | 'hr' | 'mixed' | 'none' {
  const pace = rows.filter(s => s.metric === 'pace').length;
  const hr = rows.filter(s => s.metric === 'hr').length;
  if (pace && hr) return 'mixed';
  if (hr) return 'hr';
  if (pace) return 'pace';
  return 'none';
}

function paceBandLabel(min: number | null, max: number | null): string {
  if (min == null) return '—';
  return max != null && max !== min ? `${formatPace(min)}–${formatPace(max)}` : formatPace(min);
}

function hrBandLabel(s: SegmentVerdict): string {
  if (s.plannedHrMin == null) return '—';
  return s.plannedHrMax != null && s.plannedHrMax !== s.plannedHrMin
    ? `${s.plannedHrMin}–${s.plannedHrMax}`
    : `${s.plannedHrMin}`;
}

// Short enough to stay on ONE line in the deviation cell: the full explanation is
// printed once under the table, so repeating "חסר דופק מקסימלי" on every row only
// bought a two-line cell and a table that no longer scans as a column of numbers.
function hrReasonShort(reason: 'no_anchor' | 'no_hr_data'): string {
  return reason === 'no_anchor' ? 'ללא יעד' : 'אין דופק';
}

/**
 * The deviation cell: how far outside the band the step actually was.
 *
 * A number rather than a word, in the metric's own unit — seconds per kilometre for a
 * pace step, beats for an HR step. `0` prints as "בטווח" because a mentor scanning a
 * column of numbers should not have to read "0" as "fine", and an ungradeable HR step
 * prints why instead of a number.
 */
function gapLabel(s: SegmentVerdict): string {
  if (s.hrUngradedReason) return hrReasonShort(s.hrUngradedReason);
  const d = bandDelta(s);
  if (d == null) return '—';
  if (d === 0) return 'בטווח';
  return `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;
}

/** Signed distance from the nearest band edge, in the step's own metric. */
function bandDelta(s: SegmentVerdict): number | null {
  if (s.metric === 'hr') {
    if (s.actualHr == null || s.plannedHrMin == null || s.plannedHrMax == null) return null;
    if (s.actualHr > s.plannedHrMax) return s.actualHr - s.plannedHrMax;
    if (s.actualHr < s.plannedHrMin) return s.actualHr - s.plannedHrMin;
    return 0;
  }
  if (s.actualPace == null || s.plannedPaceMin == null || s.plannedPaceMax == null) return null;
  if (s.actualPace < s.plannedPaceMin) return s.actualPace - s.plannedPaceMin;
  if (s.actualPace > s.plannedPaceMax) return s.actualPace - s.plannedPaceMax;
  return 0;
}
