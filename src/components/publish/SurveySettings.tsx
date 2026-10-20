'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  closePreset, israelDateTime, israelLocalToIso, planReminders, REMINDER_KEYS,
  type ClosePreset, type ReminderKey,
} from '@/lib/survey-reminders';

// The poll's own settings on "לפרסם › סקר" (mockup ~/.cache/madregot/polls-proposal.html,
// Ofer 2026-10-20): a template to start from, when it closes — any date and time, the quick
// buttons only fill them in — and its reminders: a week, 24 hours and an hour before the
// close (all three ticked by default), or times of the staff's own. Each reminder reaches
// only whoever hasn't answered by then; the rules are lib/survey-reminders.

const CARD = 'rounded-[18px] bg-card';
const LABEL = 'px-1.5 text-13 font-bold text-ink-400';

export type CloseKind = ClosePreset | 'date' | 'none';

export interface SurveyTemplate { key: string; emoji: string; question: string; options: string[]; multi?: boolean }
export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  { key: 'date', emoji: '📅', question: 'איזה ערב מתאים לכם?', options: ['', '', 'לא אוכל להגיע'], multi: true },
  { key: 'yesno', emoji: '✅', question: '', options: ['כן', 'לא'] },
  { key: 'race', emoji: '🏁', question: 'מי רץ במרוץ?', options: ['נרשמתי', 'מתלבט/ת', 'לא הפעם'] },
  { key: 'gear', emoji: '👕', question: 'איזו מידה להזמין לך?', options: ['XS', 'S', 'M', 'L', 'XL'] },
  { key: 'workout', emoji: '🏃', question: 'איזה אימון בא לכם?', options: ['', ''] },
  { key: 'blank', emoji: '✏️', question: '', options: ['', ''] },
];

export function SurveyTemplates({ onPick }: { onPick: (t: SurveyTemplate) => void }) {
  const t = useTranslations('publish');
  return (
    <>
      <p className={LABEL}>{t('templatesTitle')}</p>
      <div className="grid grid-cols-3 gap-2">
        {SURVEY_TEMPLATES.map((tpl) => (
          <button key={tpl.key} type="button" onClick={() => onPick(tpl)}
            className={cn(CARD, 'flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[12.5px] font-bold text-ink-700 active:bg-page')}>
            <span className="text-[18px] leading-none">{tpl.emoji}</span>{t(`tpl_${tpl.key}` as 'tpl_date')}
          </button>
        ))}
      </div>
    </>
  );
}

/** "שלישי 29.10 · 20:00" in Israel. */
function useWhen() {
  const tc = useTranslations('common');
  const days = tc.raw('dayNamesShort') as string[];
  return (iso: string) => {
    const x = israelDateTime(iso);
    return `${days[x.dow]} ${Number(x.date.slice(8, 10))}.${Number(x.date.slice(5, 7))} · ${x.time}`;
  };
}

export function CloseSetting({ kind, date, time, onChange }: {
  kind: CloseKind; date: string; time: string;
  onChange: (v: { kind: CloseKind; date: string; time: string }) => void;
}) {
  const t = useTranslations('publish');
  const pick = (k: CloseKind) => {
    if (k === 'none' || k === 'date') onChange({ kind: k, date, time });
    else onChange({ kind: k, ...closePreset(k) });
  };
  const opts: Array<[CloseKind, string]> = [['today', t('closesToday')], ['tomorrow', t('closesTomorrow20')], ['week', t('closesWeek')], ['date', t('closesDate')], ['none', t('closesNever')]];
  return (
    <>
      <p className={LABEL}>{t('closes')}</p>
      <div className="flex rounded-[11px] bg-[#E3E3E9] p-[2px]" role="tablist">
        {opts.map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={kind === v} onClick={() => pick(v)}
            className={cn('min-h-[38px] flex-1 rounded-[9px] px-1 text-[13px] font-semibold', kind === v ? 'bg-white font-bold text-ink-900 shadow-[0_2px_6px_rgba(0,0,0,0.08)]' : 'text-ink-500')}>
            {l}
          </button>
        ))}
      </div>
      {kind !== 'none' && (
        <div className="flex gap-2">
          {/* Editing either one makes it a date of their own; the buttons above only fill these. */}
          <input type="date" value={date} onChange={(e) => onChange({ kind: 'date', date: e.target.value, time })} aria-label={t('closesDate')}
            className={cn(CARD, 'min-h-[48px] flex-[3] px-3 text-[15.5px] font-bold text-ink-900 outline-none')} />
          <input type="time" value={time} onChange={(e) => onChange({ kind: 'date', date, time: e.target.value })} aria-label={t('closesTime')}
            className={cn(CARD, 'min-h-[48px] flex-[2] px-3 text-[15.5px] font-bold text-ink-900 outline-none')} />
        </div>
      )}
    </>
  );
}

