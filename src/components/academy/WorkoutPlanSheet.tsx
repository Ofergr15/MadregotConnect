'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { Sheet } from '@/components/ui';
import { RouteMinimap } from '@/components/RouteMinimap';
import {
  PACE_DOT, PACE_INK, PACE_TINT, amountLook, distancePillText, fmtClock, fmtKm, fmtPace, timePillText,
} from '@/lib/academy/pace-verdict';
import type { WorkoutSheet } from '@/lib/academy/workout-sheet';
import { DeltaPill, PacePill } from './PaceMark';
import { initialsOf } from './types';
import { BidiText } from '@/components/BidiText';

// ── Planned vs actual, one workout (mockup academy-plan-vs-actual) ──────────
//
// Opened by tapping any row of the trainee's week. Everything it says was decided
// by /api/academy/workout through the pace rule (lib/academy/pace-verdict.ts), so
// this file is layout: three comparisons, the chart of every rep (or kilometre)
// against the target band, the steps that left the plan, the route, and what the
// coach said.

const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "שלישי 29.9" */
function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export function WorkoutPlanSheet({
  athleteId,
  date,
  coachName,
  onOpenChange,
  onOpenThread,
}: {
  athleteId: string;
  /** The workout's day, or null when the sheet is closed. */
  date: string | null;
  coachName: string | null;
  onOpenChange: (open: boolean) => void;
  /** "לענות ל…" — the conversation, opened over the home. */
  onOpenThread: () => void;
}) {
  const { data, error } = useApi<{ sheet: WorkoutSheet }>(
    date ? `/api/academy/workout?athleteId=${encodeURIComponent(athleteId)}&date=${date}` : null,
  );
  const sheet = data?.sheet && data.sheet.date === date ? data.sheet : null;

  return (
    <Sheet
      open={!!date}
      onOpenChange={onOpenChange}
      // Pinned number runs, or "6×800" reads "800×6" in the RTL heading.
      title={sheet ? <BidiText text={sheet.name} /> : ' '}
      // A grey sheet, so the white cards inside it read as cards (the mockup's #F7F7FA).
      className="bg-[#F5F5F8]"
      titleClassName="px-4 pt-1 pb-0 text-start text-[21px] font-black leading-tight text-ink-700"
      bodyClassName="px-4 pb-6 pt-1"
    >
      {!sheet ? (
        <div className="flex justify-center py-12">
          {error
            ? <p className="text-sm text-ink-400">לא הצלחנו לטעון את האימון. נסו שוב בעוד רגע.</p>
            : <Loader2 className="h-5 w-5 animate-spin text-brand-600" />}
        </div>
      ) : (
        <SheetBody sheet={sheet} coachName={coachName} onOpenThread={onOpenThread} />
      )}
    </Sheet>
  );
}

