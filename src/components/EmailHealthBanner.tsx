'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, MailX } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * "Mail is broken, here is why, here is the fix" — on the screen where mail matters.
 *
 * ⚠️ THIS IS THE POINT OF THE WHOLE EMAIL REWRITE. The failure that lost the club's
 * approval links was not a hard error; it was a state nobody could see. Production had
 * an API key, so every check said configured, while the FROM address was Resend's
 * sandbox sender and every send to a member was refused. The refusals were real, they
 * were just nowhere.
 *
 * So the diagnosis is rendered where a person is about to depend on it — above the
 * approval queue — and it says the fix, not just the fault. It renders NOTHING when
 * mail is healthy: a permanent green tick is something you stop reading, and this must
 * still be alarming in six months.
 */

interface Health {
  level: 'ok' | 'blocked' | 'off';
  code: string;
  from: string;
  title: string;
  detail: string;
  fix: string;
}

interface Failure {
  id: string;
  at: string;
  template: string;
  to: string[];
  status: string;
  code: string | null;
  message: string | null;
}

export default function EmailHealthBanner() {
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ health?: Health; logged?: boolean; failed?: number; recent?: Failure[] }>(
    '/api/admin/email-health',
  );

  const health = data?.health;
  const failures = data?.recent || [];
  const failed = data?.failed || 0;

  // Nothing to say when mail works and nothing has bounced. Silence is the healthy
  // state — see above.
  if (!health) return null;
  if (health.level === 'ok' && failed === 0) return null;

  const blocked = health.level !== 'ok';
  const Icon = health.level === 'off' ? MailX : AlertTriangle;

  return (
    <div
      className={cn(
        'mt-3 rounded-card overflow-hidden',
        // Red for "nothing you send will arrive", amber-ish ink for "some of it didn't".
        blocked ? 'bg-accent-red/10 border border-accent-red/25' : 'bg-page border border-ink-300/40',
      )}
    >
      <div className="p-3.5">
        <div className="flex items-start gap-2.5">
          <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', blocked ? 'text-accent-red' : 'text-ink-500')} />
          <div className="min-w-0 flex-1">
            <p className={cn('text-13 font-bold leading-snug', blocked ? 'text-accent-red-ink' : 'text-ink-900')}>
              {blocked ? health.title : `${failed} מיילים לא הגיעו ליעד`}
            </p>
            <p className="mt-1 text-3xs text-ink-500 leading-relaxed">
              {blocked ? health.detail : 'האישורים עצמם עברו — המיילים נדחו או חזרו. אפשר לשלוח את הקישורים ידנית מהטאב "אושרו".'}
            </p>
            {/* The fix, verbatim and copyable. A banner that says "misconfigured"
                without saying what to set is a banner that gets ignored. */}
            {blocked && health.fix && (
              <p className="mt-2 text-3xs font-semibold text-ink-900 leading-relaxed">
                <span className="text-ink-500">התיקון: </span>
                <span dir="ltr" className="select-all">{health.fix}</span>
              </p>
            )}
          </div>
        </div>

        {(failures.length > 0 || data?.logged === false) && (
          <button
            onClick={() => setOpen(v => !v)}
            className="mt-2.5 flex items-center gap-1 text-3xs font-semibold text-ink-500 min-h-[32px]"
          >
            {open ? 'סגירה' : `פירוט (${failures.length})`}
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-ink-300/30 bg-card/60">
          {data?.logged === false && (
            <p className="px-3.5 py-2.5 text-3xs text-ink-500 leading-relaxed">
              אין היסטוריה — צריך להריץ את <code dir="ltr">supabase/migrations/096_email_log.sql</code> ב-Supabase SQL editor.
              עד אז לא נשמר תיעוד של שליחות.
            </p>
          )}
          {failures.map(f => (
            <div key={f.id} className="px-3.5 py-2 border-b border-page last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span dir="ltr" className="text-3xs font-semibold text-ink-900 truncate">{f.to.join(', ')}</span>
                <span className="text-3xs font-bold text-accent-red shrink-0">{f.status}</span>
              </div>
              {/* Resend's own words. Ours would be a paraphrase of an error we have
                  never seen, and this is the string that names the actual cause. */}
              {f.message && (
                <p dir="ltr" className="mt-0.5 text-3xs text-ink-400 leading-relaxed text-left">{f.message}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
