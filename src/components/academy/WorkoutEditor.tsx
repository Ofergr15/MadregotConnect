'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  LIBRARY_KINDS,
  ZONE_INTENSITY,
  entryHeadline,
  entryShape,
  entryVolume,
  isLibraryKind,
  resolveIntensity,
  type LibraryEntry,
  type LibraryKind,
  type LibraryScope,
  type LibraryStep,
} from '@/lib/academy/library';
import {
  DRAFT_ZONES,
  blankStep,
  draftProblem,
  fromLibrarySteps,
  toLibrarySteps,
  type DraftMeasure,
  type DraftProblem,
  type DraftStep,
  type DraftZone,
} from '@/lib/academy/library-draft';
import { KIND_LABEL, ZONE_LABEL } from './libraryText';

// ── אימון חדש ────────────────────────────────────────────────────────────────
//
// The form behind the mockup's footer button, and the reason the book can fill up at all.
//
// It has NO PACE FIELD, and that is the design rather than a limitation. The effort is picked
// from six words; `toLibrarySteps` is the only thing that turns a word into the percentages
// stored on the step; and the pace a trainee runs does not exist until one is pushed. A coach
// who could type `4:05` here would have written a workout for exactly one runner, which is the
// thing the whole feature exists to stop — so the field simply is not on the screen.
//
// The one concession to that: `דוגמה` at the bottom resolves the whole draft against a 5:00
// threshold, labelled as an example. A coach cannot otherwise check that `קל` means what they
// think, and "92% is slower, not faster" is the kind of claim that has to be visible to be
// believed.

const HELP: Record<DraftProblem, string> = {
  'no-name': 'לאימון צריך שם — זה מה שתחפש בספר.',
  'no-steps': 'הוסף לפחות צעד אחד.',
  'zero-value': 'יש צעד בלי אורך.',
  'zero-count': 'סדרה היא שתי חזרות ומעלה.',
  'hr-band': 'טווח הדופק הפוך — המספר הראשון נמוך מהשני.',
};

const STEP_LABEL: Record<DraftStep['kind'], string> = {
  easy: 'ריצה קלה',
  continuous: 'בלוק רצוף',
  reps: 'סדרה',
  hr: 'בלוק דופק',
};

export interface WorkoutDraftPayload {
  name: string;
  kind: LibraryKind;
  scope: LibraryScope;
  notes: string | null;
  steps: LibraryStep[];
}

/**
 * The editor. `initial` is an existing entry being edited or a duplicate being renamed;
 * absent means a blank new workout.
 *
 * `onSave` gets the payload the route expects. Saving itself is the caller's, so this
 * component stays mountable in the preview harness with no network at all.
 */
