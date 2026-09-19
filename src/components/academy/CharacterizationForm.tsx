'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { formatTime, parseTime } from '@/lib/academy/benchmark';
import {
  DAY_LABELS,
  FIELD_LABELS,
  FIT_OPTIONS,
  GOAL_TYPES,
  characterizationIssues,
  emptyCharacterization,
  type Characterization,
  type CharacterizationIssue,
  type Fit,
  type GoalType,
} from '@/lib/academy/characterization';

/**
 * The characterization call, as a form that can be filled WHILE talking.
 *
 * This is funnel step 3, and the mockup's caption is the whole brief:
 * `שדה חופשי אחד בלבד (מגבלות). כל השאר בחירות — כדי שאפשר יהיה למלא את זה בזמן השיחה עצמה`.
 * Every decision below follows from those two facts — a phone call is happening, and the
 * answers become the first training plan:
 *
 *  - **Chips and not text, everywhere except the limitation.** A field that needs typing does
 *    not get filled during a conversation; it gets filled afterwards, from memory, or never.
 *
 *  - **It saves itself.** There is no save button for the answers, because a call that ends
 *    abruptly (and they do) must not lose twenty minutes of them. The footer says
 *    `נשמר אוטומטית`, which is a statement about the form and not a toast about the last write.
 *
 *  - **A warning is never a block.** `נפח 350` is probably a typo and says so, but the coach is
 *    allowed to have heard something surprising. Nothing here refuses a keystroke — the checks
 *    live in `lib/academy/characterization.ts` and are shown, not enforced.
 *
 *  - **Finishing the call goes through the funnel's own step request**, the same one the card's
 *    `בוצע` button makes. `onComplete` is that call. Two doors into one stage is how a board
 *    starts disagreeing with itself about which column somebody is in.
 *
 * Not built, deliberately: the mockup's `שלח הזמנה` button. That is an outward-facing send — a
 * real invitation to a real person — and it belongs with the invitation flow rather than being
 * smuggled in as a footer button on a form.
 */

/** 48 and not 44 on every tappable here. The audit's tap probe reads a 44px target as 41.5 —
 *  the outermost pixel and a half does not answer a tap, which on a target sized exactly to
 *  Apple's floor puts it under the floor. This form is nothing but tap targets. */
const CHIP = 'h-12 rounded-pill px-3.5 text-sm font-bold transition-colors';
const CHIP_ON = 'bg-brand-600 text-white';
const CHIP_OFF = 'bg-page text-ink-700';

/** 16px or iOS Safari zooms the whole page the moment a field is focused. */
const INPUT = 'w-full min-h-[44px] rounded-card bg-page px-3 text-[16px] text-ink-900 placeholder:text-ink-400';

const LABEL = 'mb-1.5 block text-[11px] font-semibold text-ink-500';

/** The distances somebody quotes a personal best at, in metres. */
const PR_DISTANCES: readonly { value: number; label: string }[] = [
  { value: 5000, label: '5 ק״מ' },
  { value: 10000, label: '10 ק״מ' },
  { value: 21097, label: 'חצי מרתון' },
  { value: 42195, label: 'מרתון' },
] as const;

function Section({ label, children, issue }: { label: string; children: React.ReactNode; issue?: CharacterizationIssue }) {
  return (
    <div className="mt-4">
      <span className={LABEL} dir="auto">{label}</span>
      {children}
      {/* The warning sits under the field it is about, and reads as a check rather than as an
          error: ink, one icon, no red fill. A form that shouts mid-call gets closed. */}
      {issue?.level === 'warning' && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-accent-red-ink" dir="auto">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {issue.text}
        </p>
      )}
    </div>
  );
}

