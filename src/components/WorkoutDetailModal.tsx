'use client';

import { X, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groupPaceTokens } from '@/lib/garmin/pace';
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

function getStepLabel(step: any): string {
  if (step.notes) return step.notes;
  const labels: Record<string, string> = {
    warmup: 'Warmup', cooldown: 'Cooldown', interval: 'Hard',
    active: 'Run', rest: 'Recovery', recovery: 'Recovery',
  };
  return labels[step.type] || step.type;
}

function getStepColor(step: any): string {
  if (step.type === 'warmup' || step.type === 'cooldown') return '#f59e0b';
  if (step.type === 'interval' || step.type === 'active') return '#ef4444';
  return '#64748b';
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

// Renders a step's pace for all three groups: Group 1 plain, Group 2 in single
// brackets, Group 3 in double brackets — "3:30 (3:40) ((3:50))" — with the
// athlete's own group highlighted. Falls back to the step's single pace when a
// plan has no per-group data. Returns null when the step has no pace at all.
function GroupPaces({ step, viewGroup }: { step: any; viewGroup: number }) {
  if (isEffortBased(step)) return null;
  const gp = step.groupPaces as Array<{ min: number; max: number } | null> | undefined;
  const tokens: [string, string, string] = gp
    ? groupPaceTokens(gp[0], gp[1], gp[2])
    : [formatStepPace(step), '', ''];
  if (!tokens.some(Boolean)) return null;

  return (
    <span dir="ltr" className="inline-flex items-center gap-1 tabular-nums">
      {tokens.map((tok, g) => {
        if (!tok) return null;
        const text = g === 0 ? tok : g === 1 ? `(${tok})` : `((${tok}))`;
        const mine = g === viewGroup;
        return (
          <span
            key={g}
            className={cn(
              'text-xs',
              mine ? 'text-primary-600 font-bold' : 'text-slate-500'
            )}
          >
            {text}
          </span>
        );
      })}
    </span>
  );
}

export function WorkoutDetailModal({ session, viewGroup, onPickGroup, onClose }: {
  session: any;
  viewGroup: number;
  onPickGroup: (idx: number) => void;
  onClose: () => void;
}) {
  const blocks = summarizeSteps(session.steps || []);
  // Only show the group toggle when the plan actually carries per-group paces.
  const hasGroupPaces = (session.steps || []).some((s: any) =>
    Array.isArray(s.groupPaces) && s.groupPaces.filter(Boolean).length > 1
    || (s.repeatSteps || []).some((r: any) => Array.isArray(r.groupPaces) && r.groupPaces.filter(Boolean).length > 1)
  );

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} title={session.name}>
        {/* Header */}
        <div className="pb-3 flex items-start justify-between shrink-0">
          <div>
            <p className="text-xs font-bold text-primary-600 uppercase tracking-wider">{session.day}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm font-bold text-white">{session.totalKm} km</span>
              {session.highlight && (
                <code className="text-xs font-bold text-primary-600 bg-primary-600/10 px-2 py-0.5 rounded">{session.highlight}</code>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Group selector — pick which group's pace is highlighted (display only) */}
        {hasGroupPaces && (
          <div className="pb-3 shrink-0">
            <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/50 rounded-lg p-1 w-fit">
              {[0, 1, 2].map(g => (
                <button
                  key={g}
                  onClick={() => onPickGroup(g)}
                  className={cn(
                    'px-3 h-7 rounded-md text-xs font-semibold transition-colors',
                    g === viewGroup ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
                  )}
                >
                  Group {g + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Compact Workout Structure */}
        <div className="pb-1 space-y-2">
          {blocks.map((block, i) => {
            if (block.type === 'phase') {
              const step0 = block.steps[0];
              const durLabel = formatStepDuration(step0);
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-800/40">
                  <div className="w-1 h-5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-sm text-white font-medium">{block.phase === 'warmup' ? 'Warmup' : 'Cooldown'}</span>
                  {durLabel && <span className="text-sm text-slate-400">{durLabel}</span>}
                  <span className="ms-auto"><GroupPaces step={step0} viewGroup={viewGroup} /></span>
                </div>
              );
            }

            if (block.type === 'repeat') {
              const substeps = block.substeps || [];
              const summary = substeps.map((sub: any) => {
                const dur = formatStepDuration(sub);
                const label = getStepLabel(sub);
                return { dur, label, isRest: sub.type === 'rest' || sub.type === 'recovery', step: sub };
              });

              return (
                <div key={i} className="rounded-lg border border-primary-600/20 bg-primary-600/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <Repeat className="h-3.5 w-3.5 text-primary-600" />
                    <span className="text-sm font-bold text-white">{block.count}x</span>
                  </div>
                  <div className="space-y-1">
                    {summary.map((s: any, j: number) => (
                      <div key={j} dir="ltr" className="flex items-center gap-2 text-sm">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: getStepColor(s.step) }} />
                        <span className={cn("font-medium flex-shrink-0", s.isRest ? "text-slate-500" : "text-white")}>
                          {s.dur}
                        </span>
                        <span className="text-slate-400 truncate flex-1 text-end" dir="rtl">{s.label}</span>
                        <span className="flex-shrink-0"><GroupPaces step={s.step} viewGroup={viewGroup} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (block.type === 'rest') {
              const s = block.step;
              const dur = formatStepDuration(s) || 'Open';
              return (
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 text-sm text-slate-500">
                  <div className="w-1 h-4 rounded-full bg-slate-600" />
                  <span>{s.notes || 'Recovery'}</span>
                  <span className="ms-auto">{dur}</span>
                </div>
              );
            }

            const s = block.step;
            const dur = formatStepDuration(s) || 'Open';
            const label = getStepLabel(s);
            return (
              <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-800/40 text-sm">
                <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: getStepColor(s) }} />
                <span className="font-medium text-white">{label}</span>
                <span className="text-slate-400">{dur}</span>
                <span className="ms-auto"><GroupPaces step={s} viewGroup={viewGroup} /></span>
              </div>
            );
          })}

          {(!session.steps || session.steps.length === 0) && (
            <p className="text-sm text-slate-500 text-center py-8">No step details available</p>
          )}
        </div>
    </Sheet>
  );
}