export function WorkoutEditor({
  initial,
  canWriteCanon,
  saving,
  error,
  onSave,
  onArchive,
  onCancel,
}: {
  initial?: Pick<LibraryEntry, 'name' | 'kind' | 'notes' | 'steps' | 'scope'>;
  canWriteCanon: boolean;
  saving?: boolean;
  error?: string | null;
  onSave: (payload: WorkoutDraftPayload) => void;
  /** Absent on a new workout. Archives, never deletes — see the button's own note. */
  onArchive?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<LibraryKind>(initial?.kind ?? 'intervals');
  const [scope, setScope] = useState<LibraryScope>(initial?.scope ?? 'mine');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [showExample, setShowExample] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // `null` means this entry holds something the form cannot draw. Computed once, from the
  // entry it was opened on — see `fromLibrarySteps`: showing a simplified version of it and
  // then saving that back would delete the parts the form did not understand.
  const loaded = useMemo(
    () => (initial ? fromLibrarySteps(initial.steps) : []),
    [initial],
  );
  const [draft, setDraft] = useState<DraftStep[]>(loaded ?? []);

  const steps = useMemo(() => toLibrarySteps(draft), [draft]);
  const problem = draftProblem(name, draft);

  if (loaded === null) {
    return (
      <div className="space-y-3 rounded-card bg-card p-3.5" dir="rtl">
        <Head title="עריכת אימון" onCancel={onCancel} />
        {/* The name, because without it the refusal is about an unnamed workout: tapping the
            wrong row and reading this would leave the coach with no way to tell which entry
            it is talking about. */}
        <p className="text-sm font-bold text-ink-900" dir="auto">{initial?.name}</p>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-band-3-ink">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            האימון הזה בנוי ממבנה שהעורך הזה לא יודע לצייר (למשל סולם, או צעד עם הערה משלו).
            פתיחה שלו כאן היתה מראה אותו פשוט יותר ממה שהוא — ושמירה היתה מוחקת את מה שלא הוצג.
            {/* `מהרשימה`, because the copy control is on the row and not here: telling a coach
                to duplicate on a screen with no duplicate button is a worse dead end than the
                refusal itself. */}
            {' '}הוא נשאר כמו שהוא; אפשר לשכפל אותו מהרשימה ולבנות גרסה חדשה.
          </span>
        </p>
        {/* Still archivable. Taking an entry off the shelf does not require understanding its
            steps, and a row nobody can edit and nobody can retire is a row that stays. */}
        <ArchiveButton
          onArchive={onArchive}
          armed={confirmArchive}
          onArm={setConfirmArchive}
          busy={!!saving}
        />
      </div>
    );
  }

  const shape = entryShape(steps);
  const volume = entryVolume(steps);
  const headline = entryHeadline(steps);

  const set = (index: number, next: DraftStep) =>
    setDraft(draft.map((s, i) => (i === index ? next : s)));

  return (
    <div className="space-y-3 rounded-card bg-card p-3.5" dir="rtl">
      <Head title={initial ? 'עריכת אימון' : 'אימון חדש'} onCancel={onCancel} />

      <Field label="שם האימון">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="אינטרוולים קלאסי"
          className={INPUT}
        />
      </Field>

      <Field label="סוג">
        <div className="flex flex-wrap gap-1.5">
          {LIBRARY_KINDS.map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={cn(
                'h-11 min-w-[44px] rounded-pill px-3 text-[13px] font-semibold',
                kind === value ? 'bg-brand-600 text-white' : 'bg-page text-ink-700',
              )}
            >
              {KIND_LABEL[value]}
            </button>
          ))}
        </div>
      </Field>

      {/* Only for whoever may write the canon. A mentor sees no shelf picker at all, rather
          than one that takes the choice and then fails on save with a 403. */}
      {canWriteCanon && (
        <Field label="מדף">
          <div className="flex gap-1.5">
            {(['mine', 'academy'] as LibraryScope[]).map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                aria-pressed={scope === value}
                className={cn(
                  'h-11 flex-1 rounded-pill px-3 text-[13px] font-semibold',
                  scope === value ? 'bg-brand-600 text-white' : 'bg-page text-ink-700',
                )}
              >
                {value === 'mine' ? 'שלי' : 'ספר האקדמיה'}
              </button>
            ))}
          </div>
          {scope === 'academy' && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
              כל המלווים יראו את האימון הזה וידחפו ממנו. זה מה שהופך אותו לאימון מאושר.
            </p>
          )}
        </Field>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-ink-500">מבנה האימון</p>
        {draft.map((step, index) => (
          <StepCard
            key={index}
            step={step}
            onChange={next => set(index, next)}
            onRemove={() => setDraft(draft.filter((_, i) => i !== index))}
          />
        ))}

        <div className="flex flex-wrap gap-1.5">
          {(['easy', 'reps', 'continuous', 'hr'] as DraftStep['kind'][]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setDraft([...draft, blankStep(k)])}
              className="flex h-11 items-center gap-1 rounded-pill bg-page px-3 text-[13px] font-semibold text-brand-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {STEP_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <Field label="הערה (לא חובה)">
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="מסלול, מה להדגיש"
          className={INPUT}
        />
        {/* Said out loud, because a note IS the place a coach would write one, and the save
            refuses on it — which without this line reads as the form breaking on valid input. */}
        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
          בלי קצבים בהערה. הקצב נגזר לכל מתאמן מהטסט שלו, והערה עם <bdi dir="ltr">4:05</bdi>{' '}
          מודפסת על השעון כמו שהיא.
        </p>
      </Field>

      {/* How the row will read in the book. The list line is entirely derived, so this is the
          only way to see what you just wrote before it is on the shelf. */}
      {draft.length > 0 && (
        <div className="rounded-card bg-page px-3 py-2.5">
          <p className="text-[11px] font-semibold text-ink-500">כך זה ייראה בספר</p>
          <p className="mt-1 text-sm font-bold text-ink-900" dir="auto">{name || 'ללא שם'}</p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            {shape?.kind === 'reps' && <><bdi dir="ltr">{shape.count}×{shape.distanceM}</bdi> · </>}
            {shape?.kind === 'hr' && <>דופק · </>}
            {volume.durationSec > 0
              ? <><bdi dir="ltr">{Math.round(volume.durationSec / 60)}</bdi> דק׳ · </>
              : volume.distanceM > 0 ? <><bdi dir="ltr">{(volume.distanceM / 1000).toFixed(1)}</bdi> ק״מ · </> : null}
            {headline?.kind === 'effort' && headline.zone && ZONE_LABEL[headline.zone]}
            {headline?.kind === 'hr' && <>דופק <bdi dir="ltr">{headline.minPct}–{headline.maxPct}%</bdi></>}
          </p>
        </div>
      )}

      {draft.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowExample(v => !v)}
            aria-expanded={showExample}
            className="flex min-h-[44px] w-full items-center justify-between text-[11px] font-semibold text-brand-600"
          >
            {/* The whole sentence in ONE span. `justify-between` spreads flex CHILDREN, and
                the `<bdi>` around the pace is a child — so the label rendered as three pieces
                pushed to the corners of the row: `דוגמה: מתאמן שהסף שלו · 5:00 · לק״מ`. */}
            <span>דוגמה: מתאמן שהסף שלו <bdi dir="ltr">5:00</bdi> לק״מ</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', showExample && 'rotate-180')} />
          </button>
          {showExample && <Example draft={draft} />}
        </div>
      )}

      {error && <Note>{error}</Note>}
      {!error && problem && <Note>{HELP[problem]}</Note>}

      <button
        type="button"
        disabled={!!problem || !!saving}
        onClick={() => onSave({
          name: name.trim(),
          kind: isLibraryKind(kind) ? kind : 'easy',
          scope,
          notes: notes.trim() || null,
          steps,
        })}
        className={cn(
          'min-h-[44px] w-full rounded-card text-sm font-bold',
          !problem && !saving ? 'bg-brand-600 text-white' : 'bg-page text-ink-400',
        )}
      >
        {saving ? 'שומר…' : 'שמירה בספר'}
      </button>

      <ArchiveButton
        onArchive={onArchive}
        armed={confirmArchive}
        onArm={setConfirmArchive}
        busy={!!saving}
      />
    </div>
  );
}