export interface RemindersValue { picked: ReminderKey[]; custom: string[] }
/** Ticked by default: a week, 24 hours and an hour before (Ofer, 2026-10-20). */
export const DEFAULT_REMINDERS: RemindersValue = { picked: ['week', 'day', 'hour'], custom: [] };

/** The custom inputs hold an Israel "YYYY-MM-DDTHH:MM"; the request carries instants. */
export function customInstants(custom: string[]): string[] {
  return custom.map((c) => israelLocalToIso(c.slice(0, 10), c.slice(11, 16))).filter((x): x is string => !!x);
}

export function ReminderSetting({ closesAt, value, onChange }: { closesAt: string | null; value: RemindersValue; onChange: (v: RemindersValue) => void }) {
  const t = useTranslations('publish');
  const when = useWhen();
  const planned = useMemo(() => planReminders(closesAt, REMINDER_KEYS, []), [closesAt]);
  // One at a time: planReminders sorts and folds, and each row needs its own answer.
  const customPlanned = useMemo(() => value.custom.map((c) => {
    const at = customInstants([c])[0];
    return at ? planReminders(closesAt, [], [at])[0] : undefined;
  }), [closesAt, value.custom]);
  if (!closesAt) {
    return (
      <>
        <p className={LABEL}>{t('remindersTitle')}</p>
        <div className={cn(CARD, 'px-4 py-3 text-13 text-ink-500')}>{t('remindersNeedClose')}</div>
      </>
    );
  }
  const toggle = (k: ReminderKey) => onChange({ ...value, picked: value.picked.includes(k) ? value.picked.filter((x) => x !== k) : [...value.picked, k] });
  return (
    <>
      <p className={LABEL}>{t('remindersTitle')} · <span className="font-semibold">{t('remindersSub')}</span></p>
      <div className={CARD}>
        {REMINDER_KEYS.map((k) => {
          const p = planned.find((r) => r.key === k);
          const on = value.picked.includes(k) && !p?.skip;
          return (
            <button key={k} type="button" disabled={!p || p.skip} onClick={() => toggle(k)} aria-pressed={on}
              className={cn('flex min-h-[54px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 text-start last:border-0', (!p || p.skip) && 'opacity-45')}>
              <span className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border-2 text-[13px] font-black text-white', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300')}>{on ? '✓' : ''}</span>
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-semibold text-ink-900">{t(`reminder_${k}` as 'reminder_week')}</b>
                <small className="block text-[12px] text-ink-400">
                  {p ? (p.skip ? t('reminderPast') : <><bdi dir="ltr">{when(p.at)}</bdi>{p.moved ? ` · ${t('reminderMoved')}` : ''}</>) : ''}
                </small>
              </span>
            </button>
          );
        })}
        {value.custom.map((c, i) => {
          const p = customPlanned[i];
          return (
            <div key={i} className={cn('flex min-h-[54px] items-center gap-2 border-b border-[#EFEFF4] px-4 last:border-0', p?.skip && 'opacity-45')}>
              <input type="datetime-local" value={c} onChange={(e) => onChange({ ...value, custom: value.custom.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={t('reminderCustom')}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink-900 outline-none" />
              {p?.skip && <small className="text-[12px] text-ink-400">{t('reminderPast')}</small>}
              {p?.moved && !p.skip && <small className="text-[12px] text-ink-400">{t('reminderMoved')}</small>}
              <button type="button" aria-label={t('removeOption')} onClick={() => onChange({ ...value, custom: value.custom.filter((_, j) => j !== i) })} className="grid h-10 w-10 place-items-center text-ink-300"><X className="h-4 w-4" /></button>
            </div>
          );
        })}
        {value.custom.length < 3 && (
          <button type="button" onClick={() => {
            const x = israelDateTime(new Date(Date.parse(closesAt) - 3 * 3600_000).toISOString());
            onChange({ ...value, custom: [...value.custom, `${x.date}T${x.time}`] });
          }} className="flex min-h-[50px] w-full items-center gap-2 px-4 text-[15px] font-bold text-brand-600">
            <Plus className="h-4 w-4" />{t('reminderCustom')}
          </button>
        )}
      </div>
    </>
  );
}
