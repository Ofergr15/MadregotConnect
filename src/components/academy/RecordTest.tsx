'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Plus, X } from 'lucide-react';
import { formatPace } from '@/components/activity/format';
import { parseTime, formatTime } from '@/lib/academy/benchmark';
import { apiHeaders } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import {
  paceLooksImplausible,
  protocolShape,
  thresholdPaceSec,
} from '@/lib/academy/tests';

// ── Recording a test ─────────────────────────────────────────────────────────
//
// Without this the whole feature is dead on arrival: migration 105 is applied and the table
// is empty, the graph and the registry can only read, and the club's tests would stay in
// Excel forever. This is the door.
//
// Two ideas carry it, and both exist to stop a bad number rather than to save typing:
//
//  1. **The protocol fixes one half, so the form asks for the other one only.** A 30-minute
//     test measures a distance; a 2000m measures a clock. Asking for both is how you get a
//     row whose pace cannot be trusted because the wrong field was filled in — the exact
//     failure migration 105's header warns about. The fixed half is shown as a fact, not as
//     an editable field with a default, because a default is something a person overwrites
//     by accident and a fact is not.
//
//  2. **The threshold pace is computed as you type, and a units slip is called out.** This
//     is the single most valuable thing on the screen. A test does not just draw one point
//     on one graph — it becomes the threshold that prices every workout in that athlete's
//     plan, so `6.42` typed into a metres field would put a plan-shaping number three
//     orders of magnitude wrong into the database, and it would look perfectly ordinary in
//     a list. Seeing `4:40` appear under the field is the check; the warning is the
//     backstop. Never a block — see `PLAUSIBLE_PACE_SEC`.
//
// WHO MAY SAVE, and the route enforces all of it independently of this component: a coach
// records for their own trainees, the manager for anyone, and an academy trainee may submit
// their OWN test — which lands as `status='pending'` and counts toward nothing until staff
// approve it (migration 108). That queue is the whole reason self-submission is safe: this
// number is not a trophy like a `benchmark_results` entry, it sets someone's training paces,
// so it may not start doing that unreviewed.
//
// `selfSubmit` only changes the WORDS. A trainee is not recording a test, they are sending
// one, and a button that says "רישום" promises something the route will not do.

const PROTOCOLS: { id: string; label: string }[] = [
  { id: '30min', label: '30 דקות' },
  { id: '2000m', label: '2000 מ׳' },
  { id: '5000m', label: '5000 מ׳' },
];

export interface RecordTestCandidate {
  athleteId: string;
  name: string;
}