export function CharacterizationForm({
  candidateId,
  value,
  onSave,
  onComplete,
  completed,
  busy,
  today,
}: {
  candidateId: string;
  /** What was saved before, or null for a call nobody has had yet. */
  value: Characterization | null;
  /** Autosave. Called with the whole form, debounced; resolves false if the write failed. */
  onSave: (next: Characterization) => Promise<boolean>;
  /** Records funnel step `characterization` — the SAME request the card's `בוצע` button makes. */
  onComplete?: () => void;
  /** Whether that step is already recorded, in which case the button becomes a statement. */
  completed?: boolean;
  busy?: boolean;
  /**
   * Today, for the one check that needs it (`תאריך התחרות כבר עבר`). A prop and not
   * `new Date()` inside the render so a preview can pin it — a screen whose warning depends on
   * the machine's clock is a screen the audit cannot screenshot twice and get the same picture.
   */
  today?: string;
}) {
  const [form, setForm] = useState<Characterization>(value ?? emptyCharacterization(candidateId));
  // The PR time is held as the coach's own typing (`48:30`) and parsed on the way out. Holding
  // only the parsed seconds would rewrite the field under the cursor: `4` becomes `0:04`.
  const [prTime, setPrTime] = useState(value?.prTimeSec ? formatTime(value.prTimeSec) : '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle');

  // A different candidate is a different call. The sheet stays mounted, so without this the
  // second person characterised in a sitting inherits the first one's injuries.
  useEffect(() => {
    setForm(value ?? emptyCharacterization(candidateId));
    setPrTime(value?.prTimeSec ? formatTime(value.prTimeSec) : '');
    setStatus('idle');
  }, [candidateId, value]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * Every change goes through here: update the form, then schedule one save.
   *
   * Debounced rather than saved per keystroke, and the timer is RESET on each change — so
   * typing a sentence about an Achilles is one write and not forty. 900ms is short enough that
   * a call ending abruptly loses at most the last word.
   */
  const change = useCallback((patch: Partial<Characterization>) => {
    setForm(prev => {
      const next = { ...prev, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setStatus('saving');
        void onSave(next).then(ok => setStatus(ok ? 'idle' : 'failed'));
      }, 900);
      return next;
    });
  }, [onSave]);

  const issues = useMemo(
    () => characterizationIssues(form, today ?? new Date().toISOString()),
    [form, today],
  );
  const issueFor = (field: keyof Characterization) => issues.find(i => i.field === field);
  const missing = issues.filter(i => i.level === 'missing');

  const toggleDay = (day: number) => {
    const has = form.availableDays.includes(day);
    change({
      availableDays: has
        ? form.availableDays.filter(d => d !== day)
        : [...form.availableDays, day].sort((a, b) => a - b),
    });
  };

  return (
    <div className="px-4 pb-6">
      <Section label="מה הוא רוצה" issue={issueFor('goalType')}>
        <div className="flex flex-wrap gap-2">
          {GOAL_TYPES.map(g => (
            <button
              key={g.value}
              type="button"
              aria-pressed={form.goalType === g.value}
              // Tapping the chosen one again clears it, which is the only way back from a
              // mis-tap in a control with no empty option of its own.
              onClick={() => change({ goalType: form.goalType === g.value ? null : (g.value as GoalType) })}
              className={cn(CHIP, form.goalType === g.value ? CHIP_ON : CHIP_OFF)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </Section>

      <div className="mt-4 flex gap-2">
        <label className="flex-1 min-w-0">
          <span className={LABEL} dir="auto">תחרות מטרה</span>
          <input
            value={form.targetRace ?? ''}
            onChange={e => change({ targetRace: e.target.value || null })}
            placeholder="טבריה"
            className={INPUT}
            dir="auto"
          />
        </label>
        <label className="w-[9.5rem] shrink-0">
          <span className={LABEL} dir="auto">תאריך</span>
          {/* A native date input, so the value is always a real `YYYY-MM-DD` — the DATE column
              takes nothing else, and a typed `10.01.27` is both ambiguous and a 500. */}
          <input
            type="date"
            value={form.targetRaceDate ?? ''}
            onChange={e => change({ targetRaceDate: e.target.value || null })}
            className={cn(INPUT, 'h-11')}
            dir="ltr"
          />
        </label>
      </div>
      {issueFor('targetRaceDate') && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-accent-red-ink" dir="auto">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {issueFor('targetRaceDate')!.text}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <label className="flex-1 min-w-0">
          <span className={LABEL} dir="auto">נפח נוכחי · ק״מ בשבוע</span>
          <input
            type="number"
            inputMode="numeric"
            value={form.weeklyKm ?? ''}
            onChange={e => change({ weeklyKm: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="35"
            className={INPUT}
            dir="ltr"
          />
        </label>
        <label className="flex-1 min-w-0">
          <span className={LABEL} dir="auto">שנות ריצה</span>
          <input
            type="number"
            inputMode="numeric"
            value={form.yearsRunning ?? ''}
            onChange={e => change({ yearsRunning: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="2"
            className={INPUT}
            dir="ltr"
          />
        </label>
      </div>
      {(issueFor('weeklyKm')?.level === 'warning' || issueFor('yearsRunning')) && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-accent-red-ink" dir="auto">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {(issueFor('weeklyKm')?.level === 'warning' ? issueFor('weeklyKm') : issueFor('yearsRunning'))!.text}
        </p>
      )}

      <Section label="ימים זמינים לאימון" issue={issueFor('availableDays')}>
        {/* Four and three, in a fixed grid rather than a wrapping row.
            Seven across does not fit: inside the drawer's own padding the form has 304px on
            the 375 phone, and the audit measured each of the seven day chips at 40px wide —
            four under Apple's floor, on the control that gets tapped more than anything else
            on this screen. A wrapping row would fit but would break 4+3 on one phone and 5+2
            on another, and a week that changes shape cannot be scanned; `grid-cols-4` is
            always the same two rows, which for א׳-ש׳ is also where a Hebrew week splits. */}
        <div className="grid grid-cols-4 gap-1.5">
          {DAY_LABELS.map((label, day) => {
            const on = form.availableDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={`יום ${label}`}
                onClick={() => toggleDay(day)}
                className={cn('h-12 rounded-card text-sm font-bold transition-colors', on ? CHIP_ON : CHIP_OFF)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="פציעות / מגבלות">
        {/* The one free-text field in the form, and the most load-bearing answer in it: it is
            what keeps somebody off intervals for a month, and it travels verbatim into the
            plan composer. A textarea and not an input — the useful answers are sentences. */}
        <textarea
          value={form.limitations ?? ''}
          onChange={e => change({ limitations: e.target.value || null })}
          // The only field here whose label is not a `<label>` around it — the section header
          // is shared with the chip groups, where wrapping buttons in a label is wrong — so it
          // carries its own name. Without one a screen reader announces the placeholder, and a
          // placeholder disappears the moment anybody types.
          aria-label="פציעות או מגבלות"
          rows={2}
          placeholder="דלקת בגיד אכילס לפני חצי שנה"
          className={cn(INPUT, 'py-2.5 leading-relaxed resize-none')}
          dir="auto"
        />
      </Section>

      <div className="mt-4 flex gap-2">
        <label className="flex-1 min-w-0">
          <span className={LABEL} dir="auto">שעון</span>
          <input
            value={form.watch ?? ''}
            onChange={e => change({ watch: e.target.value || null })}
            placeholder="Garmin"
            className={INPUT}
            dir="auto"
          />
        </label>
        <label className="w-[6.5rem] shrink-0">
          <span className={LABEL} dir="auto">שיא · מרחק</span>
          {/* A native select needs an explicit height; without one it renders shorter than
              every input beside it and under the tap floor. */}
          <select
            value={form.prDistanceM ?? ''}
            onChange={e => change({ prDistanceM: e.target.value === '' ? null : Number(e.target.value) })}
            className={cn(INPUT, 'h-11')}
            dir="auto"
          >
            <option value="">—</option>
            {PR_DISTANCES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="w-[5.5rem] shrink-0">
          <span className={LABEL} dir="auto">זמן</span>
          <input
            value={prTime}
            onChange={e => {
              setPrTime(e.target.value);
              // Parsed on the way out, so the field holds what was typed and the row holds
              // seconds. `parseTime` already accepts `48:30`, `48:30.4` and bare seconds.
              change({ prTimeSec: parseTime(e.target.value) });
            }}
            placeholder="48:30"
            className={INPUT}
            dir="ltr"
          />
        </label>
      </div>
      {issueFor('prTimeSec') && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-accent-red-ink" dir="auto">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {issueFor('prTimeSec')!.text}
        </p>
      )}

      <Section label="התאמה — ההתרשמות שלך" issue={issueFor('fit')}>
        <div className="flex gap-2">
          {FIT_OPTIONS.map(f => (
            <button
              key={f.value}
              type="button"
              aria-pressed={form.fit === f.value}
              onClick={() => change({ fit: form.fit === f.value ? null : (f.value as Fit) })}
              className={cn(CHIP, 'flex-1 min-w-0', form.fit === f.value ? CHIP_ON : CHIP_OFF)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Section>

      {/* The greybox from the mockup, kept because it is the reason the form is shaped this
          way: these answers are not a record of a conversation, they are the input to the
          first week of training. */}
      <p className="mt-5 rounded-card bg-page px-3 py-2.5 text-xs leading-relaxed text-ink-500" dir="auto">
        הטופס הזה הוא גם הקלט לתוכנית הראשונה: הימים הזמינים, המגבלה הפיזית ותאריך התחרות זורמים ישר למחבר התוכניות.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-400" dir="auto">
          {status === 'saving' ? 'שומר…' : status === 'failed' ? 'השמירה נכשלה — נסה שוב' : 'נשמר אוטומטית'}
        </span>
        {completed ? (
          <span className="text-xs font-bold text-accent-700" dir="auto">שיחת האפיון נרשמה</span>
        ) : onComplete && (
          <button
            type="button"
            onClick={onComplete}
            disabled={busy}
            // NOT disabled on a half-filled form. A call that really happened — the person had
            // to go, the coach ran out of time — must be recordable, and the card's `בוצע`
            // button would record it in one tap anyway. Refusing here would only mean the
            // funnel column disagreed with reality while every field stayed empty.
            className="h-12 shrink-0 rounded-pill bg-accent-700 px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            סיום שיחת אפיון
          </button>
        )}
      </div>
      {!completed && missing.length > 0 && (
        // What is still blank, said once and plainly — not as an error, and not as a blocker.
        <p className="mt-2 text-xs text-ink-400" dir="auto">
          חסר: {missing.map(i => FIELD_LABELS[i.field] ?? i.text).join(' · ')}
        </p>
      )}
    </div>
  );
}

/** The form in a drawer, opened from the candidate's card. */
export function CharacterizationSheet({
  open,
  onOpenChange,
  candidateName,
  ...rest
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName: string;
} & React.ComponentProps<typeof CharacterizationForm>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`אפיון · ${candidateName}`}>
      <CharacterizationForm {...rest} />
    </Sheet>
  );
}