function SheetBody({ sheet, coachName, onOpenThread }: {
  sheet: WorkoutSheet;
  coachName: string | null;
  onOpenThread: () => void;
}) {
  const [allSteps, setAllSteps] = useState(false);
  const done = sheet.status.kind === 'done' || sheet.status.kind === 'partial';
  const coachFirst = (sheet.feedback?.mentorName || coachName || 'המאמן').split(' ')[0];
  // "לדנה" for a Hebrew name, "ל־Dana" for a Latin one — a bare ל glued to Latin reads as a typo.
  const toCoach = /^[\u0590-\u05FF]/.test(coachFirst) ? `ל${coachFirst}` : `ל־${coachFirst}`;

  const sub = [dayLabel(sheet.date)];
  const subLtr: string[] = [];
  if (sheet.startClock) subLtr.push(sheet.startClock);
  const tail: string[] = [];
  if (sheet.locationName) tail.push(sheet.locationName);
  if (sheet.status.kind === 'partial' && sheet.distance.actualM != null) tail.push(`נעצר אחרי ${fmtKm(sheet.distance.actualM)} ק״מ`);
  if (sheet.status.kind === 'missed') tail.push('לא בוצע');
  if (sheet.status.kind === 'upcoming') tail.push('עוד לא בוצע');

  const offPlan = sheet.steps.filter((s) => s.verdict.kind !== 'on');
  const steps = allSteps ? sheet.steps : offPlan;

  return (
    <div className="space-y-[7px]" dir="rtl">
      {/* Date · time · place, and the corner verdict. */}
      <div className="flex items-start gap-2.5">
        <p className="flex-1 min-w-0 text-[12.5px] text-ink-400">
          {sub[0]}
          {subLtr.map((t) => <span key={t}> · <bdi dir="ltr">{t}</bdi></span>)}
          {tail.map((t) => <span key={t}> · {t}</span>)}
        </p>
        {sheet.badge && (
          <div
            className="shrink-0 rounded-2xl px-2.5 py-1.5 text-center"
            style={{ background: PACE_TINT[sheet.badge.kind === 'accuracy' ? 'on' : 'slow'] }}
          >
            <b className="block text-xl font-black leading-none" style={{ color: PACE_INK[sheet.badge.kind === 'accuracy' ? 'on' : 'slow'] }}>
              <bdi dir="ltr">{sheet.badge.value}%</bdi>
            </b>
            <span className="text-3xs font-extrabold" style={{ color: PACE_INK[sheet.badge.kind === 'accuracy' ? 'on' : 'slow'] }}>
              {sheet.badge.kind === 'accuracy' ? 'דיוק' : 'מהתוכנית'}
            </span>
          </div>
        )}
      </div>

      {/* The three comparisons: big actual, small planned, the delta pill. */}
      <div className="grid grid-cols-3 gap-1.5 pt-1">
        <Compare
          label="מרחק"
          actual={done ? fmtKm(sheet.distance.actualM) : '—'}
          planned={`תוכנן ${fmtKm((sheet.distance.plannedMinM + sheet.distance.plannedMaxM) / 2)} ק״מ`}
          pill={sheet.distance.verdict
            ? <DeltaPill look={amountLook(sheet.distance.verdict.kind)} text={distancePillText(sheet.distance.verdict)} />
            : null}
        />
        {sheet.pace ? (
          <Compare
            label={sheet.pace.label}
            actual={done && sheet.pace.actual != null ? fmtPace(sheet.pace.actual) : '—'}
            planned={<>יעד <bdi dir="ltr">{sheet.pace.targetMin === sheet.pace.targetMax
              ? fmtPace(sheet.pace.targetMin)
              : `${fmtPace(sheet.pace.targetMin)}–${fmtPace(sheet.pace.targetMax)}`}</bdi></>}
            pill={done && sheet.pace.verdict ? <PacePill verdict={sheet.pace.verdict} /> : null}
          />
        ) : <Compare label="קצב" actual="—" planned="ללא יעד" pill={null} />}
        {sheet.time ? (
          <Compare
            label="זמן"
            actual={done ? fmtClock(sheet.time.actualSec) : '—'}
            planned={`תוכנן ${sheet.time.estimated ? 'כ־' : ''}${Math.round(sheet.time.plannedSec / 60)} דק׳`}
            pill={sheet.time.verdict
              ? <DeltaPill look={amountLook(sheet.time.verdict.kind)} text={timePillText(sheet.time.verdict)} />
              : null}
          />
        ) : <Compare label="זמן" actual={done ? '—' : '—'} planned="ללא זמן" pill={null} />}
      </div>

      {sheet.chart && <PaceChart chart={sheet.chart} />}

      {/* Only the steps that left the plan; the rest behind one tap. */}
      {sheet.steps.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-card">
          <div className="grid h-7 grid-cols-[1fr_54px_54px_92px] items-center gap-1.5 bg-page/30 px-3 text-3xs font-extrabold text-ink-400">
            <span>שלב</span><span className="text-center">יעד</span><span className="text-center">בוצע</span><span className="text-left">הפרש</span>
          </div>
          {steps.length === 0 && (
            <p className="border-t border-page/60 px-3 py-2.5 text-xs text-ink-400">כל השלבים היו בתוכנית.</p>
          )}
          {steps.map((s, i) => (
            <div key={i} className="grid h-[38px] grid-cols-[1fr_54px_54px_92px] items-center gap-1.5 border-t border-page/60 px-3 text-13">
              <span className="truncate font-semibold text-ink-700">{s.label}</span>
              <bdi dir="ltr" className="text-center font-bold text-ink-400">{fmtPace((s.plannedMin + s.plannedMax) / 2)}</bdi>
              <bdi dir="ltr" className="text-center font-black" style={{ color: PACE_INK[s.verdict.kind] }}>{fmtPace(s.actual)}</bdi>
              <span className="text-left"><PacePill verdict={s.verdict} short /></span>
            </div>
          ))}
          {sheet.steps.length > offPlan.length && (
            <button
              type="button"
              onClick={() => setAllSteps((v) => !v)}
              className="flex min-h-[44px] w-full items-center justify-center gap-1 border-t border-page/60 text-[12.5px] font-extrabold text-brand-600"
            >
              {allSteps ? 'רק מה שחרג' : `כל ${sheet.steps.length} השלבים`}
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* The full run, on the page that already exists. */}
      {sheet.activityId && (
        <Link
          href={`/dashboard/activities/${sheet.activityId}`}
          className="flex items-stretch overflow-hidden rounded-2xl bg-card active:scale-[0.99] transition-transform"
        >
          <div className="h-[84px] w-[118px] shrink-0 bg-page/50">
            {sheet.route && sheet.route.length > 1
              ? <RouteMinimap points={sheet.route} width={118} height={84} className="h-full w-full" />
              : null}
          </div>
          <div className="flex flex-1 flex-col justify-center gap-0.5 px-3 py-2">
            <b className="text-sm font-black text-ink-700">הריצה המלאה</b>
            <small className="text-[11.5px] text-ink-400">מפה, פיצולים, דופק, גובה</small>
            <span className="mt-0.5 inline-flex items-center gap-0.5 text-13 font-black text-brand-600">
              לצפייה באימון <ChevronLeft className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
      )}

      {/* What the coach said, or the door to say something to them. */}
      {sheet.feedback ? (
        <div className="rounded-2xl border-s-4 border-brand-600 bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-brand-600 text-3xs font-extrabold text-white">
              {initialsOf(sheet.feedback.mentorName || coachFirst)}
            </span>
            <b className="text-13 font-bold text-ink-700" dir="auto">{coachFirst}</b>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-13 leading-relaxed text-ink-500" dir="auto">{sheet.feedback.text}</p>
          <button type="button" onClick={onOpenThread} className="mt-0.5 flex min-h-[44px] items-center gap-0.5 text-[12.5px] font-extrabold text-brand-600">
            לענות {toCoach} <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border-s-4 border-ink-300 bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-ink-300 text-3xs font-extrabold text-white">?</span>
            <b className="text-13 font-bold text-ink-400">עוד אין משוב</b>
          </div>
          <p className="mt-1 text-13 leading-relaxed text-ink-500">
            {sheet.status.kind === 'partial'
              ? `אפשר לכתוב ${toCoach} למה נעצרת, והשבוע יותאם.`
              : sheet.status.kind === 'missed'
                ? `אפשר לכתוב ${toCoach} מה קרה, והשבוע יותאם.`
                : `משהו לשאול את ${coachFirst} על האימון הזה?`}
          </p>
          <button type="button" onClick={onOpenThread} className="mt-0.5 flex min-h-[44px] items-center gap-0.5 text-[12.5px] font-extrabold text-brand-600">
            לכתוב {toCoach} <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function Compare({ label, actual, planned, pill }: {
  label: string;
  actual: string;
  planned: React.ReactNode;
  pill: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-card px-1 pb-[7px] pt-2 text-center">
      <span className="text-3xs font-bold text-ink-400">{label}</span>
      <b className="my-0.5 text-[19px] font-black leading-tight text-ink-700"><bdi dir="ltr">{actual}</bdi></b>
      <span className="text-3xs text-ink-400">{planned}</span>
      {pill && <span className="mt-1">{pill}</span>}
    </div>
  );
}

/**
 * Every rep (or kilometre) against the target band. One axis, faster at the top;
 * the green band is the target widened by the tolerance; only the points outside
 * it carry their pace, so the chart's text is exactly the list of what went wrong.
 */
function PaceChart({ chart }: { chart: NonNullable<WorkoutSheet['chart']> }) {
  const W = 330, H = 112, top = 14, base = H - 28;
  const paces = chart.points.map((p) => p.pace);
  const lo = Math.min(...paces, chart.bandMin) - 6;
  const hi = Math.max(...paces, chart.bandMax) + 6;
  const Y = (v: number) => top + ((base - top) * (v - lo)) / (hi - lo || 1);
  const slot = W / chart.points.length;
  const X = (i: number) => i * slot + slot / 2;
  // Past a dozen points every label would collide; every other one still counts.
  const every = chart.points.length > 12 ? 2 : 1;

  return (
    <div className="rounded-2xl bg-card px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-sm font-black text-ink-700">{chart.mode === 'reps' ? 'כל חזרה מול היעד' : 'כל קילומטר מול היעד'}</b>
        <span className="text-[11.5px] text-ink-400">
          הפס הירוק = <bdi dir="ltr">{fmtPace(chart.bandMin)}–{fmtPace(chart.bandMax)}</bdi>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 block h-[112px] w-full overflow-visible" role="img"
        aria-label={chart.mode === 'reps' ? 'קצב כל חזרה מול טווח היעד' : 'קצב כל קילומטר מול טווח היעד'}>
        <rect x={0} width={W} y={Y(chart.bandMin)} height={Y(chart.bandMax) - Y(chart.bandMin)} fill="#DDF1E4" rx={6} />
        <line x1={0} x2={W} y1={Y(chart.target)} y2={Y(chart.target)} stroke="#1FA55B" strokeDasharray="3 3" />
        <text x={2} y={Y(chart.bandMin) - 4} fontSize={10} fontWeight={800} fill="#0F7A3D" direction="ltr">
          {fmtPace(chart.target)} יעד
        </text>
        {/* LTR so `end` means the right edge; in this RTL page it would mean the left. */}
        <text x={W} y={top - 4} fontSize={10} fill="#5F5F5F" textAnchor="end" direction="ltr">מהר יותר ↑</text>
        <path d={chart.points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.pace)}`).join(' ')} fill="none" stroke="#BBBBBB" strokeWidth={1.5} />
        {chart.points.map((p, i) => (
          <g key={i}>
            <circle cx={X(i)} cy={Y(p.pace)} r={6} fill={PACE_DOT[p.kind]} stroke="#fff" strokeWidth={2} />
            {p.kind !== 'on' && (
              <text
                x={X(i)}
                y={p.kind === 'fast' ? Y(p.pace) - 10 : Y(p.pace) + 18}
                textAnchor="middle"
                fontSize={11}
                fontWeight={900}
                fill={PACE_INK[p.kind]}
              >
                {fmtPace(p.pace)}
              </text>
            )}
            {i % every === 0 && (
              <text x={X(i)} y={H - 3} textAnchor="middle" fontSize={10} fill="#5F5F5F">{p.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
