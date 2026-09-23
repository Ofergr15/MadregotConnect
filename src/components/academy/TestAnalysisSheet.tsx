'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Target } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatPace } from '@/components/activity/format';
import { PACE_MULTIPLE, type MetricSource, type TestAnalysis } from '@/lib/academy/testAnalysis';
import type { AcademyBand } from '@/lib/academy/bands';

/**
 * `ניתוח טסט` — funnel step 8, the step the process map marks "here there is a lot to take".
 *
 * A coach reads 6.42 km in thirty minutes off a watch and turns it into a threshold, five training
 * paces, a band and a paragraph of Hebrew — by hand, per trainee, out of a spreadsheet he
 * maintains himself. This screen is that table, filled in, with the two things only a person can
 * supply left to the person: the band and the words.
 *
 * ── EVERY NUMBER SAYS WHERE IT CAME FROM ─────────────────────────────────────────────────
 *
 * The mockup draws a `מקור` column and it is the most important column on the screen. "Measured"
 * and "derived through a coefficient I guessed" are different kinds of claim, and a coach about to
 * price sixteen weeks of training on one of them has to be able to tell which he is looking at. It
 * is also what makes the screen honest about being unfinished: the coefficients are textbook
 * figures awaiting Ofer's own table, and a row labelled `נגזר` invites the correction that a
 * confident bold number does not.
 *
 * ── AND AN EDIT IS A FACT ABOUT THE COACH, NOT A CORRECTION OF THE DATA ──────────────────
 *
 * Editing the threshold moves the derived paces with it, because they are multiples of it and a
 * coach who believes 4:52 does not then also believe an easy pace computed from 4:40. What does
 * NOT move is the stored `derived` block: migration 113 keeps what the formula said beside what
 * the coach signed, so a coefficient change next year cannot rewrite the paces a plan was written
 * against, and an edit stays visible as an edit.
 */

const SOURCE_LABEL: Record<MetricSource, string> = {
  measured: 'מהשעון',
  calculated: 'מחושב',
  derived: 'נגזר',
  predicted: 'תחזית',
};

/** `4:45` / `285` → 285. Null when it is neither. */
function parsePaceSec(text: string): number | null {
  const trimmed = text.trim();
  const colon = /^(\d{1,3}):(\d{2})$/.exec(trimmed);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const bare = Number(trimmed);
  return Number.isFinite(bare) && bare > 0 ? Math.round(bare) : null;
}

/** `3:38:24` for a marathon, `19:12` for a 5K — hours only when there are any. */
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** `21097` → `חצי מרתון`. The club's table is kept in these five distances. */
function distanceLabel(metres: number): string {
  if (metres === 21097) return 'חצי מרתון';
  if (metres === 42195) return 'מרתון';
  if (metres >= 1000) return `${metres / 1000} ק"מ`;
  return `${metres} מ׳`;
}

interface AnalysisResponse {
  test: {
    id: string; athleteId: string; name: string; date: string;
    protocol: string; durationSec: number; distanceM: number; avgHr: number | null;
    excludedReason: string | null;
  };
  currentBandId: string | null;
  derived: TestAnalysis | null;
  draftSummary: string;
  previousPaceSec: number | null;
  bands: AcademyBand[];
  recommendation: {
    bandId: string | null; bandNumber: number | null;
    reason: 'bands_have_no_paces' | 'no_bands' | null; gapSec: number | null;
  };
  analysis: {
    id: string; approved: Record<string, number>; bandId: string | null;
    summary: string | null; status: string; approvedAt: string | null;
    sentAt: string | null;
    /** The text the trainee actually received, which an edit since then has diverged from. */
    sentSummary: string | null;
  } | null;
  tableMissing: boolean;
  /** Migration 114 is not pasted yet, so nothing on the screen may claim anything about delivery. */
  deliveryMissing?: boolean;
}

