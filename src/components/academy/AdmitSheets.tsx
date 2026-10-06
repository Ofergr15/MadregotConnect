'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LoadingBlock, Sheet } from '@/components/ui';
import { joinHebrewList } from '@/lib/academy/members';
import { ASSIGN_COACHES_LABEL, ONE_COACH_UNTIL_UPDATE } from '@/lib/academy/coach-picker';
import { CoachesPicker } from './CoachesPicker';

// ── Sending the form, and letting somebody in ────────────────────────────────
//
// The two actions on a funnel card that write to a stranger. Both sheets show the
// mail itself before it goes — the server builds the preview with the very
// function the send uses (lib/email: academyInviteEmail / academyAcceptedEmail),
// so what the coach reads here is what arrives, not a description of it.

export interface CandidateEmail {
  id: string;
  template: string;
  status: string;
  createdAt: string;
  error: string | null;
}

/** An academy coach the accept can pair with; `trainees` when the caller knows the load. */
export interface FunnelCoach { id: string; name: string; trainees?: number }

const TEMPLATE_LABEL: Record<string, string> = {
  academy_invite: 'הזמנה לטופס',
  academy_form_received: 'אישור טופס',
  academy_accepted: 'התקבלת',
  academy_approved: 'התקבלת',
};

/** What happened to it, as far as anyone knows. `sent` is only "Resend took it";
 *  the webhook is what promotes it to delivered or bounced. */
const STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'wait' }> = {
  delivered: { label: 'נמסר', tone: 'ok' },
  sent: { label: 'נשלח', tone: 'wait' },
  delayed: { label: 'מתעכב', tone: 'wait' },
  bounced: { label: 'חזר', tone: 'bad' },
  complained: { label: 'סומן כספאם', tone: 'bad' },
  refused: { label: 'נדחה', tone: 'bad' },
  failed: { label: 'נכשל', tone: 'bad' },
  skipped: { label: 'לא נשלח', tone: 'bad' },
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
}

