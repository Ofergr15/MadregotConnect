'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { CampaignTotals, RecipientState } from '@/lib/email/tracking';

// ═════════════════════════════════════════════════════════════════════════════
// ניהול ← מרכז המיילים (b25, flag `email_center`, admin only).
// Preview every club mail, send a test to yourself, compose the "עדכונים" newsletter,
// and see per send who received / opened / clicked — with resend to who hasn't opened.
// Nothing reaches the club without a test first and a typed confirmation.
// ═════════════════════════════════════════════════════════════════════════════

const API = '/api/admin/email-center';
const CONFIRM = 'שלח לכולם';

interface Campaign {
  id: string; created_at: string; kind: string; subject: string; status: string;
  sent_at: string | null; recipient_count: number; parent_id: string | null; totals: CampaignTotals;
}
interface ListResp { ready: boolean; campaigns?: Campaign[]; transactional?: Array<{ template: string; totals: CampaignTotals }> }
interface DetailResp {
  ready: boolean; campaign: Campaign; totals: CampaignTotals; unopened: string[];
  recipients: Array<{ logId: string; email: string; name: string | null; state: RecipientState; sentAt: string; openedAt: string | null; clickedAt: string | null; opens: number; clicks: number }>;
}
interface Item { title: string; body: string; href: string; linkLabel: string }

const STATE: Record<RecipientState, { t: string; c: string }> = {
  clicked: { t: 'לחץ/ה על קישור', c: 'bg-[#DCFCE7] text-[#15803d]' },
  opened: { t: 'נפתח*', c: 'bg-[#DCFCE7] text-[#15803d]' },
  delivered: { t: 'נמסר', c: 'bg-[#E0E7FF] text-[#3730a3]' },
  sent: { t: 'נשלח', c: 'bg-[#f1f1f3] text-ink-500' },
  bounced: { t: 'חזר', c: 'bg-[#FEE2E2] text-[#b91c1c]' },
  complained: { t: 'סומן כספאם', c: 'bg-[#FEE2E2] text-[#b91c1c]' },
  failed: { t: 'נכשל', c: 'bg-[#FEE2E2] text-[#b91c1c]' },
  skipped: { t: 'דולג', c: 'bg-[#f1f1f3] text-ink-500' },
};
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }) : '—';

