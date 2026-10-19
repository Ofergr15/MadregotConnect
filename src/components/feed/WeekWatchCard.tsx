'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, cn, israelToday } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// "השבוע בשעון" AT THE TOP OF THE RUNNER'S FEED (mockup watch-send-next, A5/A6)
//
// Red, and only then, when something the club SENT this week is not on their watch
// (lib/watch/missing.ts): a square per day, what is missing and why, and the one
// thing that fixes it — reconnecting Garmin, after which the waiting sessions go to
// the watch by themselves (lib/watch/reconnect.ts). Green and small, once, after a
// send that all arrived; ✕ hides it until the next send.
// ═════════════════════════════════════════════════════════════════════════════

interface Missing { expected: string[]; missing: string[]; reason: 'disconnected' | 'failed' | null; fixable: boolean }
interface WatchAnswer {
  garminConnected: boolean;
  weekStartDate: string;
  onWatch: string[];
  days?: Record<string, { sentAt: string; ran: boolean }>;
  provider?: string;
  missing?: Missing | null;
}

const DAY_LETTER = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const OK_KEY = 'week-watch-ok-hidden';

export function WeekWatchCard() {
  const { data } = useApi<WatchAnswer>('/api/my-watch');
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => { try { setHidden(localStorage.getItem(OK_KEY)); } catch { /* ignore */ } }, []);
  if (!data || data.provider === 'apple' || !data.missing) return null;
  const m = data.missing;
  if (!m.expected.length) return null;

  const today = israelToday();
  const week = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(data.weekStartDate, i));
  const expected = new Set(m.expected);
  const missing = new Set(m.missing);
  const on = new Set(data.onWatch);

  if (!m.missing.length) {
    // Green, once per send: the newest delivery time is the key ✕ remembers.
    const latest = Object.values(data.days || {}).map((d) => d.sentAt).filter(Boolean).sort().at(-1) || '';
    const fresh = latest && Date.now() - Date.parse(latest) < 36 * 3600 * 1000;
    if (!fresh || hidden === latest) return null;
    return (
      <div className="rounded-[22px] bg-card px-3.5 py-3 shadow-[0_0_0_0.5px_rgba(60,60,67,0.14),0_8px_20px_-14px_rgba(20,24,60,0.2)]">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E3F6EA] text-xl">⌚</span>
          <span className="min-w-0 flex-1">
            {/* "Sent to Garmin", not "on your watch": the app sees the account, never the device
                (2026-10-19 — the 19.10 session was on the account and not on a watch that hadn't synced). */}
            <b className="block text-[15px] text-ink-900">כל אימוני השבוע נשלחו ל־Garmin</b>
            <small className="block text-13 text-ink-500"><bdi dir="ltr">{m.expected.length}</bdi> אימונים · לסנכרן את השעון כדי שיופיעו בו</small>
          </span>
          <button type="button" aria-label="להסתיר" onClick={() => { setHidden(latest); try { localStorage.setItem(OK_KEY, latest); } catch { /* ignore */ } }} className="grid h-11 w-11 place-items-center text-ink-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Squares week={week} today={today} expected={expected} missing={missing} on={on} />
      </div>
    );
  }

  const names = m.missing.map((d) => `${DAY_LETTER[new Date(`${d}T12:00:00`).getDay()]}׳`).join(' ו');
  return (
    <div className="rounded-[22px] bg-card px-3.5 py-3.5 shadow-[0_0_0_2px_#E5383B,0_10px_24px_-14px_rgba(229,56,59,0.45)]">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FDEBEB] text-xl">⌚</span>
        <span className="min-w-0 flex-1">
          <b className="block text-base text-ink-900">
            {m.missing.length === 1 ? 'אימון אחד השבוע לא בשעון שלך' : <><bdi dir="ltr">{m.missing.length}</bdi> אימונים השבוע לא בשעון שלך</>}
          </b>
          <small className="block text-13 text-ink-500">{names} · {m.reason === 'disconnected' ? 'גרמין לא מחובר' : 'גרמין לא קיבל'}</small>
        </span>
      </div>
      <Squares week={week} today={today} expected={expected} missing={missing} on={on} />
      {m.reason === 'disconnected' ? (
        <>
          <Link href="/dashboard/profile?tab=datasource" className="mt-3 flex h-12 w-full items-center justify-center rounded-[14px] bg-brand-600 text-base font-extrabold text-white">לחבר את גרמין</Link>
          <p className="mt-1.5 text-center text-xs text-ink-400">אחרי החיבור הם יגיעו לשעון לבד</p>
        </>
      ) : (
        <p className="mt-2.5 text-center text-13 text-ink-500">{m.fixable ? 'החיבור לגרמין פג. מתחברים מחדש בפרופיל, והאימונים יגיעו לבד.' : 'המאמן רואה את זה ויכול לשלוח שוב.'}</p>
      )}
    </div>
  );
}

function Squares({ week, today, expected, missing, on }: { week: string[]; today: string; expected: Set<string>; missing: Set<string>; on: Set<string> }) {
  return (
    <div className="mt-3 flex gap-1.5" aria-hidden>
      {week.map((d) => {
        const state = missing.has(d) ? 'bad' : on.has(d) && (expected.has(d) || d < today) ? 'ok' : expected.has(d) ? 'way' : 'none';
        return (
          <div key={d} className="flex-1 text-center">
            <div className={cn('grid h-8 place-items-center rounded-[10px] text-sm font-black text-white',
              state === 'ok' && 'bg-[#12A150]', state === 'bad' && 'bg-[#E5383B]', state === 'way' && 'bg-ink-300',
              state === 'none' && 'border-[1.5px] border-dashed border-[#E5E5EB]')}>
              {state === 'ok' ? '✓' : state === 'bad' ? '!' : ''}
            </div>
            <div className={cn('mt-1 text-xs font-bold', d === today ? 'text-ink-900' : 'text-ink-400')}>{DAY_LETTER[new Date(`${d}T12:00:00`).getDay()]}׳</div>
          </div>
        );
      })}
    </div>
  );
}