/**
 * Taking an entry off the shelf.
 *
 * Archive and not delete, and the wording says so: the entry is referenced by every plan it
 * was ever pushed into, and those plans have to keep resolving. `הוצאה מהספר` is what actually
 * happens — it stops being offered, and nothing already sent changes.
 *
 * Two taps, because it is the one irreversible-looking control on the screen and it sits
 * directly under שמירה. The second tap is the one that says what it will do.
 */
function ArchiveButton({
  onArchive, armed, onArm, busy,
}: {
  onArchive?: () => void;
  armed: boolean;
  onArm: (next: boolean) => void;
  busy: boolean;
}) {
  if (!onArchive) return null;
  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => onArm(true)}
        className="min-h-[44px] w-full text-[11px] font-semibold text-ink-400"
      >
        הוצאה מהספר
      </button>
    );
  }
  return (
    <div className="space-y-1.5 rounded-card bg-page p-2.5">
      <p className="text-[11px] leading-relaxed text-ink-700">
        האימון יפסיק להופיע בספר. תוכניות שכבר נשלחו לא משתנות.
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onArchive}
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-card bg-accent-red-ink text-[13px] font-bold text-white"
        >
          {busy ? 'מוציא…' : 'להוציא מהספר'}
        </button>
        <button
          type="button"
          onClick={() => onArm(false)}
          className="min-h-[44px] flex-1 rounded-card bg-card text-[13px] font-semibold text-ink-700"
        >
          להשאיר
        </button>
      </div>
    </div>
  );
}

