'use client';

import { useState } from 'react';
import { Check, Copy, Loader2, RotateCcw } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';
import { FLOWS, QUICK_ORDER, type FlowId, type StepStatus } from '@/lib/testing/flows';
import type { FlowStatus } from '@/lib/testing/status';
import type { Check as ReadyCheck } from '@/lib/testing/readiness';

// "בדיקות" — the hand-test screen for the super user (Ofer, 2026-10-20: "there should be
// a screen that shows me what to do"). Each sign-up door as a checklist: what to do, the
// values to paste, and every step's status read live from the database every 4 seconds,
// so nobody has to report back. Readiness on top; test-account cleanup at the bottom.

interface Payload { checks: ReadyCheck[]; summary: { pass: number; warn: number; fail: number }; flows: FlowStatus[]; at: string }

const LEVEL = { PASS: 'bg-[#E8F7EE] text-[#137a3a]', WARN: 'bg-[#FFF4E5] text-[#9a4b00]', FAIL: 'bg-[#FDECEC] text-[#b91c1c]' } as const;
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }) : '');

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const t = document.createElement('textarea'); t.value = value; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return (
    <div className="flex min-h-[48px] items-center gap-2 border-t border-page py-1.5 first:border-t-0">
      <span className="w-24 shrink-0 text-[13px] font-bold text-ink-500">{label}</span>
      <bdi dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[15px] font-bold text-ink-900">{value}</bdi>
      <button type="button" onClick={copy} className={cn('flex min-h-[40px] min-w-[84px] items-center justify-center gap-1 rounded-xl text-[13px] font-black', done ? 'bg-[#E8F7EE] text-[#137a3a]' : 'bg-brand-600 text-white')}>
        {done ? <><Check className="h-4 w-4" />הועתק</> : <><Copy className="h-4 w-4" />העתקה</>}
      </button>
    </div>
  );
}

