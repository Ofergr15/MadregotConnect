'use client';

import { useCallback, useRef, useState } from 'react';
import { apiHeaders, useApi } from '@/lib/api';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/utils';

// "Add to the core?" (mockup ~/.cache/madregot/core-add, Ofer 10-27): before anyone is put
// into — or taken out of — the core, who it is, and the pushes that will go to them as they
// will read them, each with its own switch and editable text. Nothing is written until ✓.
// One sheet for the three places that add core runners (settings, the core manager, numbers).

interface Preview {
  person: { name: string | null; group: string | null; since: string | null; runs8: number; km8: number; quality8: number };
  welcome: { title: string; body: string };
  podium: { roundId: string; title: string; locksAt: string; copy: { title: string; body: string } } | null;
}
interface Ask { id: string; name: string; adding: boolean; resolve: (r: Response | null) => void }

const first = (n: string) => n.trim().split(/\s+/)[0] || n;
const dm = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Jerusalem' }) : '');
const when = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });

/** `ask(person, adding)` opens the sheet; resolves with the PUT's response, or null when cancelled. */
export function useCoreConfirm() {
  const [cur, setCur] = useState<Ask | null>(null);
  const ask = useCallback((p: { id: string; name: string }, adding: boolean) => new Promise<Response | null>((resolve) => setCur({ ...p, adding, resolve })), []);
  const sheet = <CoreAddSheet ask={cur} onClose={() => setCur(null)} />;
  return { ask, sheet };
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={cn('relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors', on ? 'bg-[#34c759]' : 'bg-ink-300/60')}>
      <span className={cn('absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'start-[23px]' : 'start-[3px]')} />
    </button>
  );
}

function PushCard({ icon, label, sub, on, setOn, title, body, setTitle, setBody }: {
  icon: string; label: string; sub: string; on: boolean; setOn: (v: boolean) => void;
  title: string; body: string; setTitle: (v: string) => void; setBody: (v: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  return (
    <section className={cn('rounded-[18px] bg-card px-3.5 py-3', !on && 'opacity-60')}>
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">{icon} {label}</b><small className="text-12 text-ink-400">{on ? sub : 'כבוי — לא תישלח התראה'}</small></span>
        <Switch on={on} onChange={setOn} />
      </div>
      {on && (
        <>
          <div className="mt-2.5 flex gap-2.5 rounded-[14px] bg-page px-3 py-2.5">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-brand-600 text-[11px] font-black text-white">MC</span>
            <span className="min-w-0 flex-1"><b dir="auto" className="block text-[13.5px] text-ink-900">{title}</b><span dir="auto" className="text-[12.5px] text-ink-700">{body}</span></span>
            <em className="shrink-0 text-[11px] not-italic text-ink-400">עכשיו</em>
          </div>
          {edit ? (
            <div className="mt-2 space-y-1.5">
              <input value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} dir="auto" rows={2} className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm" />
            </div>
          ) : (
            <button type="button" onClick={() => setEdit(true)} className="mt-1.5 min-h-[32px] text-[13px] font-bold text-[#007aff]">✏️ לשנות את הטקסט</button>
          )}
        </>
      )}
    </section>
  );
}

function CoreAddSheet({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  const { data } = useApi<Preview>(ask?.adding ? `/api/admin/core-runners/preview?athleteId=${ask.id}` : null);
  const [welcomeOn, setWelcomeOn] = useState(true);
  const [podiumOn, setPodiumOn] = useState(true);
  const [wt, setWt] = useState<string | null>(null); const [wb, setWb] = useState<string | null>(null);
  const [pt, setPt] = useState<string | null>(null); const [pb, setPb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  if (ask && shown.current !== ask.id) { shown.current = ask.id; setWelcomeOn(true); setPodiumOn(true); setWt(null); setWb(null); setPt(null); setPb(null); setDone(null); }
  if (!ask && !done) return null;

  const name = ask ? first(ask.name) : '';
  const p = data?.person;
  const podium = data?.podium ?? null;
  const pushes = ask?.adding ? (welcomeOn ? 1 : 0) + (podium && podiumOn ? 1 : 0) : 0;
  const close = (r: Response | null) => { ask?.resolve(r); onClose(); };
  const confirm = async () => {
    if (!ask) return;
    setBusy(true);
    const res = await fetch('/api/admin/core-runners', {
      method: 'PUT', headers: await apiHeaders(true),
      body: JSON.stringify({
        athleteId: ask.id, isCoreRunner: ask.adding,
        notify: ask.adding && welcomeOn,
        welcomeTitle: wt ?? undefined, welcomeBody: wb ?? undefined,
        podium: ask.adding && !!podium && podiumOn, podiumTitle: pt ?? undefined, podiumBody: pb ?? undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok && ask.adding) {
      const out = await res.clone().json().catch(() => ({}));
      const sent = [welcomeOn ? 'ברוך הבא' : null, out.podiumSent ? 'ההזמנה מהחנות' : null].filter(Boolean);
      setDone(`✓ ${name} בגרעין${sent.length && pushes ? ` · נשלחו ${sent.length === 1 ? 'התראה' : `${sent.length} התראות`}: ${sent.join(' · ')}` : ''}`);
      setTimeout(() => setDone(null), 4000);
    }
    close(res);
  };

  return (
    <>
      <Sheet open={!!ask} onOpenChange={(o) => { if (!o && !busy) close(null); }} title="">
        {ask && (
          <div className="space-y-2.5 px-3.5 pb-6" dir="rtl">
            <div className="px-0.5">
              <h2 className="text-[20px] font-black text-ink-900">{ask.adding ? `להוסיף את ${name} לגרעין?` : `להסיר את ${name} מהגרעין?`}</h2>
              <p className="text-[13.5px] text-ink-500">{ask.adding ? 'יקבל/תקבל את כל ההטבות של רצי הגרעין ואת ההזמנות של החנות.' : 'ההטבות וההזמנות של הגרעין ייסגרו בפניו/ה. בלי התראה.'}</p>
            </div>
            {ask.adding && (
              <section className="rounded-[18px] bg-card px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-[#c7d2fe] text-[20px] font-black text-[#3730a3]">{name.slice(0, 1)}</span>
                  <span className="min-w-0"><b dir="auto" className="block text-[17px] text-ink-900">{p?.name ?? ask.name}</b>
                    <small className="text-12 leading-relaxed text-ink-500">{[p?.group, p?.since ? `במועדון מ־${dm(p.since)}` : null].filter(Boolean).join(' · ')}</small></span>
                </div>
                <div className="mt-2.5 flex gap-1.5 text-center">
                  {[[p?.runs8, 'ריצות ב־8 שב׳'], [p?.km8, 'ק״מ'], [p?.quality8, 'אימוני איכות']].map(([v, l]) => (
                    <div key={String(l)} className="flex-1 rounded-xl bg-page px-1 py-2"><b className="block text-[16px] text-ink-900">{v ?? '…'}</b><span className="text-[11px] text-ink-400">{l}</span></div>
                  ))}
                </div>
              </section>
            )}
            {ask.adding && data && (
              <PushCard icon="🌟" label="התראת ברוך הבא" sub="נשלחת עכשיו, רק אליו/ה" on={welcomeOn} setOn={setWelcomeOn}
                title={wt ?? data.welcome.title} body={wb ?? data.welcome.body} setTitle={setWt} setBody={setWb} />
            )}
            {ask.adding && data && (podium ? (
              <PushCard icon="🛍️" label={`${podium.title} פתוחה`} sub={`נסגרת ${when(podium.locksAt)} · רק אליו/ה`} on={podiumOn} setOn={setPodiumOn}
                title={pt ?? podium.copy.title} body={pb ?? podium.copy.body} setTitle={setPt} setBody={setPb} />
            ) : (
              <section className="rounded-[18px] bg-card px-3.5 py-3"><b className="block text-[15px] text-ink-900">🛍️ הזמנה מהחנות</b><small className="text-12 text-ink-400">אין כרגע הזמנה פתוחה — כשתיפתח, יקבל/תקבל אותה עם כולם.</small></section>
            ))}
            <button type="button" disabled={busy || (ask.adding && !data)} onClick={() => void confirm()}
              className="min-h-[54px] w-full rounded-[16px] bg-ink-900 text-[16px] font-black text-white disabled:opacity-50">
              {busy ? '…' : !ask.adding ? `✓ להסיר מהגרעין` : pushes ? `✓ להוסיף לגרעין ולשלוח ${pushes === 1 ? 'התראה' : `${pushes} התראות`}` : '✓ להוסיף לגרעין, בלי התראה'}
            </button>
            <button type="button" disabled={busy} onClick={() => close(null)} className="min-h-[44px] w-full text-[15px] font-bold text-[#007aff]">ביטול</button>
          </div>
        )}
      </Sheet>
      {done && <div role="status" className="fixed inset-x-3.5 bottom-24 z-[80] rounded-[18px] bg-card px-4 py-3 text-[14px] font-bold text-ink-900 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.3)]" dir="rtl">{done}</div>}
    </>
  );
}
