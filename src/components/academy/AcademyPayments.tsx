'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { initialsOf } from './types';
import {
  paymentReminderText, periodOf,
  type MentorPayout, type PaymentBoard, type PaymentRowView, type PaymentState, type TraineeEconomics,
} from '@/lib/academy/payments';

// ── Section 6: payment status beside coaching status ─────────────────────────
//
// The mockup's own reason for this screen: "'מי לא שילם' חייב לשבת ליד 'מי מקבל ליווי' — אחרת
// אתה מגלה את זה רק בסוף החודש."
//
// Everything on it is a STATUS. The money stays in GO — GO sends the link, GO holds the
// standing order, GO issues the receipt — and the grey box at the bottom says so, because the
// first person to mistake a marked month for a receipt will be reading this screen at
// midnight.
//
// Two things this screen deliberately does not do:
//
//   1. It does not send anything. `שלח תזכורת` opens the WORDS, to copy into WhatsApp where
//      these conversations already happen. An app that quietly chases people for money is not
//      a feature to infer from a mockup pill, and whether it ever should is an open question.
//   2. It does not compute its own counts. Every KPI and both lists come out of
//      `buildPaymentBoard`, so the footer cannot say two above a list of three.

/**
 * One tone per state, and the choice matters more here than on other academy screens.
 *
 * Red is reserved for money the club is not collecting from somebody it is actively coaching.
 * `link_pending` is grey on purpose — a link sent yesterday is the process working, and colouring
 * it would put an alarm beside the name of somebody who has done nothing wrong. `cancelled` is
 * grey for the same reason from the other direction: nothing is broken, somebody left.
 */
const STATE_STYLE: Record<PaymentState, { chip: string; label: string }> = {
  paid: { chip: 'bg-accent-900/10 text-accent-900', label: 'שולם' },
  unpaid: { chip: 'bg-accent-red/10 text-accent-red-ink', label: 'לא נרשם תשלום' },
  link_pending: { chip: 'bg-page text-ink-500', label: 'קישור נשלח' },
  link_overdue: { chip: 'bg-accent-red/10 text-accent-red-ink', label: 'קישור ללא מענה' },
  awaiting_link: { chip: 'bg-band-2/10 text-band-2-ink', label: 'ממתין לקישור' },
  failed: { chip: 'bg-band-2/10 text-band-2-ink', label: 'הוראת קבע נכשלה' },
  cancelled: { chip: 'bg-page text-ink-400', label: 'בוטל' },
};

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** `2026-09-01` → `ספטמבר 2026`, as a Hebrew label plus an isolated year. */
function monthLabel(period: string): { month: string; year: string } {
  const [year, month] = period.split('-');
  return { month: MONTHS[Number(month) - 1] || period, year };
}

/** The month `delta` months from `period`, still normalised to its first day. */
function shiftMonth(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  // Date arithmetic in UTC, matching `periodOf`: a local-midnight construction of the first of
  // the month lands in the previous month east of Greenwich.
  return periodOf(new Date(Date.UTC(year, month - 1 + delta, 1)));
}

function ils(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `₪${Math.round(amount).toLocaleString('en-US')}`;
}