export function TestAnalysisSheet({
  open,
  onOpenChange,
  testId,
  onApproved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which measurement is being analysed. Null while the sheet is closed. */
  testId: string | null;
  /** Called after an approval, so the screen behind can re-read the band it just changed. */
  onApproved?: () => void;
}) {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [bandId, setBandId] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [editing, setEditing] = useState(false);
  const [thresholdText, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    if (!testId) return;
    setState('loading');
    try {
      const res = await fetch(`/api/academy/test-analysis?testId=${encodeURIComponent(testId)}`, {
        headers: await apiHeaders(),
      });
      const body = await res.json();
      if (!res.ok) { setState('error'); return; }
      if (body?.tableMissing) { setState('missing'); return; }
      const loaded = body as AnalysisResponse;
      setData(loaded);
      // A saved decision wins over the recommendation, and the recommendation over nothing: the
      // coach's own last answer is the one thing on this screen he has already given.
      setBandId(loaded.analysis?.bandId ?? loaded.currentBandId ?? loaded.recommendation.bandId);
      setSummary(loaded.analysis?.summary ?? loaded.draftSummary);
      setThreshold(
        formatPace(loaded.analysis?.approved?.thresholdPaceSec ?? loaded.derived?.thresholdPaceSec ?? 0),
      );
      setState('ready');
    } catch {
      setState('error');
    }
  }, [testId]);

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setError(null);
    setDone(false);
    setSent(false);
    void load();
  }, [open, load]);

  /**
   * The paces as they stand: computed, unless the coach has edited the threshold.
   *
   * The two derived rows move with the edit because they are multiples of the threshold. Leaving
   * them at their original values would put a 4:40-based easy pace under a 4:52 threshold on the
   * same screen, which is not a conservative choice — it is two different opinions in one table.
   */
  const paces = useMemo(() => {
    const computed = data?.derived;
    if (!computed) return null;
    const edited = editing ? parsePaceSec(thresholdText) : null;
    const threshold = edited ?? data?.analysis?.approved?.thresholdPaceSec ?? computed.thresholdPaceSec;
    return {
      thresholdPaceSec: threshold,
      easyPaceSec: Math.round(threshold * PACE_MULTIPLE.easy),
      intervalPaceSec: Math.round(threshold * PACE_MULTIPLE.interval),
      isEdited: threshold !== computed.thresholdPaceSec,
    };
  }, [data, editing, thresholdText]);

  const save = async (status: 'draft' | 'approved') => {
    if (!testId || !paces) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/test-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({
          testId,
          status,
          bandId,
          summary,
          approved: {
            thresholdPaceSec: paces.thresholdPaceSec,
            easyPaceSec: paces.easyPaceSec,
            intervalPaceSec: paces.intervalPaceSec,
            ...(data?.derived?.avgHrBpm !== null ? { avgHrBpm: data?.derived?.avgHrBpm } : {}),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 503
          ? 'טבלת הניתוחים עוד לא הוקמה במסד הנתונים.'
          : 'השמירה נכשלה. אפשר לנסות שוב.');
        return;
      }
      // Re-read, because what the screen may now offer depends on what was just stored: sending is
      // only possible for an APPROVED analysis, and the send request posts the STORED summary.
      setEditing(false);
      void load();
      if (status === 'approved') {
        // Said out loud when it did not happen: `academy_band_id` is what the plan composer reads,
        // so an approval whose band write failed is signed and ineffective, which is the one
        // outcome here that would be invisible otherwise.
        if (bandId && body?.bandAssigned === false) {
          setError('הניתוח נשמר ואושר, אבל שיבוץ הדבוקה נכשל. כדאי לשבץ מהפרופיל.');
        }
        setDone(true);
        onApproved?.();
      } else {
        setDone(true);
      }
    } catch {
      setError('השמירה נכשלה. אפשר לנסות שוב.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Send the approved summary to the trainee — the one outward-facing act on this screen.
   *
   * What goes out is what is STORED, never the textarea: the route reads the row. So the button is
   * disabled while the two differ, with the reason said out loud, rather than quietly sending a
   * version of the text the coach can see he has changed.
   */
  const sendToTrainee = async () => {
    if (!testId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/test-analysis/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ testId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.code === 'not_approved'
          ? 'צריך לאשר את הניתוח לפני שליחה.'
          : body?.code === 'empty_summary'
            ? 'אין מה לשלוח — הסיכום ריק.'
            : 'השליחה נכשלה. הניתוח שמור, והמתאמן עוד לא קיבל אותו.');
        return;
      }
      // Delivered but not recorded (migration 114 is not in yet). Said plainly, because the
      // message IS in the thread and the screen will not remember that next time it opens.
      if (body?.recorded === false) {
        setError('נשלח למתאמן, אבל השליחה לא נרשמה במסד — מיגרציה 114 עוד לא הורצה.');
      }
      setSent(true);
      void load();
    } catch {
      setError('השליחה נכשלה. הניתוח שמור, והמתאמן עוד לא קיבל אותו.');
    } finally {
      setBusy(false);
    }
  };

  const test = data?.test;
  const stored = data?.analysis ?? null;
  const approvedAndSaved = stored?.status === 'approved';
  /** The coach has typed since the last save, so what is stored is not what he is reading. */
  const summaryUnsaved = summary.trim() !== String(stored?.summary ?? '').trim();
  /** Sent, and then edited. The trainee is holding an earlier version of this. */
  const sentIsStale = !!stored?.sentAt && String(stored?.sentSummary ?? '').trim() !== summary.trim();

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="ניתוח טסט">
      <div className="space-y-3 px-4 pb-4" dir="rtl">
        {state === 'loading' && <p className="py-6 text-center text-xs text-ink-400">טוען…</p>}
        {state === 'missing' && (
          <p className="py-6 text-center text-xs leading-relaxed text-ink-400">
            טבלת הניתוחים עוד לא הוקמה במסד הנתונים.
            <br />צריך להריץ את מיגרציה <bdi dir="ltr">113</bdi>.
          </p>
        )}
        {state === 'error' && (
          <p className="py-6 text-center text-xs text-accent-red-ink">לא הצלחנו לטעון את הניתוח</p>
        )}

        {state === 'ready' && test && (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs text-ink-700">
                <bdi dir="ltr" className="font-bold">{test.name}</bdi>
                {' · '}<bdi dir="ltr">{test.date}</bdi>
              </p>
              {data?.analysis?.status === 'approved' && (
                <span className="rounded-pill bg-accent-900/10 px-2 py-0.5 text-[11px] font-semibold text-accent-900">
                  אושר
                </span>
              )}
            </div>

            {/* What actually happened, before anything derived from it. */}
            <div className="grid grid-cols-3 gap-1.5">
              <Kpi value={(test.distanceM / 1000).toFixed(2)} label='ק"מ' />
              <Kpi value={formatPace(Math.round(test.durationSec / (test.distanceM / 1000)))} label="קצב ממוצע" tone="text-ink-900" />
              <Kpi value={test.avgHr === null ? '—' : String(test.avgHr)} label="דופק ממוצע" tone="text-accent-red-ink" />
            </div>

            {!paces ? (
              <p className="rounded-card bg-band-2/10 px-3 py-2.5 text-xs leading-relaxed text-band-2-ink">
                לא ניתן לנתח את הטסט הזה — חסרים בו זמן או מרחק.
              </p>
            ) : (
              <>
                {data?.derived?.implausible && (
                  <p className="rounded-card bg-band-2/10 px-3 py-2.5 text-xs leading-relaxed text-band-2-ink">
                    הקצב שיוצא מהטסט הזה לא נראה אפשרי. כדאי לבדוק את המרחק והזמן לפני שמאשרים —
                    מכאן נגזרים כל הקצבים בתוכנית.
                  </p>
                )}
                {data?.derived?.thresholdAdjusted && (
                  <p className="px-1 text-[11px] leading-relaxed text-ink-400">
                    הטסט הזה קצר או ארוך משמעותית מ-<bdi dir="ltr">30</bdi> דקות, ולכן הסף חושב
                    כשווה-ערך למאמץ של <bdi dir="ltr">30</bdi> דקות. זה המספר שיהיה שונה מהמרשם.
                  </p>
                )}

                <div className="flex items-center justify-between px-1">
                  <p className="text-[11px] font-semibold text-ink-500">ספים שנגזרו מהטסט</p>
                  <button
                    type="button"
                    onClick={() => setEditing(v => !v)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 text-[11px] font-semibold text-brand-600"
                  >
                    <Pencil className="h-3 w-3" />
                    {editing ? 'סיום עריכה' : 'ערוך'}
                  </button>
                </div>

                {editing && (
                  <div className="rounded-card bg-page px-2.5 py-2">
                    <label className="text-[11px] text-ink-500" htmlFor="threshold-edit">
                      סף אנאירובי (קצב) — הקצבים הנגזרים יזוזו איתו
                    </label>
                    <input
                      id="threshold-edit"
                      dir="ltr"
                      value={thresholdText}
                      onChange={e => setThreshold(e.target.value)}
                      inputMode="numeric"
                      placeholder="4:45"
                      // `text-base`: under 16px iOS Safari zooms on focus inside a sheet and does
                      // not zoom back, which puts the approve button behind the keyboard.
                      className="mt-1 min-h-[44px] w-full rounded-card bg-card px-2 text-base tabular-nums text-ink-900"
                    />
                  </div>
                )}

                <div className="overflow-hidden rounded-card bg-card">
                  <MetricRow label="סף אנאירובי (קצב)" value={formatPace(paces.thresholdPaceSec)}
                    source={paces.isEdited ? null : 'calculated'} edited={paces.isEdited} />
                  <MetricRow label="דופק ממוצע בטסט" value={test.avgHr === null ? '—' : String(test.avgHr)}
                    source="measured" />
                  <MetricRow label="קצב אירובי קל" value={formatPace(paces.easyPaceSec)} source="derived" />
                  <MetricRow label="קצב אינטרוולים" value={formatPace(paces.intervalPaceSec)} source="derived" />
                  {(data?.derived?.predictions ?? []).map(p => (
                    <MetricRow
                      key={p.distanceM}
                      label={distanceLabel(p.distanceM)}
                      value={formatDuration(p.sec)}
                      source="predicted"
                    />
                  ))}
                </div>

                {/* Why there is no threshold HR row, said once on the screen rather than only in
                    the code: the honest figure is the average of the last twenty minutes, and
                    inventing the difference would put made-up beats into every HR workout. */}
                <p className="px-1 text-[11px] leading-relaxed text-ink-400">
                  הדופק כאן הוא הממוצע של כל הטסט, לא דופק סף. דופק הסף הוא הממוצע של
                  {' '}<bdi dir="ltr">20</bdi> הדקות האחרונות, וצריך בשבילו את רצועת הדופק של הריצה.
                </p>

                {/* ── THE BAND ── the decision the whole process turns on. */}
                <div className="flex items-start gap-2 rounded-card bg-brand-600/10 px-3 py-2.5 text-xs leading-relaxed text-ink-900">
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                  <span>
                    {data?.recommendation.bandNumber !== null && data?.recommendation.bandNumber !== undefined ? (
                      <>
                        <b>המלצת שיבוץ: דבוקה <bdi dir="ltr">{data.recommendation.bandNumber}</bdi></b>
                        {' — '}לפי הסף שנמדד. שינית? השינוי שלך גובר, והמערכת זוכרת שזו החלטה שלך.
                      </>
                    ) : data?.recommendation.reason === 'no_bands' ? (
                      <>אין דבוקות מוגדרות, אז אין מה להמליץ. צריך להגדיר אותן קודם.</>
                    ) : (
                      <>
                        <b>אין המלצה אוטומטית.</b> לאף דבוקה לא נרשם טווח קצבים, ולכן אין מול מה
                        להשוות את הסף שנמדד. ברגע שיירשמו הקצבים של הדבוקות, ההמלצה תופיע כאן.
                      </>
                    )}
                  </span>
                </div>

                <p className="px-1 text-[11px] font-semibold text-ink-500">שיבוץ</p>
                <div className="flex flex-wrap gap-1.5">
                  {(data?.bands ?? []).map(band => (
                    <button
                      key={band.id}
                      type="button"
                      onClick={() => setBandId(band.id === bandId ? null : band.id)}
                      aria-pressed={band.id === bandId}
                      className={cn(
                        'min-h-[44px] min-w-[44px] rounded-pill px-3 text-xs font-semibold',
                        band.id === bandId ? 'bg-brand-600 text-white' : 'bg-page text-ink-700',
                      )}
                    >
                      <bdi dir="ltr">{band.bandNumber}</bdi>
                    </button>
                  ))}
                </div>

                <p className="px-1 text-[11px] font-semibold text-ink-500">סיכום למתאמן — טיוטה</p>
                {/* Editable, and pre-filled with the arithmetic only. The middle sentence of the
                    mockup's own draft — "good aerobic base, but you opened too fast" — is the
                    coach's read of the person, and a template that writes it produces a form
                    letter the trainee stops reading. */}
                <textarea
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  rows={5}
                  dir="auto"
                  aria-label="סיכום למתאמן"
                  className="w-full rounded-card bg-page px-2.5 py-2 text-xs leading-relaxed text-ink-900"
                />

                {error && <p className="px-1 text-[11px] text-accent-red-ink">{error}</p>}
                {done && !error && (
                  <p className="px-1 text-[11px] font-semibold text-accent-900">נשמר.</p>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { void save('draft'); }}
                    disabled={busy}
                    className="min-h-[48px] flex-1 rounded-card bg-page text-sm font-bold text-ink-700 disabled:opacity-50"
                  >
                    שמור טיוטה
                  </button>
                  <button
                    type="button"
                    onClick={() => { void save('approved'); }}
                    disabled={busy}
                    className="min-h-[48px] flex-[2] rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {busy ? 'שומר…' : bandId ? 'אשר ושבץ' : 'אשר ללא שיבוץ'}
                  </button>
                </div>
                {/* What approving does, before it is tapped. It moves the trainee's band, which
                    prices every workout they will receive — and it does NOT tell the trainee
                    anything. Sending is the separate tap below. */}
                <p className="px-1 text-[11px] leading-relaxed text-ink-400">
                  אישור שומר את הספים ומשבץ את המתאמן לדבוקה שנבחרה. המתאמן לא מקבל כלום עד
                  שליחה.
                </p>

                {/* ── DELIVERY ── the only thing on this screen that leaves the building.
                    Kept visually below the approval and never merged into it: approving is a
                    decision about numbers, sending is a message to a person, and a coach working
                    through eight analyses must not find out afterwards that he also sent eight
                    messages. */}
                <div className="rounded-card bg-page px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-semibold text-ink-500">שליחה למתאמן</p>
                  {!approvedAndSaved ? (
                    <p className="text-[11px] leading-relaxed text-ink-400">
                      אחרי אישור אפשר לשלוח מכאן את הסיכום לשרשור של המתאמן.
                    </p>
                  ) : (
                    <>
                      {stored?.sentAt && (
                        <p className="text-[11px] leading-relaxed text-ink-500">
                          נשלח <bdi dir="ltr">{stored.sentAt.slice(0, 10)}</bdi>
                          {/* Sent, then edited. A timestamp alone would show "sent" above text
                              nobody has read, which is why 114 stores what actually went out. */}
                          {sentIsStale && <> · <span className="font-semibold text-band-2-ink">למתאמן יש גרסה מוקדמת יותר</span></>}
                        </p>
                      )}
                      {summaryUnsaved && (
                        // What goes out is the STORED text, because the route reads the row. Said
                        // rather than silently sending a version the coach can see he changed.
                        <p className="text-[11px] leading-relaxed text-band-2-ink">
                          יש שינויים שלא נשמרו. צריך לאשר שוב לפני השליחה, אחרת יישלח הנוסח השמור.
                        </p>
                      )}
                      {data?.deliveryMissing && (
                        <p className="text-[11px] leading-relaxed text-ink-400">
                          מיגרציה <bdi dir="ltr">114</bdi> עוד לא הורצה, ולכן שליחה תתבצע אבל לא
                          תירשם כאן.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => { void sendToTrainee(); }}
                        disabled={busy || summaryUnsaved}
                        className="min-h-[44px] w-full rounded-card bg-accent-900 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {sent && !error
                          ? 'נשלח'
                          : stored?.sentAt ? 'שלח שוב עם הנוסח המעודכן' : 'שלח למתאמן'}
                      </button>
                      <p className="text-[11px] leading-relaxed text-ink-400">
                        הסיכום נשלח לשרשור האקדמיה של המתאמן — אותו שרשור שבו הוא מקבל את הפידבק
                        השבועי. שליחה חוזרת מעדכנת את ההודעה שכבר שם ולא מוסיפה עוד אחת.
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Kpi({ value, label, tone = 'text-ink-900' }: { value: string; label: string; tone?: string }) {
  return (
    <div className="rounded-card bg-card px-2 py-2.5 text-center">
      <div className={cn('text-lg font-bold tabular-nums', tone)}><bdi dir="ltr">{value}</bdi></div>
      <div className="text-[11px] text-ink-500">{label}</div>
    </div>
  );
}

function MetricRow({
  label, value, source, edited,
}: {
  label: string;
  value: string;
  source: MetricSource | null;
  edited?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-page px-3 py-2.5 last:border-0">
      <span className="min-w-0 flex-1 truncate text-xs text-ink-700">{label}</span>
      <span className="shrink-0 text-sm font-bold tabular-nums text-ink-900"><bdi dir="ltr">{value}</bdi></span>
      <span className="w-14 shrink-0 text-end text-[11px] text-ink-400">
        {edited ? <span className="font-semibold text-brand-600">נערך</span> : source && SOURCE_LABEL[source]}
      </span>
    </div>
  );
}