/** One editable step. The fields differ per kind; the frame does not. */
function StepCard({
  step,
  onChange,
  onRemove,
}: {
  step: DraftStep;
  onChange: (next: DraftStep) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-card bg-page p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-ink-700">{STEP_LABEL[step.kind]}</p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`הסרת ${STEP_LABEL[step.kind]}`}
          className="flex h-11 w-11 items-center justify-center text-ink-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {step.kind === 'easy' && (
          <>
            <Sel
              label="מתי"
              value={step.role}
              onChange={v => onChange({ ...step, role: v === 'cooldown' ? 'cooldown' : 'warmup' })}
              options={[['warmup', 'חימום'], ['cooldown', 'שחרור']]}
            />
            <Num label="ק״מ" value={step.metres / 1000} step={0.5}
                 onChange={v => onChange({ ...step, metres: Math.round(v * 1000) })} />
          </>
        )}

        {step.kind === 'continuous' && (
          <>
            <MeasureField
              label="אורך"
              measure={step.measure}
              value={step.value}
              longUnits
              onValue={value => onChange({ ...step, value })}
              // Re-based, not carried across: 1200 metres is not 1200 seconds, and a silent
              // unit change is how a 20-minute tempo becomes a 1.2 km jog.
              onMeasure={measure => onChange({ ...step, measure, value: measure === 'distance' ? 5000 : 1200 })}
            />
            <ZoneSel
              value={step.zone}
              allowNone
              onChange={zone => onChange({ ...step, zone })}
            />
          </>
        )}

        {step.kind === 'reps' && (
          <>
            <Num label="חזרות" value={step.count} step={1}
                 onChange={v => onChange({ ...step, count: Math.round(v) })} />
            <MeasureField
              label="אורך"
              measure={step.measure}
              value={step.value}
              onValue={value => onChange({ ...step, value })}
              onMeasure={measure => onChange({ ...step, measure, value: measure === 'time' ? 180 : 1000 })}
            />
            <ZoneSel value={step.zone} onChange={zone => onChange({ ...step, zone: zone ?? 'interval' })} />
            <Num label="מנוחה (שנ׳)" value={step.restSec} step={30}
                 onChange={v => onChange({ ...step, restSec: Math.max(0, Math.round(v)) })} />
          </>
        )}

        {step.kind === 'hr' && (
          <>
            <Num label="דקות" value={step.seconds / 60} step={1}
                 onChange={v => onChange({ ...step, seconds: Math.round(v * 60) })} />
            {/* Percent of max heart rate, not bpm — for the same reason the efforts are
                percentages of threshold: one entry is read by every trainee. Both labels
                carry the unit: `% דופק מ־` beside a bare `עד` read as a range of something
                unnamed, and the number a coach nearly types here is a bpm. */}
            <Num label="דופק מ־ (%)" value={step.minPct} step={1}
                 onChange={v => onChange({ ...step, minPct: Math.round(v) })} />
            <Num label="עד (%)" value={step.maxPct} step={1}
                 onChange={v => onChange({ ...step, maxPct: Math.round(v) })} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The draft resolved against one threshold, as an example.
 *
 * 5:00/km, stated in the toggle above it. A fixed example rather than a picked trainee: the
 * point is to show that the WORDS mean what the coach thinks — that `קל` came out slower than
 * threshold and `אינטרוולים` faster — and a real trainee's number here would read as a
 * prescription and be copied into a plan by hand.
 */
function Example({ draft }: { draft: DraftStep[] }) {
  const rows = draft.flatMap<{ key: number; label: string; pace: string | null }>((step, index) => {
    const zone: DraftZone | null = step.kind === 'easy' ? 'easy'
      : step.kind === 'continuous' ? step.zone
      : step.kind === 'reps' ? step.zone
      : null;
    if (!zone) {
      return step.kind === 'hr'
        ? [{ key: index, label: `דופק ${step.minPct}–${step.maxPct}%`, pace: null }]
        : [{ key: index, label: 'בלי יעד', pace: null }];
    }
    const { min, max } = resolveIntensity(300, ZONE_INTENSITY[zone]);
    return [{ key: index, label: ZONE_LABEL[zone] ?? zone, pace: `${mmss(min)}–${mmss(max)}` }];
  });

  return (
    <div className="space-y-1 rounded-card bg-page px-3 py-2.5">
      {rows.map(row => (
        <p key={row.key} className="flex items-center justify-between text-[11px] text-ink-700">
          <span>{row.label}</span>
          <span className="tabular-nums text-ink-500">
            {row.pace ? <bdi dir="ltr">{row.pace}</bdi> : '—'}
          </span>
        </p>
      ))}
      <p className="pt-1 text-[11px] leading-relaxed text-ink-400">
        לכל מתאמן זה יוצא אחרת. אימון בספר לא מחזיק קצב — הוא מחזיק אחוז מהסף.
      </p>
    </div>
  );
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Head({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      <button
        type="button"
        onClick={onCancel}
        aria-label="ביטול"
        className="flex h-11 w-11 items-center justify-center text-ink-400"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// 16px on every field, or iOS Safari zooms the whole page the moment one takes focus. And an
// explicit `h-11` on the selects: WebKit lays a native select out from its own metrics and
// does not grow it to satisfy a `min-height` — see the same note in RecordTest.
const INPUT = 'w-full min-h-[44px] rounded-card bg-page px-3 text-[16px] text-ink-900 placeholder:text-ink-400';
const SMALL_INPUT = 'h-11 w-20 rounded-card bg-card px-2 text-center text-[16px] tabular-nums text-ink-900';
const SELECT = 'h-11 rounded-card bg-card px-2 text-[16px] text-ink-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function Num({
  label, value, step, onChange,
}: {
  label: string; value: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-500">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={e => {
          const next = Number(e.target.value);
          // A cleared field reads as 0 and not as the previous value: the save is blocked on
          // a zero with a reason printed, whereas silently keeping the old number means the
          // coach saved a figure they had just deleted.
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className={SMALL_INPUT}
      />
    </label>
  );
}

/**
 * A length and its unit as one field.
 *
 * Two fields is what this was, and the screenshot was the argument: a separate `נמדד ב` select
 * beside a number labelled with the unit printed the word twice on the same line —
 * `נמדד ב: מטרים` then `מטרים: 1000` — on a row that already carries four other fields. One
 * label, `אורך`, and the unit is the control next to the number rather than a caption above it.
 *
 * The stored value is always metres or seconds; only the display converts. `longUnits` is
 * kilometres-and-minutes for a continuous block (a 12 km long run), against metres-and-minutes
 * for reps (a 400) — the same quantity, written the way a coach writes each one.
 */
function MeasureField({
  label, measure, value, longUnits, onValue, onMeasure,
}: {
  label: string;
  measure: DraftMeasure;
  value: number;
  longUnits?: boolean;
  onValue: (value: number) => void;
  onMeasure: (measure: DraftMeasure) => void;
}) {
  const unit = measure === 'time' ? 'דקות' : longUnits ? 'ק״מ' : 'מטרים';
  const factor = measure === 'time' ? 60 : longUnits ? 1000 : 1;
  return (
    <div>
      <span className="mb-1 block text-[11px] text-ink-500">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={factor === 1 ? 100 : 0.5}
          aria-label={`${label} — ${unit}`}
          value={Number.isFinite(value) ? value / factor : ''}
          onChange={e => {
            const next = Number(e.target.value);
            onValue(Number.isFinite(next) ? Math.round(next * factor) : 0);
          }}
          className={SMALL_INPUT}
        />
        <select
          value={measure}
          aria-label="יחידת מדידה"
          onChange={e => onMeasure(e.target.value === 'time' ? 'time' : 'distance')}
          className={SELECT}
        >
          <option value="distance">{longUnits ? 'ק״מ' : 'מטרים'}</option>
          <option value="time">דקות</option>
        </select>
      </div>
    </div>
  );
}

function Sel({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className={SELECT}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function ZoneSel({
  value, allowNone, onChange,
}: {
  value: DraftZone | null; allowNone?: boolean; onChange: (zone: DraftZone | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-500">מאמץ</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? (e.target.value as DraftZone) : null)}
        className={SELECT}
      >
        {allowNone && <option value="">בלי יעד</option>}
        {DRAFT_ZONES.map(zone => (
          <option key={zone} value={zone}>{ZONE_LABEL[zone] ?? zone}</option>
        ))}
      </select>
    </label>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-band-3-ink">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