export function RecordTest({
  athletes,
  onSaved,
  protocol: initialProtocol = '30min',
  selfSubmit = false,
}: {
  athletes: RecordTestCandidate[];
  onSaved: () => void;
  protocol?: string;
  /** The athlete is sending their own test for approval, not recording it. Wording only. */
  selfSubmit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [protocol, setProtocol] = useState(initialProtocol);
  const [date, setDate] = useState(() => israelToday());
  // Kept as strings: a number input that clears to `0` is a field that silently agrees to
  // something the coach did not type.
  const [distanceText, setDistanceText] = useState('');
  const [durationText, setDurationText] = useState('');
  const [hrText, setHrText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  // The route answers `pending: true` when the caller was not staff, i.e. an athlete
  // submitting their own test. "נשמר" would be a lie in that case — nothing has been
  // recorded yet, it is waiting for a coach.
  const [savedPending, setSavedPending] = useState(false);

  // ── Who the test is for ────────────────────────────────────────────────────
  //
  // The candidate list is already scoped by the route — a coach is handed their own
  // trainees and nobody else's — so there is nothing to choose when it holds one person.
  // A dropdown with a single option is worse than no dropdown: it reads as a decision,
  // it starts on "בחר מתאמן…" so the save button is disabled until you make a choice
  // that has no alternatives, and it is one more tap between a coach and the number.
  // 1:1 coaching is the academy's actual shape, so this is the common case, not the edge.
  //
  // Stated as a fact, like the fixed half of the protocol above, and for the same reason:
  // a fact is not something a person overwrites by accident.
  const only = athletes.length === 1 ? athletes[0] : null;
  const athleteId = only ? only.athleteId : picked;

  const shape = protocolShape(protocol);

  // The measurement, resolved against whichever half the protocol fixed.
  const durationSec = shape?.fixed === 'duration' ? shape.value : parseTime(durationText);
  const distanceM = shape?.fixed === 'distance' ? shape.value : parseNumber(distanceText);

  // One division, computed inline. A `useMemo` here is both pointless and worse than
  // pointless: the React Compiler refuses to optimize the whole component when it cannot
  // prove a hand-written memo's dependencies are stable.
  const paceSec =
    durationSec && durationSec > 0 && distanceM && distanceM > 0
      ? thresholdPaceSec({ durationSec, distanceM })
      : null;

  const implausible = paceLooksImplausible(paceSec);
  // A test in the future has not happened yet, which is a typed year away from a typo.
  const future = date > israelToday();
  const complete = !!athleteId && !!date && !future && paceSec !== null;

  function reset() {
    setPicked('');
    setDistanceText('');
    setDurationText('');
    setHrText('');
    setNotes('');
    setError(null);
  }

  async function save() {
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    const name = athletes.find(a => a.athleteId === athleteId)?.name ?? '';
    try {
      const res = await fetch('/api/academy/tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({
          athleteId,
          date,
          protocol,
          durationSec,
          distanceM,
          avgHr: hrText.trim() ? Number(hrText) : null,
          notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ? String(data.error) : 'לא הצלחנו לשמור את הטסט');
        return;
      }
      // Named in the confirmation. A coach entering six tests in a row needs to know WHICH
      // one landed, and "נשמר" alone is the same message six times.
      setSavedName(name);
      setSavedPending(data?.pending === true);
      reset();
      setOpen(false);
      onSaved();
    } catch {
      setError('לא הצלחנו לשמור את הטסט');
    } finally {
      setSaving(false);
    }
  }

  // Nothing to record a test AGAINST. Found on the real dashboard, where the academy roster
  // is empty: the form opened anyway, offering an empty picker above a save button that could
  // never enable, and the panel below it already said there are no trainees. A form for
  // nobody reads as a broken form — the honest screen says what is missing, and that is the
  // list's job (see `RegistryList`), not a second copy of the same sentence up here.
  if (athletes.length === 0) return null;

  if (!open) {
    return (
      <div className="space-y-2">
        {savedName && (
          <p className="flex items-center gap-1.5 rounded-card bg-card px-3.5 py-2.5 text-xs text-accent-900">
            <Check className="h-3.5 w-3.5 shrink-0" />
            {savedPending
              ? <>הטסט של <bdi dir="auto">{savedName}</bdi> נשלח לאישור המאמן.</>
              : <>הטסט של <bdi dir="auto">{savedName}</bdi> נשמר.</>}
          </p>
        )}
        <button
          type="button"
          onClick={() => { setSavedName(null); setSavedPending(false); setOpen(true); }}
          className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-card bg-card text-sm font-bold text-brand-700"
        >
          <Plus className="h-4 w-4" />
          {selfSubmit ? 'שליחת טסט למאמן' : 'רישום טסט'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-card p-3.5 space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">{selfSubmit ? 'שליחת טסט' : 'רישום טסט'}</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          aria-label="ביטול"
          className="flex h-11 w-11 items-center justify-center text-ink-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Field label="מתאמן">
        {only ? (
          // Plain text, NOT a grey field. Every real input on this form wears `bg-page`, so
          // the first version of this put the name in a box identical to the metres field —
          // which reads as an input that refuses to take a tap, i.e. as broken. The fixed
          // half of the protocol below is plain text for the same reason.
          <p className="text-[16px] font-bold text-ink-900">
            <bdi dir="auto">{only.name}</bdi>
          </p>
        ) : (
          <select
            value={picked}
            onChange={e => setPicked(e.target.value)}
            className={SELECT}
          >
            <option value="">בחר מתאמן…</option>
            {athletes.map(a => (
              <option key={a.athleteId} value={a.athleteId}>{a.name}</option>
            ))}
          </select>
        )}
      </Field>

      <Field label="סוג הטסט">
        <div className="flex gap-1.5">
          {PROTOCOLS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProtocol(p.id)}
              className={cn(
                'min-h-[44px] flex-1 rounded-pill px-2 text-[13px] font-semibold',
                protocol === p.id ? 'bg-brand-600 text-white' : 'bg-page text-ink-500',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="תאריך">
        <input type="date" value={date} max={israelToday()} onChange={e => setDate(e.target.value)} className={INPUT} />
        {future && <Note tone="warn">התאריך בעתיד — הטסט עוד לא נערך.</Note>}
      </Field>

      {/* The fixed half, stated. Not a pre-filled input: a value you can edit by accident
          is exactly how a "30 minute test" ends up recorded as 28 minutes. */}
      {shape?.fixed === 'duration' ? (
        <>
          <p className="text-[11px] text-ink-400">
            משך הטסט קבוע: <bdi dir="ltr">{formatTime(shape.value)}</bdi>. מודדים את המרחק.
          </p>
          <Field label="מרחק (מטרים)">
            <input
              type="text" inputMode="decimal" value={distanceText}
              onChange={e => setDistanceText(e.target.value)}
              placeholder="6420" className={INPUT}
            />
          </Field>
        </>
      ) : shape?.fixed === 'distance' ? (
        <>
          <p className="text-[11px] text-ink-400">
            המרחק קבוע: <bdi dir="ltr">{shape.value}</bdi> מ׳. מודדים את הזמן.
          </p>
          <Field label="זמן (דקות:שניות)">
            <input
              type="text" inputMode="numeric" value={durationText}
              onChange={e => setDurationText(e.target.value)}
              placeholder="7:20" className={INPUT}
            />
          </Field>
        </>
      ) : (
        // An unlisted protocol has no fixed half, so both are the measurement.
        <>
          <Field label="זמן (דקות:שניות)">
            <input type="text" inputMode="numeric" value={durationText}
              onChange={e => setDurationText(e.target.value)} placeholder="30:00" className={INPUT} />
          </Field>
          <Field label="מרחק (מטרים)">
            <input type="text" inputMode="decimal" value={distanceText}
              onChange={e => setDistanceText(e.target.value)} placeholder="6420" className={INPUT} />
          </Field>
        </>
      )}

      {/* The check. Shown the moment both halves exist, because a coach reading "4:40"
          under the field knows instantly whether he typed what he meant. */}
      <div className="rounded-card bg-page px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-ink-500">קצב סף מחושב</span>
          {/* Toned when it is not a pace a human runs. Without this the screen's most
              prominent number looked equally confident either way: `6.42` in the metres
              field renders as "4672:54", which is nonsense — and nonsense in the same bold
              ink as "4:40" reads as corrupt data rather than as "you typed km". */}
          <span className={cn(
            'text-base font-bold tabular-nums',
            implausible ? 'text-band-3-ink' : 'text-ink-900',
          )}>
            {paceSec === null ? <span className="text-sm font-normal text-ink-400">—</span>
              : <><bdi dir="ltr">{formatPace(paceSec)}</bdi> <span className="text-[11px] font-semibold">לק״מ</span></>}
          </span>
        </div>
        {implausible && (
          <Note tone="warn">
            הקצב הזה לא נראה סביר. בדוק את היחידות — מרחק במטרים ולא בק״מ, זמן בדקות:שניות.
            אפשר לשמור בכל זאת.
          </Note>
        )}
      </div>

      <Field label="דופק ממוצע (לא חובה)">
        <input
          type="text" inputMode="numeric" value={hrText}
          onChange={e => setHrText(e.target.value)}
          // "למשל" and not a bare number. A grey `168` sits exactly where a real value sits,
          // at the same 16px, directly under a date field showing a real date — and this is
          // the one optional field on the form, so a placeholder mistaken for a value is
          // silently lost data rather than a blocked save.
          placeholder="למשל 168" className={INPUT}
        />
        {/* Said here, once, where the number is entered: this is not threshold HR, and the
            difference is a few beats that would end up in every HR-written workout. */}
        {/* 11px and not 10. The audit flags 10 as unreadable, and this is the one caption on
            the form carrying a distinction worth a few beats in every HR-written workout —
            a note nobody can read is the same as not writing it. */}
        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
          הממוצע של כל הטסט. זה לא דופק סף — דופק סף הוא הממוצע של 20 הדקות האחרונות, וגבוה מזה.
        </p>
      </Field>

      <Field label="הערות (לא חובה)">
        <input
          type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="מסלול, תנאים, מה שכדאי לזכור" className={INPUT}
        />
      </Field>

      {error && <Note tone="error">{error}</Note>}

      <button
        type="button"
        onClick={save}
        disabled={!complete || saving}
        className={cn(
          'min-h-[44px] w-full rounded-card text-sm font-bold',
          complete && !saving ? 'bg-brand-600 text-white' : 'bg-page text-ink-400',
        )}
      >
        {saving ? (selfSubmit ? 'שולח…' : 'שומר…') : (selfSubmit ? 'שליחה לאישור' : 'שמירה')}
      </button>
    </div>
  );
}

// 16px on every field, or iOS Safari zooms the whole page the moment one takes focus.
const INPUT =
  'w-full min-h-[44px] rounded-card bg-page px-3 text-[16px] text-ink-900 placeholder:text-ink-400';

/**
 * A select needs an EXPLICIT height, not a `min-h`.
 *
 * The audit measured this control at 43×26 on both phones with the same classes as the
 * text inputs: WebKit lays a native select out from its own intrinsic metrics and does not
 * grow it to satisfy `min-height`, so the thumb target was barely half Apple's 44px floor.
 * `h-11` is what every other select in this app already uses (`AcademySettings`), and this
 * is why.
 */
const SELECT = 'w-full h-11 rounded-card bg-page px-3 text-[16px] text-ink-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return (
    <p className={cn(
      'mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed',
      tone === 'error' ? 'text-accent-red-ink' : 'text-band-3-ink',
    )}>
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A plain metres figure. Rejects anything that is not a number, rather than reading 0. */
function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
