'use client';

import { useMemo, useState } from 'react';
import { X, Repeat, Check, Copy, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { textDir } from '@/lib/bidi';
import type { WorkoutStep } from '@/lib/ai/types';
import { groupPaceTokens } from '@/lib/garmin/pace';
import {
  DEFAULT_STORY_PLACE, DEFAULT_STORY_TIME, workoutStoryText,
} from '@/lib/plans/workout-story-text';
import { PaceTokens } from './PaceTokens';
import { Sheet } from '@/components/ui';

/**
 * Renders one workout session's full step breakdown (warmup/intervals/
 * cooldown, per-group paces) in a bottom sheet. Extracted from
 * `src/app/dashboard/page.tsx` (that page's bar-chart day-tiles open this on
 * tap) so the Program page's native day-cards can open the EXACT same detail
 * view for an arbitrary week — one place that knows how to render a
 * `ParsedWorkout`'s steps, instead of two that could drift.
 */

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${min} min`;
  }
  return `${seconds}s`;
}

/**
 * The step's name — the coach's own note if there is one, otherwise the step
 * type in words.
 *
 * `t` is passed in rather than pulled from a hook because this is a module-level
 * helper called from inside a `.map()`. The labels come from the `workoutEditor`
 * namespace, which already had all six in Hebrew: the editor writes them and
 * this sheet reads them back, so they had better be the same words. They were
 * hardcoded English here ("Warmup", "Hard", "Recovery"), i.e. English step names
 * inside an otherwise-Hebrew workout — and "Hard" didn't even match the editor's
 * own "אינטרוול".
 */
function getStepLabel(step: any, t: (key: string) => string): string {
  if (step.notes) return step.notes;
  const keys: Record<string, string> = {
    warmup: 'stepWarmup', cooldown: 'stepCooldown', interval: 'stepInterval',
    active: 'stepActive', rest: 'stepRest', recovery: 'stepRecovery',
  };
  const key = keys[step.type];
  return key ? t(key) : step.type;
}

function getStepColor(step: any): string {
  if (step.type === 'warmup' || step.type === 'cooldown') return '#f59e0b';
  if (step.type === 'interval' || step.type === 'active') return '#ef4444';
  return '#969696';
}

function summarizeSteps(steps: any[]): any[] {
  const summary: any[] = [];

  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      // Check if repeat substeps are effort-based (no pace numbers in notes)
      const subsAreEffortBased = step.repeatSteps.every((sub: any) =>
        !sub.notes || !/\d:\d\d/.test(sub.notes)
      );
      // If parent has warmup-like duration+pace and substeps are effort-only,
      // extract the warmup as a separate phase
      if (subsAreEffortBased && step.notes && /דקות|דק/.test(step.notes) && /\d:\d\d/.test(step.notes) && step.durationValue && step.durationValue >= 300) {
        summary.push({
          type: 'phase',
          phase: 'warmup',
          steps: [{
            type: 'warmup',
            durationType: 'time',
            durationValue: step.durationValue,
            targetPaceMinPerKm: step.targetPaceMinPerKm,
            targetPaceMaxPerKm: step.targetPaceMaxPerKm,
          }],
        });
      }
      summary.push({ type: 'repeat', count: step.repeatCount, notes: step.notes, substeps: step.repeatSteps });
    } else if (step.type === 'warmup' || step.type === 'cooldown') {
      const prev = summary[summary.length - 1];
      if (prev?.type === 'phase' && prev.phase === step.type) {
        prev.steps.push(step);
      } else {
        summary.push({ type: 'phase', phase: step.type, steps: [step] });
      }
    } else if (step.type === 'rest' || step.type === 'recovery') {
      summary.push({ type: 'rest', step });
    } else {
      summary.push({ type: 'step', step });
    }
  }
  return summary;
}

function formatStepDuration(step: any): string {
  if (step.durationType === 'distance' && step.durationValue) {
    return step.durationValue >= 1000 ? `${step.durationValue / 1000} km` : `${step.durationValue}m`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    return formatDuration(step.durationValue);
  }
  return '';
}

function isEffortBased(step: any): boolean {
  if (!step.notes) return false;
  const effortWords = /קל|מתון|בינוני|קשה|נוח|מתום/;
  return effortWords.test(step.notes);
}

function formatStepPace(step: any): string {
  if (isEffortBased(step)) return '';
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    return `${formatPace(step.targetPaceMinPerKm)}–${formatPace(step.targetPaceMaxPerKm)}`;
  }
  if (step.targetPaceMinPerKm) return formatPace(step.targetPaceMinPerKm);
  return '';
}

// The athlete-side pace: this screen's own data shape (`step.groupPaces`, an
// array) adapted onto the shared renderer, so the coach's planner and the
// athlete's sheet cannot drift on how the club's notation looks. The athlete's
// own group is the highlighted one. Falls back to the step's single pace when a
// plan has no per-group data; renders nothing when the step has no pace at all.
function GroupPaces({ step, viewGroup }: { step: any; viewGroup: number }) {
  if (isEffortBased(step)) return null;
  const gp = step.groupPaces as Array<{ min: number; max: number } | null> | undefined;
  const tokens: [string, string, string] = gp
    ? groupPaceTokens(gp[0], gp[1], gp[2])
    : [formatStepPace(step), '', ''];
  return <PaceTokens tokens={tokens} highlight={viewGroup} size="sm" />;
}

/**
 * What the sheet needs to know about the session it is opening.
 *
 * `distance` and `duration` arrive as finished strings, units and all: the row
 * the athlete tapped already prints them, and the sheet saying "24.5 km" under a
 * row that says "23.6–24.5 ק״מ" is the same session described two ways. It was
 * `session: any` with a hardcoded ` km` suffix, which is exactly how that
 * happened.
 */
export interface WorkoutDetailSession {
  /** The session's headline — the sheet's title. */
  name: string;
  /** Where in the week it sits: "שלישי · ערב". */
  day: string;
  distance: string;
  duration: string;
  steps: WorkoutStep[];
  /**
   * What the Instagram story needs and the sheet's own labels cannot give it: the
   * day as a NUMBER and the type as a KEY, because the story is English while
   * `day` and `name` above are already translated for whoever is reading the app.
   *
   * Optional, and the copy panel is simply absent without it — a screen that
   * opens this sheet from something other than a planned session has no story to
   * offer, and inventing a day for it would put a wrong date on a public post.
   */
  story?: { dayOfWeek: number; type: string; km: string };
}

/**
 * Copy the session as the text the club posts to Instagram.
 *
 * Collapsed to one line until it is asked for: twenty-four of the twenty-five
 * people who open this sheet are here to read their workout, and a story composer
 * above it would be the first thing they see for no reason.
 *
 * The time and the place are FIELDS, not constants. The club's standing practice
 * is 06:00 at Madregot and that is what they open with, but an afternoon session
 * somewhere else is a normal thing — and a copy button that silently stamps
 * "06:00am" on it would publish a time nobody wrote. They are remembered, so the
 * usual case is still one tap.
 */
function StoryCopy({ session }: { session: WorkoutDetailSession }) {
  const t = useTranslations('workoutEditor');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [time, setTime] = useState(() => {
    try { return localStorage.getItem('story_time') ?? DEFAULT_STORY_TIME; }
    catch { return DEFAULT_STORY_TIME; }
  });
  const [place, setPlace] = useState(() => {
    try { return localStorage.getItem('story_place') ?? DEFAULT_STORY_PLACE; }
    catch { return DEFAULT_STORY_PLACE; }
  });

  const story = session.story!;
  const text = useMemo(
    () => workoutStoryText({ ...story, steps: session.steps || [], time, place }),
    [story, session.steps, time, place],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission — the text is on screen and selectable, which is
      // the whole reason the preview is a real textarea rather than a <pre>.
      setOpen(true);
    }
  };

  const remember = (key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  };

  return (
    <div className="pb-3 shrink-0">
      <div className="flex items-center gap-2">
        <button
          onClick={() => (open ? copy() : setOpen(true))}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600/10 px-3 h-8 text-xs font-semibold text-brand-600 transition-colors active:bg-brand-600/20"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied ? t('storyCopied') : t('storyCopy')}
        </button>
        {open && !copied && (
          <button
            onClick={copy}
            aria-label={t('storyCopy')}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition-opacity active:opacity-80"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {/* LTR throughout: the text is English and a pace bracket in an RTL box
              arrives as "((3:35)) 3:15" — the same bidi failure the share cards
              had, and here it would be copied out of the app that way. */}
          <textarea
            dir="ltr"
            readOnly
            value={text}
            rows={Math.min(16, text.split('\n').length + 1)}
            className="w-full resize-none rounded-lg border border-page bg-card/60 p-2.5 text-xs leading-relaxed text-ink-700 tabular-nums"
          />
          {/* The labels are PLACEHOLDERS, not captions beside the inputs: a caption
              plus a field, twice, does not fit 390px with the sheet's padding — the
              first mockup had the second field hanging off the edge of the phone. */}
          <div className="flex items-center gap-2">
            <input
              dir="ltr"
              value={time}
              aria-label={t('storyTime')}
              placeholder={t('storyTime')}
              onChange={(e) => { setTime(e.target.value); remember('story_time', e.target.value); }}
              className="min-w-0 flex-1 rounded-lg border border-page bg-card/60 px-2.5 h-8 text-xs text-ink-700 placeholder:text-ink-300"
            />
            <input
              dir="ltr"
              value={place}
              aria-label={t('storyPlace')}
              placeholder={t('storyPlace')}
              onChange={(e) => { setPlace(e.target.value); remember('story_place', e.target.value); }}
              className="min-w-0 flex-1 rounded-lg border border-page bg-card/60 px-2.5 h-8 text-xs text-ink-700 placeholder:text-ink-300"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkoutDetailModal({ session, viewGroup, onPickGroup, onClose }: {
  session: WorkoutDetailSession;
  viewGroup: number;
  onPickGroup: (idx: number) => void;
  onClose: () => void;
}) {
  const tc = useTranslations('common');
  const t = useTranslations('workoutEditor');
  const blocks = summarizeSteps(session.steps || []);
  // Only show the group toggle when the plan actually carries per-group paces.
  const hasGroupPaces = (session.steps || []).some((s: any) =>
    Array.isArray(s.groupPaces) && s.groupPaces.filter(Boolean).length > 1
    || (s.repeatSteps || []).some((r: any) => Array.isArray(r.groupPaces) && r.groupPaces.filter(Boolean).length > 1)
  );

  return (
    // The title is the session's headline — "20 × 500 מ׳" — and an unmarked
    // metric expression reaches an RTL screen as "מ׳ 500 × 20".
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={<bdi dir={textDir(session.name)}>{session.name}</bdi>}
    >
        {/* Header */}
        <div className="pb-3 flex items-start justify-between shrink-0">
          <div>
            <p className="text-xs font-bold text-brand-600 uppercase tracking-wider">{session.day}</p>
            <div className="flex items-center gap-3 mt-1">
              {session.distance && (
                <span dir="ltr" className="text-sm font-bold text-ink-700 tabular-nums">{session.distance}</span>
              )}
              {session.duration && (
                <span dir="ltr" className="text-sm text-ink-400 tabular-nums">{session.duration}</span>
              )}
            </div>
          </div>
          {/* The sheet's only visible close affordance, and an X carries no name
              of its own. `common.close` already existed. */}
          <button
            onClick={onClose}
            aria-label={tc('close')}
            className="p-2 rounded-lg hover:bg-page text-ink-400 hover:text-ink-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Group selector — pick which group's pace is highlighted (display only) */}
        {hasGroupPaces && (
          <div className="pb-3 shrink-0">
            <div className="flex items-center gap-1 bg-card/60 border border-page/50 rounded-lg p-1 w-fit">
              {[0, 1, 2].map(g => (
                <button
                  key={g}
                  onClick={() => onPickGroup(g)}
                  className={cn(
                    'px-3 h-7 rounded-md text-xs font-semibold transition-colors',
                    g === viewGroup ? 'bg-brand-600 text-white' : 'text-ink-400 hover:text-ink-900'
                  )}
                >
                  Group {g + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {session.story && <StoryCopy session={session} />}

        {/* Compact Workout Structure */}
        <div className="pb-1 space-y-2">
          {blocks.map((block, i) => {
            if (block.type === 'phase') {
              const step0 = block.steps[0];
              const durLabel = formatStepDuration(step0);
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-card/40">
                  <div className="w-1 h-5 rounded-full bg-band-3 flex-shrink-0" />
                  <span className="text-sm text-ink-700 font-medium">{t(block.phase === 'warmup' ? 'stepWarmup' : 'stepCooldown')}</span>
                  {durLabel && <span className="text-sm text-ink-400">{durLabel}</span>}
                  <span className="ms-auto"><GroupPaces step={step0} viewGroup={viewGroup} /></span>
                </div>
              );
            }

            if (block.type === 'repeat') {
              const substeps = block.substeps || [];
              const summary = substeps.map((sub: any) => {
                const dur = formatStepDuration(sub);
                const label = getStepLabel(sub, t);
                return { dur, label, isRest: sub.type === 'rest' || sub.type === 'recovery', step: sub };
              });

              return (
                <div key={i} className="rounded-lg border border-brand-600/20 bg-brand-600/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <Repeat className="h-3.5 w-3.5 text-brand-600" />
                    <span className="text-sm font-bold text-ink-700">{block.count}x</span>
                  </div>
                  <div className="space-y-1">
                    {summary.map((s: any, j: number) => (
                      <div key={j} dir="ltr" className="flex items-center gap-2 text-sm">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: getStepColor(s.step) }} />
                        <span className={cn("font-medium flex-shrink-0", s.isRest ? "text-ink-400" : "text-ink-700")}>
                          {s.dur}
                        </span>
                        <span className="text-ink-400 truncate flex-1 text-end" dir="rtl">{s.label}</span>
                        <span className="flex-shrink-0"><GroupPaces step={s.step} viewGroup={viewGroup} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (block.type === 'rest') {
              const s = block.step;
              const dur = formatStepDuration(s) || t('stepOpen');
              return (
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 text-sm text-ink-400">
                  <div className="w-1 h-4 rounded-full bg-ink-300" />
                  <span>{s.notes || t('stepRecovery')}</span>
                  <span className="ms-auto">{dur}</span>
                </div>
              );
            }

            const s = block.step;
            const dur = formatStepDuration(s) || t('stepOpen');
            const label = getStepLabel(s, t);
            return (
              <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-card/40 text-sm">
                <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: getStepColor(s) }} />
                <span className="font-medium text-ink-700">{label}</span>
                <span className="text-ink-400">{dur}</span>
                <span className="ms-auto"><GroupPaces step={s} viewGroup={viewGroup} /></span>
              </div>
            );
          })}

          {(!session.steps || session.steps.length === 0) && (
            <p className="text-sm text-ink-400 text-center py-8">{t('noStepDetails')}</p>
          )}
        </div>
    </Sheet>
  );
}