async function post(body: unknown) {
  const res = await fetch(API, { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function Totals({ t }: { t: CampaignTotals }) {
  const cell = (label: string, v: number | string, tone = 'text-ink-900') => (
    <div className="rounded-xl bg-[#FBF6F3] px-3 py-2 text-center"><div className={cn('text-lg font-extrabold', tone)}>{v}</div><div className="text-[11px] text-ink-500">{label}</div></div>
  );
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {cell('נמענים', t.recipients)}
      {cell('נמסרו', t.delivered)}
      {cell('נפתחו*', t.openRate == null ? t.opened : `${t.opened} · ${t.openRate}%`, 'text-[#15803d]')}
      {cell('לחצו', t.clicked)}
      {cell('חזרו', t.bounced, t.bounced ? 'text-[#b91c1c]' : undefined)}
      {cell('נכשלו', t.failed + t.complained, t.failed + t.complained ? 'text-[#b91c1c]' : undefined)}
    </div>
  );
}

const MPP_NOTE = '* פתיחות הן הערכה: Apple Mail (הגנת פרטיות) מסמן כל מייל כ"נפתח", ומי שחוסם תמונות לא נספר. לחיצה על קישור היא הסימן האמין.';

export default function EmailCenterPage() {
  const [tab, setTab] = useState<'preview' | 'compose' | 'sends'>('preview');
  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2"><Mail className="h-5 w-5 text-[#23208F]" /><h1 className="text-xl font-extrabold text-ink-900">מרכז המיילים</h1></div>
      <div className="mb-5 flex gap-2">
        {([['preview', 'תצוגה מקדימה'], ['compose', 'עדכונים למועדון'], ['sends', 'שליחות ומעקב']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('rounded-full px-4 py-1.5 text-sm font-bold', tab === k ? 'bg-[#23208F] text-white' : 'bg-[#f1f1f3] text-ink-700')}>{l}</button>
        ))}
      </div>
      {tab === 'preview' && <PreviewTab />}
      {tab === 'compose' && <ComposeTab onSent={() => setTab('sends')} />}
      {tab === 'sends' && <SendsTab />}
    </div>
  );
}

function Frame({ html }: { html?: string }) {
  return <iframe title="תצוגה מקדימה" srcDoc={html || ''} sandbox="" className="h-[640px] w-full rounded-2xl border border-[#EDE3DC] bg-white" />;
}

function PreviewTab() {
  const [kind, setKind] = useState('welcome');
  const { data, error } = useApi<{ subject: string; html: string }>(`${API}?preview=${kind}`);
  const [msg, setMsg] = useState<string | null>(null);
  const test = async () => {
    setMsg('שולח…');
    const { json } = await post({ action: 'test', kind });
    setMsg(json.ok ? `נשלח מייל בדיקה אל ${json.to}` : `לא נשלח: ${json.reason || json.error || json.status}`);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={e => setKind(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
          <option value="welcome">תודה שנרשמת</option>
          <option value="newsletter">עדכונים (דוגמה)</option>
          <option value="declined">ההרשמה לא אושרה</option>
        </select>
        <button onClick={test} className="rounded-full bg-[#F0643C] px-4 py-2 text-sm font-bold text-white">שלח בדיקה אליי</button>
        {msg && <span className="text-sm text-ink-500">{msg}</span>}
      </div>
      {error ? <p className="text-sm text-[#b91c1c]">לא נטען ({String(error.message || error)})</p> : <>
        <div className="text-sm text-ink-500">נושא: <b className="text-ink-900">{data?.subject}</b></div>
        <Frame html={data?.html} />
      </>}
      <p className="text-xs text-ink-500">שאר המיילים (אישור הרשמה, קוד כניסה, תזכורות) כבר בנויים על אותה תבנית — תצוגות שלהם ב־design/b25/emails.</p>
    </div>
  );
}

function ComposeTab({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [items, setItems] = useState<Item[]>([{ title: '', body: '', href: '', linkLabel: '' }]);
  const [html, setHtml] = useState<string>();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = { title, intro, items };
  const dirty = () => { setCampaignId(null); setTested(false); };

  const preview = async () => {
    const { json } = await post({ action: 'preview', input });
    if (json.html) setHtml(json.html); else setMsg(json.error);
  };
  const saveAndTest = async () => {
    setBusy(true); setMsg('שומר ושולח בדיקה…');
    let id = campaignId;
    if (!id) {
      const c = await post({ action: 'create', input });
      if (!c.json.id) { setBusy(false); return setMsg(c.json.error || 'שמירה נכשלה'); }
      id = c.json.id as string; setCampaignId(id);
    }
    const { json } = await post({ action: 'test', kind: 'newsletter', campaignId: id });
    setBusy(false);
    setTested(!!json.ok);
    setMsg(json.ok ? `בדיקה נשלחה אל ${json.to}. בדקו אותה בתיבה לפני שליחה לכולם.` : `לא נשלח: ${json.reason || json.error}`);
  };
  const sendAll = async () => {
    if (!campaignId) return;
    setBusy(true); setMsg('שולח לכל החברים… (כדקה לכל 100)');
    const { json } = await post({ action: 'send', campaignId, confirm });
    setBusy(false);
    if (json.ok) { setMsg(`נשלח ל־${json.sent} מתוך ${json.recipients}.`); onSent(); } else setMsg(json.error);
  };
  const setItem = (i: number, k: keyof Item, v: string) => { dirty(); setItems(items.map((it, n) => (n === i ? { ...it, [k]: v } : it))); };

  return (
    <div className="space-y-3">
      <input value={title} onChange={e => { dirty(); setTitle(e.target.value); }} placeholder="כותרת — למשל: עדכוני דצמבר" className="w-full rounded-xl border px-3 py-2 font-bold" />
      <textarea value={intro} onChange={e => { dirty(); setIntro(e.target.value); }} placeholder="פתיח קצר" rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" />
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-[#EDE3DC] bg-[#FBF6F3] p-3">
          <input value={it.title} onChange={e => setItem(i, 'title', e.target.value)} placeholder={`עדכון ${i + 1} — כותרת`} className="w-full rounded-lg border px-3 py-1.5 text-sm font-bold" />
          <textarea value={it.body} onChange={e => setItem(i, 'body', e.target.value)} placeholder="טקסט" rows={2} className="w-full rounded-lg border px-3 py-1.5 text-sm" />
          <div className="flex gap-2">
            <input value={it.href} onChange={e => setItem(i, 'href', e.target.value)} placeholder="קישור (https://…)" dir="ltr" className="flex-1 rounded-lg border px-3 py-1.5 text-sm" />
            <input value={it.linkLabel} onChange={e => setItem(i, 'linkLabel', e.target.value)} placeholder="טקסט הקישור" className="w-32 rounded-lg border px-3 py-1.5 text-sm" />
          </div>
        </div>
      ))}
      {items.length < 8 && <button onClick={() => { dirty(); setItems([...items, { title: '', body: '', href: '', linkLabel: '' }]); }} className="text-sm font-bold text-[#23208F]">+ עוד עדכון</button>}
      <div className="flex flex-wrap gap-2">
        <button onClick={preview} disabled={!title} className="rounded-full bg-[#f1f1f3] px-4 py-2 text-sm font-bold disabled:opacity-50">תצוגה מקדימה</button>
        <button onClick={saveAndTest} disabled={!title || busy} className="rounded-full bg-[#F0643C] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">שלח בדיקה אליי</button>
      </div>
      {html && <Frame html={html} />}
      {tested && (
        <div className="space-y-2 rounded-2xl border-2 border-[#F0643C] p-4">
          <p className="text-sm font-bold text-ink-900">שליחה לכל חברי המועדון הפעילים</p>
          <p className="text-xs text-ink-500">כדי לאשר, הקלידו: <b>{CONFIRM}</b></p>
          <input value={confirm} onChange={e => setConfirm(e.target.value)} className="w-full rounded-lg border px-3 py-1.5 text-sm" />
          <button onClick={sendAll} disabled={confirm !== CONFIRM || busy} className="rounded-full bg-[#23208F] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">שלח לכולם</button>
        </div>
      )}
      {msg && <p className="text-sm text-ink-700">{msg}</p>}
    </div>
  );
}

function SendsTab() {
  const { data, error } = useApi<ListResp>(API);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <p className="text-sm text-[#b91c1c]">{String((error as Error).message || error)} — אם מיגרציה 222 לא הורצה, המעקב עוד לא פעיל.</p>;
  if (!data) return <p className="text-sm text-ink-500">טוען…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-500">{MPP_NOTE}</p>
      <h2 className="font-extrabold text-ink-900">עדכונים שנשלחו</h2>
      {!(data.campaigns || []).length && <p className="text-sm text-ink-500">עוד לא נשלח דבר.</p>}
      {(data.campaigns || []).map(c => (
        <div key={c.id} className="rounded-2xl border border-[#EDE3DC] p-3">
          <button onClick={() => setOpen(open === c.id ? null : c.id)} className="mb-2 w-full text-right">
            <div className="font-bold text-ink-900">{c.subject}</div>
            <div className="text-xs text-ink-500">{c.kind === 'resend_unopened' ? 'שליחה חוזרת למי שלא פתח · ' : ''}{c.status === 'sent' ? `נשלח ${when(c.sent_at)}` : c.status}</div>
          </button>
          <Totals t={c.totals} />
          {open === c.id && <CampaignDetail id={c.id} />}
        </div>
      ))}
      <h2 className="pt-2 font-extrabold text-ink-900">מיילים אוטומטיים · 30 יום</h2>
      {(data.transactional || []).map(t => (
        <div key={t.template} className="rounded-2xl border border-[#EDE3DC] p-3">
          <div className="mb-2 text-sm font-bold text-ink-900" dir="ltr">{t.template}</div>
          <Totals t={t.totals} />
        </div>
      ))}
    </div>
  );
}

function CampaignDetail({ id }: { id: string }) {
  const { data, mutate } = useApi<DetailResp>(`${API}?campaign=${id}`);
  const [onlyUnopened, setOnlyUnopened] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <p className="mt-2 text-sm text-ink-500">טוען…</p>;
  const unopened = new Set(data.unopened);
  const rows = onlyUnopened ? data.recipients.filter(r => unopened.has(r.logId)) : data.recipients;
  const resend = async () => {
    setMsg('שולח שוב…');
    const { json } = await post({ action: 'resend_unopened', campaignId: id, confirm });
    setMsg(json.ok ? `נשלח שוב ל־${json.sent} מתוך ${json.recipients}.` : json.error);
    mutate();
  };
  return (
    <div className="mt-3 space-y-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnopened} onChange={e => setOnlyUnopened(e.target.checked)} /> רק מי שלא פתח ({data.unopened.length})</label>
      <div className="max-h-96 divide-y overflow-auto rounded-xl border">
        {rows.map(r => (
          <div key={r.logId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0"><div className="truncate font-bold text-ink-900">{r.name || r.email}</div><div className="truncate text-xs text-ink-500" dir="ltr">{r.email}</div></div>
            <div className="shrink-0 text-left">
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', STATE[r.state].c)}>{STATE[r.state].t}</span>
              <div className="text-[11px] text-ink-500">{r.openedAt ? `נפתח ${when(r.openedAt)}` : `נשלח ${when(r.sentAt)}`}</div>
            </div>
          </div>
        ))}
      </div>
      {data.unopened.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={`הקלידו "${CONFIRM}"`} className="rounded-lg border px-3 py-1.5 text-sm" />
          <button onClick={resend} disabled={confirm !== CONFIRM} className="rounded-full bg-[#23208F] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">שלח שוב רק ל־{data.unopened.length} שלא פתחו</button>
        </div>
      )}
      {msg && <p className="text-sm text-ink-700">{msg}</p>}
    </div>
  );
}
