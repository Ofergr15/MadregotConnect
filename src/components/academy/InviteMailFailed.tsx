'use client';

import { useState } from 'react';
import { sendJson } from './completion/shared';

/**
 * A move-in mail that did not go out (email_log: refused / failed / bounced / skipped), on
 * its own card: red, with the provider's reason, and "שליחה חוזרת" — the same mail, the
 * same link, to this one person (POST /api/academy/members/invite/resend).
 */
export function InviteMailFailed({ cardId, kind, error, onResent }: {
  cardId: string; kind: 'form' | 'install'; error: string | null; onResent?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const resend = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await sendJson<{ emailed: boolean; error?: string }>('POST', '/api/academy/members/invite/resend', { cardId, kind });
      setMsg(r.emailed ? { ok: true, text: 'נשלח שוב ✓' } : { ok: false, text: `שוב לא נשלח${r.error ? ` — ${r.error}` : ''}` });
      if (r.emailed) await onResent?.();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setMsg({ ok: status === 429, text: status === 429 ? 'כבר נשלח עכשיו — רגע לפני שמנסים שוב' : 'השליחה החוזרת נכשלה' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-4 mb-3 rounded-xl bg-[#FEE2E2] px-3 py-2.5" role="alert">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13.5px] font-extrabold text-[#B91C1C]">
          {kind === 'form' ? 'המייל לא נשלח (טופס הפרטים)' : 'המייל לא נשלח (מייל ההתקנה)'}
        </p>
        <button type="button" onClick={() => void resend()} disabled={busy}
          className="min-h-[36px] shrink-0 rounded-lg bg-white px-3 text-[13px] font-extrabold text-[#B91C1C] disabled:opacity-50">
          {busy ? 'שולח…' : 'שליחה חוזרת'}
        </button>
      </div>
      {error && <p className="mt-0.5 break-all text-[12px] text-[#7F1D1D]"><bdi dir="ltr">{error}</bdi></p>}
      {msg && <p className={msg.ok ? 'mt-1 text-[12.5px] font-bold text-[#16A34A]' : 'mt-1 text-[12.5px] font-bold text-[#B91C1C]'} role="status">{msg.text}</p>}
    </div>
  );
}
