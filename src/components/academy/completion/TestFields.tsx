'use client';

import { useTranslations } from 'next-intl';
import { cn, israelToday } from '@/lib/utils';
import { entryPreview, formDate, parseAvgHr, type EntryProtocol } from '@/lib/academy/test-entry';
import type { TestCandidate } from '@/lib/academy/test-finder';
import { Segmented, clock } from '@/components/trainee/ui';
import { CARD } from '../book/ui';
import { FIELD_INPUT, FieldRow, ThresholdBox } from './shared';

// ── The test half of the form (phones 2 and 4) ─────────────────────────────────────────
//
// The protocol, the day, the ONE measured number (30 minutes: the distance; 2000 m: the time),
// optionally the average HR, and the threshold computed while typing. Shared by the staff form
// and the trainee's own card so the two can never parse "7.12" differently.

export interface TestDraft {
  protocol: EntryProtocol;
  date: string;
  measured: string;
  avgHr: string;
  /** The watch run it came from ("מהשעון"); null when typed. */
  activityId: string | null;
  /** Older test-like runs to save as past tests too. */
  older: TestCandidate[];
}

// The day starts empty ("לבחור"), not today: a trainee who only types the distance would send
// "the last test" dated today, and the coach would approve a test nobody ran today.
export const emptyDraft = (): TestDraft => ({ protocol: '30min', date: '', measured: '', avgHr: '', activityId: null, older: [] });

/** A number and a day: nothing is sent without both. */
export function draftHasTest(d: TestDraft): boolean {
  return !!d.date && !!entryPreview(d.protocol, d.measured).row;
}

/** The POST /api/academy/tests body for a draft, or null while it has no number yet. */
export function draftBody(d: TestDraft, athleteId: string): Record<string, unknown> | null {
  const { row } = entryPreview(d.protocol, d.measured);
  if (!row || !d.date) return null;
  const hr = parseAvgHr(d.avgHr);
  return {
    athleteId, date: d.date, protocol: row.protocol, durationSec: row.durationSec, distanceM: row.distanceM,
    avgHr: typeof hr === 'number' ? hr : null, activityId: d.activityId,
  };
}

export function TestFields({ draft, onChange, self, showHr, name, gender, sendTo }: {
  draft: TestDraft;
  onChange: (d: TestDraft) => void;
  /** The trainee's own card: "מתי", "כמה רצת ב־30 דקות", "קצב הסף שלך". */
  self?: boolean;
  showHr?: boolean;
  /** Whose threshold, on the staff form. */
  name?: string;
  /** Theirs, for "…והעומס שלו / שלה". */
  gender?: string | null;
  /** The coach a trainee's entry goes to, for "יישלח ל־Sahar לאישור". */
  sendTo?: string | null;
}) {
  const t = useTranslations('completion.fields');
  const preview = entryPreview(draft.protocol, draft.measured);
  const hr = parseAvgHr(draft.avgHr);
  const set = (patch: Partial<TestDraft>) => onChange({ ...draft, ...patch, ...(patch.measured !== undefined || patch.protocol ? { activityId: null } : {}) });
  const today = israelToday();
  const thirty = draft.protocol === '30min';

  return (
    <>
      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="border-b border-[#EFEFF4] p-3">
          <Segmented
            label={t('protocol')}
            value={draft.protocol}
            onChange={(p) => set({ protocol: p, measured: '' })}
            options={[
              { value: '30min', label: t('p30') },
              { value: '2000m', label: <>{t.rich('p2000', { m: (c) => <bdi dir="ltr">{c}</bdi> })}</> },
            ]}
          />
        </div>
        <FieldRow label={self ? t('whenSelf') : t('date')} htmlFor="test-date">
          {/* The native date picker, dressed as the mockup's blue value: the label shows dd.mm.yyyy. */}
          <span className="relative inline-flex h-11 items-center">
            {draft.date
              ? <b className="pointer-events-none text-[16px] font-extrabold text-brand-600"><bdi dir="ltr">{formDate(draft.date)}</bdi></b>
              : <b className="pointer-events-none text-[16px] font-extrabold text-ink-300">{t('pickDate')}</b>}
            <input
              id="test-date"
              type="date"
              value={draft.date}
              max={today}
              onChange={(e) => e.target.value && set({ date: e.target.value })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label={self ? t('whenSelf') : t('date')}
            />
          </span>
        </FieldRow>
        <FieldRow label={thirty ? (self ? t('distanceSelf') : t('distance')) : (self ? t('timeSelf') : t('time'))} htmlFor="test-measured">
          {/* As wide as what is typed, so "7.12 ק״מ" starts at the value edge like the date and the HR
              above and below it. The placeholder is a neutral dash, and the unit greys with it. */}
          <span className="flex items-baseline gap-1" dir="ltr">
            <input
              id="test-measured"
              inputMode={thirty ? 'decimal' : 'text'}
              autoComplete="off"
              value={draft.measured}
              onChange={(e) => set({ measured: e.target.value })}
              placeholder="—"
              aria-label={thirty ? (self ? t('distanceSelf') : t('distance')) : (self ? t('timeSelf') : t('time'))}
              className={cn(FIELD_INPUT, 'tabular-nums')}
              style={{ width: `max(44px, ${Math.max(draft.measured.length, 3) + 0.5}ch)` }}
            />
            {thirty && <span className={cn('text-[16px] font-extrabold', draft.measured ? 'text-brand-600' : 'text-ink-300')}>{t('km')}</span>}
          </span>
        </FieldRow>
        {showHr && (
          <FieldRow label={t('hr')} htmlFor="test-hr">
            <input
              id="test-hr"
              inputMode="numeric"
              autoComplete="off"
              value={draft.avgHr}
              onChange={(e) => onChange({ ...draft, avgHr: e.target.value.replace(/\D/g, '').slice(0, 3) })}
              placeholder={t('optional')}
              dir="ltr"
              className={FIELD_INPUT}
            />
          </FieldRow>
        )}
      </div>
      {hr === 'invalid' && <p className="-mt-2 px-1 text-[13px] font-bold text-[#A8510A]">{t('hrInvalid')}</p>}

      {thirty ? (
        <ThresholdBox
          pace={preview.thresholdSec ? clock(preview.thresholdSec) : null}
          tone={!preview.row ? 'muted' : preview.implausible ? 'warn' : 'good'}
          title={self ? t('thresholdSelf') : t.rich('thresholdOf', { name: name ?? '', bdi: (c) => <bdi>{c}</bdi> })}
          sub={preview.implausible ? t('implausible')
            : self ? (sendTo ? t.rich('sendTo', { name: sendTo, bdi: (c) => <bdi>{c}</bdi> }) : t('sendToCoach'))
              : t('thresholdSub', { gender: gender === 'female' || gender === 'male' ? gender : 'other' })}
        />
      ) : (
        <ThresholdBox
          pace={preview.effortPaceSec ? clock(preview.effortPaceSec) : null}
          tone="muted"
          title={t('twoKTitle')}
          sub={t('twoKSub')}
        />
      )}
    </>
  );
}