export function EmailHistory({ emails }: { emails: CandidateEmail[] }) {
  if (!emails.length) return null;
  return (
    <div className="mt-5">
      <h3 className="mb-1.5 text-xs font-bold text-ink-500">מיילים</h3>
      <ul className="divide-y divide-page rounded-card bg-page">
        {emails.map(e => {
          const s = STATUS[e.status] ?? { label: e.status, tone: 'wait' as const };
          return (
            <li key={e.id} className="flex min-h-[44px] items-center justify-between gap-2 px-3.5 py-2 text-sm">
              <span className="min-w-0 truncate text-ink-700" dir="auto">
                {TEMPLATE_LABEL[e.template] ?? e.template}
                <span className="text-xs text-ink-400"> · <bdi dir="ltr">{when(e.createdAt)}</bdi></span>
              </span>
              <span
                title={e.error ?? undefined}
                className={cn(
                  'shrink-0 text-xs font-bold',
                  s.tone === 'ok' ? 'text-accent-600' : s.tone === 'bad' ? 'text-accent-red-ink' : 'text-ink-400',
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function patchCandidate(body: Record<string, unknown>) {
  const res = await fetch('/api/academy/candidates', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

/** The mail, rendered. Sandboxed with no permissions: it is our own html, but
 *  nothing in a preview should be able to run or navigate. */
function MailPreview({ html, to }: { html: string | null; to: string | null }) {
  return (
    <div className="mt-3 overflow-hidden rounded-card border border-page bg-page">
      <div className="px-3 py-2 text-xs text-ink-500" dir="auto">
        אל: {to ? <bdi dir="ltr">{to}</bdi> : <span className="text-accent-red-ink">אין מייל בכרטיס</span>}
      </div>
      {html
        ? <iframe title="תצוגה מקדימה של המייל" sandbox="" srcDoc={html} className="block h-[380px] w-full bg-white" />
        : <LoadingBlock />}
    </div>
  );
}

function sendError(json: any, fallback: string): string {
  if (json?.code === 'needs-126') return 'צריך קודם להריץ את מיגרציה 126.';
  if (json?.code === 'no_schema') return ONE_COACH_UNTIL_UPDATE;
  if (json?.email && json.email.ok === false) return `המייל לא יצא: ${json.email.reason}`;
  return json?.error || fallback;
}

export function InviteSheet({
  open, onOpenChange, candidateId, candidateName, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateId: string;
  candidateName: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [previewNote, setPreviewNote] = useState('');
  const [preview, setPreview] = useState<{ html: string; to: string | null } | null>(null);
  const [busy, setBusy] = useState<'send' | 'copy' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => { if (open) { setNote(''); setPreviewNote(''); setMessage(null); setLink(null); } }, [open, candidateId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    void patchCandidate({ id: candidateId, action: 'invite', preview: true, note: previewNote }).then(({ ok, json }) => {
      if (live && ok) setPreview({ html: json.html, to: json.to ?? null });
    });
    return () => { live = false; };
  }, [open, candidateId, previewNote]);

  async function run(send: boolean) {
    setBusy(send ? 'send' : 'copy');
    setMessage(null);
    try {
      const { ok, json } = await patchCandidate({ id: candidateId, action: 'invite', send, note });
      if (!ok || (send && json.email?.ok === false)) {
        setMessage({ ok: false, text: sendError(json, 'לא הצלחנו לשלוח') });
        if (ok) onDone();
        return;
      }
      if (!send) {
        setLink(json.url);
        try {
          await navigator.clipboard.writeText(json.url);
          setMessage({ ok: true, text: 'הקישור הועתק — אפשר להדביק בוואטסאפ' });
        } catch {
          setMessage({ ok: true, text: 'העתיקו את הקישור מכאן:' });
        }
      } else {
        setMessage({ ok: true, text: 'ההזמנה נשלחה' });
      }
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`הזמנה לטופס · ${candidateName}`}>
      <div className="px-4 pb-6">
        <p className="text-xs text-ink-500" dir="auto">
          קישור אישי לטופס, עם השם, המייל והטלפון כבר ממולאים. השליחה מסמנת את הכרטיס, והטופס כשימולא יסמן ״טופס ✓״ לבד.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-semibold text-ink-500">מילה אישית (לא חובה)</span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={() => setPreviewNote(note)}
            rows={2}
            maxLength={500}
            placeholder="היי, היה כיף לדבר…"
            className="w-full rounded-card bg-page px-3 py-2.5 text-[16px] text-ink-900 placeholder:text-ink-400"
            dir="auto"
          />
        </label>

        <MailPreview html={preview?.html ?? null} to={preview?.to ?? null} />

        {message && (
          <p className={cn('mt-3 text-sm', message.ok ? 'text-accent-600' : 'text-accent-red-ink')} dir="auto">
            {message.text}
          </p>
        )}
        {link && (
          <p className="mt-1 select-all break-all rounded-card bg-page px-3 py-2 text-xs text-ink-700">
            <bdi dir="ltr">{link}</bdi>
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={!!busy || !preview?.to}
            className="flex flex-[2] min-h-[48px] items-center justify-center gap-1.5 rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {busy === 'send' ? 'שולח…' : 'שליחה במייל'}
          </button>
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={!!busy}
            className="flex flex-1 min-h-[48px] items-center justify-center gap-1.5 rounded-card bg-page text-sm font-bold text-ink-700 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            {busy === 'copy' ? '…' : 'העתקת קישור'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function AcceptSheet({
  open, onOpenChange, candidateId, candidateName, coaches, isManager, myId, linked, multiCoach, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateId: string;
  candidateName: string;
  coaches: FunnelCoach[];
  isManager: boolean;
  myId: string | null;
  /** No athlete row means nothing to let in yet; the sheet says what to do instead. */
  linked: boolean;
  /** `false` before migration 135: one coach. Unknown (the funnel) = the server says. */
  multiCoach?: boolean;
  onDone: () => void;
}) {
  // "שיבוץ מאמנים" at the door: one coach or several, all equal (migration 135).
  const [coachIds, setCoachIds] = useState<string[]>(myId ? [myId] : []);
  const [preview, setPreview] = useState<{ html: string; to: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const previewKey = coachIds.join(',');

  // The default is set once per opening. Not on every `coaches` change: the
  // funnel reloads its payload after the accept (onDone), and re-defaulting then
  // wiped the coaches just picked off the sheet that reports the accept.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { seeded.current = null; return; }
    if (seeded.current === candidateId || !coaches.length) return;
    seeded.current = candidateId;
    setMessage(null);
    const mine = coaches.find(c => c.id === myId);
    setCoachIds(mine ? [mine.id] : [coaches[0].id]);
  }, [open, candidateId, coaches, myId]);

  useEffect(() => {
    if (!open || !linked || !previewKey) return;
    let live = true;
    setPreview(null);
    void patchCandidate({ id: candidateId, action: 'accept', preview: true, coachIds: previewKey.split(',') }).then(({ ok, json }) => {
      if (!live) return;
      if (ok) setPreview({ html: json.html, to: json.to ?? null });
      else setMessage({ ok: false, text: json?.error || 'לא הצלחנו להכין את המייל' });
    });
    return () => { live = false; };
  }, [open, candidateId, previewKey, linked]);

  async function accept() {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, json } = await patchCandidate({ id: candidateId, action: 'accept', coachIds });
      if (!ok) { setMessage({ ok: false, text: sendError(json, 'הקבלה נכשלה') }); return; }
      onDone();
      if (json.email && json.email.ok === false) {
        setMessage({ ok: false, text: `התקבל/ה, אבל המייל לא יצא: ${json.email.reason}` });
        return;
      }
      setMessage({ ok: true, text: `התקבל/ה לאקדמיה אצל ${json.coachName}` });
    } finally {
      setBusy(false);
    }
  }

  const pickerCoaches = coaches.map(c => ({ coachId: c.id, coachName: c.id === myId ? `${c.name} (אני)` : c.name, trainees: c.trainees }));
  const names = joinHebrewList(coachIds.map(id => coaches.find(c => c.id === id)?.name || '').filter(Boolean));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`קבלה לאקדמיה · ${candidateName}`}>
      <div className="px-4 pb-6">
        {!linked ? (
          <p className="rounded-card bg-page px-3 py-3 text-sm text-ink-700" dir="auto">
            לכרטיס עוד אין חשבון באפליקציה. מי שממלא את הטופס מקבל חשבון לבד; אחרת — חברו אותו בשורה ״חשבון באפליקציה״ בכרטיס.
          </p>
        ) : (
          <>
            <p className="mb-1.5 px-1 text-[11px] font-semibold text-ink-500">{ASSIGN_COACHES_LABEL}</p>
            {isManager ? (
              <CoachesPicker
                coaches={pickerCoaches}
                value={coachIds}
                onChange={setCoachIds}
                sets={[[]]}
                multi={multiCoach !== false}
                showLoad={coaches.some(c => typeof c.trainees === 'number')}
              />
            ) : (
              <p className="rounded-card bg-page px-3 py-3 text-sm text-ink-700" dir="auto">{names || 'אין מאמן'}</p>
            )}
            <p className="mt-2 text-xs text-ink-500" dir="auto">
              הקבלה מאשרת את החשבון, משייכת למאמנים שסימנתם, ושולחת מייל ״התקבלת״ עם קישור כניסה דרך Strava. Garmin — אחר כך, לא חובה.
            </p>
            <MailPreview html={preview?.html ?? null} to={preview?.to ?? null} />
          </>
        )}

        {message && (
          <p className={cn('mt-3 flex items-center gap-1.5 text-sm', message.ok ? 'text-accent-600' : 'text-accent-red-ink')} dir="auto" role={message.ok ? 'status' : 'alert'}>
            {message.ok && <Check className="h-4 w-4" />}
            {message.text}
          </p>
        )}

        {linked && (
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy || !coachIds.length || message?.ok === true}
            className="mt-4 flex w-full min-h-[48px] items-center justify-center gap-1.5 rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'שולח…' : coachIds.length > 1 ? `קבלה ושליחה · ${coachIds.length} מאמנים` : 'קבלה ושליחה'}
          </button>
        )}
      </div>
    </Sheet>
  );
}