/** The pure view. Takes a computed board so the preview can mount the real screen. */
export function PaymentsView({
  board,
  payouts,
  economics,
  economicsBasis,
  ratesMissing,
  onShiftMonth,
  onAction,
  busy,
}: {
  board: PaymentBoard;
  payouts: MentorPayout[];
  economics: TraineeEconomics | null;
  economicsBasis?: { feesRecorded: number; trainees: number; mentorTotalIls: number };
  ratesMissing?: boolean;
  onShiftMonth?: (delta: number) => void;
  onAction?: (row: PaymentRowView, action: 'mark_paid' | 'unmark_paid' | 'link_sent' | 'activate' | 'failed') => void;
  busy?: string | null;
}) {
  const { month, year } = monthLabel(board.period);
  const [reminder, setReminder] = useState<PaymentRowView | null>(null);
  const [copied, setCopied] = useState(false);

  const reminderText = useMemo(
    () => (reminder ? paymentReminderText(reminder, `${month} ${year}`) : ''),
    [reminder, month, year],
  );

  return (
    <div className="space-y-3" dir="rtl">
      {/* The month, and a way to move it. A payment screen with no month on it is the Excel
          again: "did he pay" is meaningless without saying which month. */}
      <div className="flex items-center justify-between rounded-card bg-card px-3 py-2.5">
        <button
          type="button"
          onClick={() => onShiftMonth?.(-1)}
          disabled={!onShiftMonth}
          aria-label="החודש הקודם"
          className="min-h-[44px] min-w-[44px] rounded-pill text-ink-400 disabled:opacity-40 flex items-center justify-center"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-bold text-ink-900">{month} <bdi dir="ltr">{year}</bdi></div>
          <div className="text-[11px] text-ink-400">
            <bdi dir="ltr">{board.kpi.trainees}</bdi> מתאמנים · נאסף {ils(board.kpi.collectedIls)} מתוך {ils(board.kpi.expectedIls)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onShiftMonth?.(1)}
          disabled={!onShiftMonth}
          aria-label="החודש הבא"
          className="min-h-[44px] min-w-[44px] rounded-pill text-ink-400 disabled:opacity-40 flex items-center justify-center"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Kpi value={board.kpi.activeStandingOrders} label="הוראת קבע פעילה" tone="text-accent-900" />
        <Kpi value={board.kpi.unpaid} label="דורש טיפול" tone={board.kpi.unpaid ? 'text-accent-red-ink' : 'text-ink-400'} />
        <Kpi value={board.kpi.awaitingLink} label="ממתין לקישור" tone="text-ink-500" />
      </div>

      {/* The red box, and the only alert on this screen that costs money while nobody is
          looking. Named people and a number of days, because "1 trainee unpaid" sends nobody
          anywhere — the mockup writes the whole sentence out for exactly this reason. */}
      {board.freeRiders.length > 0 && (
        <div className="rounded-card bg-accent-red/10 px-3.5 py-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-accent-red-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {board.freeRiders.map((r, i) => (
                <span key={r.athleteId}>
                  {i > 0 && ' · '}
                  <b><bdi dir="ltr" className="whitespace-nowrap">{r.name}</bdi></b>
                  {r.daysSinceLink !== null
                    ? <> — הקישור נשלח לפני <bdi dir="ltr">{r.daysSinceLink}</bdi> ימים ולא הוקמה הוראת קבע.</>
                    : r.state === 'failed'
                      ? <> — הוראת הקבע נכשלה ולא חודשה.</>
                      : <> — לא נשלח קישור תשלום.</>}
                </span>
              ))}
              {' '}
              {board.freeRiders.length === 1 ? 'מתאמן פעיל שמקבל ליווי בחינם.' : 'מתאמנים פעילים שמקבלים ליווי בחינם.'}
            </span>
          </p>
        </div>
      )}

      {board.unpaid.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="px-1 text-xs font-bold text-ink-900">דורש טיפול</h3>
          {board.unpaid.map(row => (
            <PaymentRow
              key={row.athleteId}
              row={row}
              busy={busy === row.athleteId}
              onRemind={() => { setCopied(false); setReminder(row); }}
              onAction={onAction}
            />
          ))}
        </section>
      )}

      {board.paid.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="px-1 text-xs font-bold text-ink-900">שולם החודש</h3>
          {board.paid.map(row => (
            <PaymentRow key={row.athleteId} row={row} busy={busy === row.athleteId} onAction={onAction} />
          ))}
        </section>
      )}

      {board.rows.length === 0 && (
        <p className="py-6 text-center text-xs text-ink-400">אין מתאמנים באקדמיה.</p>
      )}

      {/* Said on the screen and not only in a migration comment. The single most likely way
          this feature does damage is somebody treating a marked month as proof of payment. */}
      <div className="rounded-card bg-page px-3.5 py-3">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
          <Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            הכסף עצמו נשאר ב-GO. כאן רק <b>מצב</b>: קישור נשלח / הוראת קבע פעילה / החודש שולם —
            וסימון בלחיצה כשמגיע המייל. זו לא הנהלת חשבונות ולא אישור תשלום.
          </span>
        </p>
      </div>

      {economics && (
        <section className="rounded-card bg-card p-3.5 space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-bold text-ink-900">מה נשאר ממתאמן</h3>
            {/* An average, labelled as one. A per-trainee figure computed from a single fee
                would read as the club's economics when it is one row of them. */}
            {economicsBasis && (
              <span className="text-[10px] text-ink-400">
                ממוצע על <bdi dir="ltr">{economicsBasis.feesRecorded}</bdi> מתוך <bdi dir="ltr">{economicsBasis.trainees}</bdi> מתאמנים
              </span>
            )}
          </div>
          <MoneyRow label="מה שהוא משלם" value={economics.grossIls} bold />
          <MoneyRow label="מע״מ" value={-economics.vatIls} />
          <MoneyRow label="מלווה" value={-economics.mentorIls} />
          <MoneyRow label="שותפים" value={-economics.partnersIls} />
          <MoneyRow label="נשאר" value={economics.remainingIls} bold tone="text-accent-900" />
          <p className="text-[11px] leading-relaxed text-ink-500">
            השורה שמזיזה את זה היא <b>עלות המלווה למתאמן</b> — ולכן זמן הפידבק הוא מדד כלכלי,
            לא רק נוחות.
          </p>
          {economicsBasis && economicsBasis.feesRecorded < economicsBasis.trainees && (
            <p className="text-[11px] leading-relaxed text-band-2-ink">
              חסר סכום חודשי ל<bdi dir="ltr">{economicsBasis.trainees - economicsBasis.feesRecorded}</bdi> מתאמנים,
              ולכן ההכנסות כאן נמוכות מהמצב האמיתי.
            </p>
          )}
        </section>
      )}

      {payouts.length > 0 && (
        <section className="rounded-card bg-card p-3.5 space-y-2">
          <h3 className="text-xs font-bold text-ink-900">תשלום למלווים · {month}</h3>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1 text-[10px] font-semibold text-ink-400">
            <span>מלווה</span><span className="text-end">מתאמנים</span><span className="text-end">לתשלום</span>
          </div>
          {payouts.map(p => (
            <div key={p.coachId} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-pill bg-page px-2 py-1.5 text-[11px]">
              <span className="truncate text-ink-700" dir="auto">{p.coachName}</span>
              <span className="text-end tabular-nums text-ink-500"><bdi dir="ltr">{p.trainees}</bdi></span>
              {/* A mentor with no recorded rate shows a gap, never a zero: a zero in this
                  column is how somebody gets left out of a payment run. */}
              <span className={cn('text-end font-semibold tabular-nums', p.rateMissing ? 'text-band-2-ink' : 'text-ink-900')}>
                {p.rateMissing ? 'לא הוגדר' : <bdi dir="ltr">{ils(p.payoutIls)}</bdi>}
              </span>
            </div>
          ))}
          {ratesMissing && (
            <p className="text-[11px] leading-relaxed text-band-2-ink">
              לא לכל מלווה מוגדר תעריף, ולכן הסכום כאן חלקי.
            </p>
          )}
        </section>
      )}

      <p className="px-1 text-[11px] text-ink-400">
        {board.needsAttention === 0
          ? 'אין מה לטפל החודש.'
          : <><bdi dir="ltr">{board.needsAttention}</bdi> דורשים טיפול</>}
      </p>

      {/* The reminder is TEXT, not a send. Its own sheet so the words are readable and
          editable before they go out over WhatsApp, which is where these conversations
          already live. */}
      <Sheet open={reminder !== null} onOpenChange={o => { if (!o) setReminder(null); }} title="תזכורת תשלום">
        <div className="space-y-3 px-4 pb-6" dir="rtl">
          <p className="text-[11px] leading-relaxed text-ink-500">
            האפליקציה לא שולחת הודעות על כספים. זה הנוסח — להעתיק לוואטסאפ ולשלוח בעצמך.
          </p>
          <p className="rounded-card bg-page px-3 py-3 text-sm leading-relaxed text-ink-900">{reminderText}</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(reminderText).then(() => setCopied(true)).catch(() => setCopied(false));
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-card bg-brand-600 text-sm font-bold text-white"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'הועתק' : 'העתק'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Kpi({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-card bg-card px-2 py-2.5 text-center">
      <div className={cn('text-lg font-bold tabular-nums', tone)}><bdi dir="ltr">{value}</bdi></div>
      <div className="text-[11px] leading-tight text-ink-500">{label}</div>
    </div>
  );
}