function StepCard({ def, st, onFix, busy }: { def: (typeof FLOWS)[number]['steps'][number]; st: StepStatus; onFix: (s: StepStatus) => void; busy: boolean }) {
  const open = st.state === 'next' || st.state === 'stuck';
  return (
    <div className={cn('rounded-2xl bg-card p-3.5', st.state === 'next' && 'ring-2 ring-brand-600', st.state === 'stuck' && 'ring-2 ring-accent-red', st.state === 'waiting' && 'opacity-60')}>
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-black',
          st.state === 'done' ? 'bg-[#16A34A] text-white' : st.state === 'stuck' ? 'bg-accent-red text-white' : st.state === 'next' ? 'bg-brand-600 text-white' : 'bg-page text-ink-400')}>
          {st.state === 'done' ? <Check className="h-4 w-4" strokeWidth={3} /> : st.state === 'stuck' ? '!' : '·'}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-[15.5px] text-ink-900">{def.title}{st.state === 'done' && st.at ? <span className="ms-1.5 text-[13px] font-bold text-[#137a3a]">✓ <bdi dir="ltr">{time(st.at)}</bdi></span> : null}</b>
          <small className="block text-[12.5px] text-ink-400">{def.where === 'פרטי' ? 'בכרטיסייה הפרטית (הנבדק)' : def.where === 'האפליקציה שלך' ? 'באפליקציה הרגילה שלך' : def.where}{st.note ? ` · ${st.note}` : ''}</small>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {st.state === 'stuck' && st.note && <p className="rounded-xl bg-[#FDECEC] px-3 py-2 text-[13.5px] font-bold text-[#b91c1c]">{st.note}</p>}
          {st.fix && (
            <button type="button" disabled={busy} onClick={() => onFix(st)} className="min-h-[44px] w-full rounded-xl bg-accent-red text-[14px] font-black text-white disabled:opacity-50">{st.fix.label}</button>
          )}
          {def.where !== 'אוטומטי' && (
            <ol className="list-decimal space-y-1 ps-5 text-[14.5px] leading-relaxed text-ink-900">
              {def.do.map((d, i) => <li key={i}>{d}</li>)}
            </ol>
          )}
          {def.where === 'אוטומטי' && <p className="text-[13.5px] text-ink-500">מחכים — מתעדכן לבד.</p>}
          {def.expect && <p className="rounded-xl bg-[#EEF0FF] px-3 py-2 text-[13.5px] text-ink-900"><b>מה אמור להגיע:</b> {def.expect}</p>}
          {def.look && <p className="text-[12.5px] text-ink-400">איפה בודקים: {def.look}</p>}
          {def.values && def.values.length > 0 && (
            <div className="rounded-xl bg-page px-3">{def.values.map((v) => <CopyRow key={v.label} {...v} />)}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TestsPage() {
  const { data, error, mutate } = useApi<Payload>('/api/admin/tests', { refreshInterval: 4000 });
  const [tab, setTab] = useState<FlowId>('club');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const post = async (body: object) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/tests', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      await mutate();
      return { ok: res.ok, out };
    } finally { setBusy(false); }
  };
  const onFix = async (s: StepStatus) => { if (s.fix) await post({ action: s.fix.action, ...s.fix.payload }); };
  const cleanup = async () => {
    if (!window.confirm('למחוק את כל חשבונות הבדיקה של היום (+club20, +academy20, +movein20, +import20)? חשבונות אמיתיים לא נוגעים.')) return;
    const { ok, out } = await post({ action: 'cleanup', confirm: 'מחיקה' });
    setMsg(ok ? (out.blocked ? `נמחק חלקית — ${out.blocked}` : 'נוקה. אפשר להתחיל מחדש.') : 'הניקוי נכשל');
  };

  if (error) return <p className="p-6 text-center text-ink-500">המסך הזה למנהל־העל בלבד.</p>;
  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;
  const flow = FLOWS.find((f) => f.id === tab)!;
  const st = data.flows.find((f) => f.id === tab)!;
  const done = st.steps.filter((s) => s.state === 'done').length;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-24 pt-2">
      <header>
        <h1 className="text-[28px] font-black text-ink-900">בדיקות הרשמה</h1>
        <p className="text-[13px] text-ink-400">מתעדכן כל כמה שניות · <bdi dir="ltr">{time(data.at)}</bdi></p>
      </header>

      <section className="rounded-2xl bg-card p-3.5">
        <div className="flex items-center justify-between">
          <b className="text-[15px]">מוכנות</b>
          <span className="text-[13px] font-bold"><span className="text-[#137a3a]">{data.summary.pass} תקין</span>{data.summary.warn ? <> · <span className="text-[#9a4b00]">{data.summary.warn} לתשומת לב</span></> : null}{data.summary.fail ? <> · <span className="text-[#b91c1c]">{data.summary.fail} חוסם</span></> : null}</span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {data.checks.filter((c) => c.level !== 'PASS').concat(data.checks.filter((c) => c.level === 'PASS')).map((c, i) => (
            <li key={i} className="flex gap-2 text-[13px]"><span className={cn('shrink-0 rounded-md px-1.5 font-black', LEVEL[c.level])}>{c.level === 'PASS' ? '✓' : c.level === 'WARN' ? '!' : '✕'}</span><span><b>{c.label}</b> · <span className="text-ink-500">{c.detail}</span></span></li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-card p-3.5">
        <b className="text-[15px]">הסדר המהיר</b>
        <ol className="mt-1.5 list-decimal space-y-1 ps-5 text-[13.5px] leading-relaxed text-ink-700">{QUICK_ORDER.map((q, i) => <li key={i}>{q}</li>)}</ol>
      </section>

      <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {FLOWS.map((f) => {
          const s = data.flows.find((x) => x.id === f.id)!;
          const n = s.steps.filter((x) => x.state === 'done').length;
          return (
            <button key={f.id} type="button" onClick={() => setTab(f.id)} className={cn('min-h-[44px] shrink-0 rounded-full px-4 text-[14px] font-black', tab === f.id ? 'bg-brand-600 text-white' : 'bg-card text-ink-900')}>
              {f.title} <bdi dir="ltr" className="opacity-75">{n}/{s.steps.length}</bdi>
            </button>
          );
        })}
      </nav>

      <section className="space-y-2.5">
        <div className="px-1">
          <p className="text-[14px] text-ink-700">{flow.goal}</p>
          <details className="mt-1 text-[13px] text-ink-500"><summary className="cursor-pointer font-bold">נתקעת?</summary><ul className="mt-1 list-disc ps-5">{flow.stuck.map((x, i) => <li key={i}>{x}</li>)}</ul></details>
          <p className="mt-1 text-[13px] text-ink-400">מייל הבדיקה: <bdi dir="ltr" className="font-bold text-ink-700">{flow.email}</bdi> · {done}/{st.steps.length} שלבים</p>
          {tab === 'import' && !st.steps.find((s) => s.key === 'card' && s.state === 'done') && (
            <button type="button" disabled={busy} onClick={() => post({ action: 'create-import-card' })} className="mt-2 min-h-[44px] w-full rounded-xl bg-brand-600 text-[14px] font-black text-white disabled:opacity-50">ליצור כרטיס בדיקה מהקובץ</button>
          )}
        </div>
        {flow.steps.map((def) => {
          const s = st.steps.find((x) => x.key === def.key);
          return s ? <StepCard key={def.key} def={def} st={s} onFix={onFix} busy={busy} /> : null;
        })}
      </section>

      <section className="rounded-2xl bg-card p-3.5">
        <b className="block text-[15px]">ניקוי חשבונות בדיקה</b>
        <p className="mt-1 text-[13px] text-ink-500">מוחק רק את 4 כתובות הבדיקה של היום וכל מה שנוצר להן. מתחילים מחדש.</p>
        <button type="button" disabled={busy} onClick={cleanup} className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-page text-[14px] font-black text-accent-red disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}ניקוי והתחלה מחדש
        </button>
        {msg && <p className="mt-2 text-[13px] font-bold text-ink-700">{msg}</p>}
      </section>
    </div>
  );
}