function MoneyRow({ label, value, bold, tone }: { label: string; value: number; bold?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-ink-500">{label}</span>
      <span className={cn('tabular-nums', bold && 'font-bold', tone || 'text-ink-900')}>
        {/* A minus written as a Hebrew-safe sign and isolated: a bare "-₪124" in an RTL
            paragraph puts the sign on the wrong end of the number. */}
        <bdi dir="ltr">{value < 0 ? `−${ils(Math.abs(value))}` : ils(value)}</bdi>
      </span>
    </div>
  );
}

function PaymentRow({
  row, busy, onRemind, onAction,
}: {
  row: PaymentRowView;
  busy?: boolean;
  onRemind?: () => void;
  onAction?: (row: PaymentRowView, action: 'mark_paid' | 'unmark_paid' | 'link_sent' | 'activate' | 'failed') => void;
}) {
  const style = STATE_STYLE[row.state];
  return (
    <div className="flex items-center gap-3 rounded-card bg-card px-3 py-3 text-right">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink-500">
        {initialsOf(row.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-ink-900" dir="auto">{row.name}</span>
          <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold', style.chip)}>
            {style.label}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-ink-400">
          {/* Band and mentor on the payment row on purpose: this is the screen where "who is
              getting coaching" and "who is paying for it" are supposed to sit together. */}
          {row.bandNumber !== null ? <>דבוקה <bdi dir="ltr">{row.bandNumber}</bdi></> : 'ללא דבוקה'}
          {row.coachName && <> · מלווה: <bdi dir="ltr">{row.coachName}</bdi></>}
          {row.monthlyAmountIls !== null && <> · <bdi dir="ltr">{ils(row.monthlyAmountIls)}</bdi></>}
        </p>
        {row.note && <p className="mt-0.5 truncate text-[11px] text-ink-500">{row.note}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* One tap per state, and only the tap that state calls for. A failed standing order
            needs a phone call and not another link; somebody with no link yet needs a link and
            not a reminder about one nobody sent. */}
        {row.state === 'paid' ? (
          <button
            type="button"
            onClick={() => onAction?.(row, 'unmark_paid')}
            disabled={busy || !onAction}
            className="min-h-[44px] rounded-pill px-2.5 text-[11px] font-semibold text-ink-400 disabled:opacity-40"
          >
            בטל סימון
          </button>
        ) : (
          <>
            {row.state === 'awaiting_link' ? (
              <button
                type="button"
                onClick={() => onAction?.(row, 'link_sent')}
                disabled={busy || !onAction}
                className="min-h-[44px] rounded-pill bg-page px-2.5 text-[11px] font-bold text-brand-600 disabled:opacity-40"
              >
                סמן: נשלח קישור
              </button>
            ) : (
              <button
                type="button"
                onClick={onRemind}
                disabled={!onRemind}
                className="min-h-[44px] rounded-pill bg-page px-2.5 text-[11px] font-bold text-brand-600 disabled:opacity-40"
              >
                נוסח תזכורת
              </button>
            )}
            <button
              type="button"
              onClick={() => onAction?.(row, 'mark_paid')}
              disabled={busy || !onAction}
              aria-label={`סמן ששולם · ${row.name}`}
              className="flex min-h-[44px] items-center gap-1 rounded-pill bg-accent-900/10 px-2.5 text-[11px] font-bold text-accent-900 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              שולם
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The fetching wrapper. Manager-only screen; the route refuses everybody else. */
export function AcademyPayments() {
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [data, setData] = useState<{
    board: PaymentBoard | null;
    payouts?: MentorPayout[];
    economics?: TraineeEconomics | null;
    economicsBasis?: { feesRecorded: number; trainees: number; mentorTotalIls: number };
    ratesMissing?: boolean;
    tableMissing?: boolean;
  } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'forbidden' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/academy/payments?period=${encodeURIComponent(period)}`, {
        headers: await apiHeaders(),
      });
      const body = await res.json();
      if (res.status === 403) { setState('forbidden'); return; }
      if (!res.ok) { setState('error'); return; }
      if (body?.tableMissing) { setData(body); setState('missing'); return; }
      setData(body);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [period]);

  useEffect(() => { setState('loading'); void load(); }, [load]);

  const act = useCallback(async (
    row: PaymentRowView,
    action: 'mark_paid' | 'unmark_paid' | 'link_sent' | 'activate' | 'failed',
  ) => {
    setBusy(row.athleteId);
    try {
      const res = await fetch('/api/academy/payments', {
        method: 'POST',
        headers: { ...(await apiHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId: row.athleteId, action, period }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  }, [period, load]);

  if (state === 'loading') return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  if (state === 'forbidden') {
    return (
      <p className="py-6 text-center text-xs leading-relaxed text-ink-400" dir="rtl">
        מסך התשלומים פתוח למנהל בלבד.
      </p>
    );
  }
  if (state === 'missing') {
    // Migration 115 is pasted in by hand like every other one. Named, because "no payments"
    // would send Ofer looking for lost data — the club's payment history is in GO and in Excel.
    return (
      <p className="py-6 text-center text-xs leading-relaxed text-ink-400" dir="rtl">
        טבלאות התשלומים עוד לא הוקמו במסד הנתונים.
        <br />צריך להריץ את מיגרציה <bdi dir="ltr">115</bdi>.
      </p>
    );
  }
  if (state === 'error' || !data?.board) {
    return <p className="py-6 text-center text-xs text-accent-red-ink" dir="rtl">לא הצלחנו לטעון את מסך התשלומים</p>;
  }

  return (
    <PaymentsView
      board={data.board}
      payouts={data.payouts || []}
      economics={data.economics ?? null}
      economicsBasis={data.economicsBasis}
      ratesMissing={data.ratesMissing}
      onShiftMonth={delta => setPeriod(p => shiftMonth(p, delta))}
      onAction={act}
      busy={busy}
    />
  );
}
