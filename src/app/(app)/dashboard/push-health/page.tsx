'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { DeliveryState, PushGroup, Tally } from '@/lib/push-deliveries';

// ═════════════════════════════════════════════════════════════════════════════
// ניהול ← בריאות ההתראות (mockups/push-health.html, Ofer 10-23): did each push SHOW on
// the phone — not only "Apple took it". The last day as sent → accepted → shown, the
// phones that show nothing, each kind's share, and each push with everyone it went to.
// The rows are lib/push-deliveries (migration 171); the alerts are the cron tick's.
// ═════════════════════════════════════════════════════════════════════════════

interface Summary {
  ready: boolean; tally?: Tally; rate?: number | null;
  byKind?: Array<{ kind: string; title: string | null; tally: Tally; rate: number | null }>;
  recent?: PushGroup[]; silent?: Array<{ athleteId: string; name: string; unshown: number }>;
}
interface Detail {
  ready: boolean; push: PushGroup | null;
  recipients: Array<{ athleteId: string | null; name: string; avatarUrl: string | null; device: string; sentAt: string; shownAt: string | null; state: DeliveryState; error: string | null }>;
}

const KIND_LABEL: Record<string, string> = {
  quality_session: '📸 שיתוף האימון', session_photos: '📸 תמונות מהאימון', session_folder: '📂 תיקיית תמונות',
  signup_request: '⏳ בקשות הצטרפות', feedback_alert: '⚠️ משוב אימון', kudos_activity: '🏃 סיים ריצה',
  activity_sync_editor: '✅ האימון סונכרן', news: '📣 הודעות', program: '📅 תוכנית', coach: '💬 מהמאמן', achievements: '🏅 הישגים',
};
const STATE: Record<DeliveryState, { t: string; c: string }> = {
  shown: { t: '✓ הוצגה', c: 'bg-[#DCFCE7] text-[#15803d]' },
  waiting: { t: '⏳ ממתין', c: 'bg-[#FEF3C7] text-[#b45309]' },
  not_shown: { t: '✗ לא הוצגה', c: 'bg-[#FEE2E2] text-[#b91c1c]' },
  refused: { t: '✗ נדחתה', c: 'bg-[#FEE2E2] text-[#b91c1c]' },
  no_device: { t: 'אין מכשיר', c: 'bg-[#f1f1f3] text-ink-500' },
  muted: { t: 'כיבה', c: 'bg-[#f1f1f3] text-ink-500' },
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const label = (kind: string | null, title: string | null) => KIND_LABEL[kind ?? ''] ?? title ?? kind ?? 'אחר';
const tone = (r: number | null) => (r == null ? 'text-ink-400' : r >= 90 ? 'text-[#15803d]' : r >= 70 ? 'text-[#b45309]' : 'text-[#b91c1c]');
const barTone = (r: number | null) => (r == null ? '#d1d5db' : r >= 90 ? '#22c55e' : r >= 70 ? '#f59e0b' : '#ef4444');

export default function PushHealthPage() {
  const [nid, setNid] = useState<string | null>(null);
  useEffect(() => { setNid(new URLSearchParams(window.location.search).get('nid')); }, []);
  const open = (n: string | null) => {
    setNid(n);
    window.history.pushState(null, '', n ? `?nid=${n}` : window.location.pathname);
  };
  useEffect(() => {
    const back = () => setNid(new URLSearchParams(window.location.search).get('nid'));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  return nid ? <PushDetail nid={nid} onBack={() => open(null)} /> : <Overview onOpen={open} />;
}

function Overview({ onOpen }: { onOpen: (nid: string) => void }) {
  const { data } = useApi<Summary>('/api/admin/push-health', { refreshInterval: 60_000 });
  const t = data?.tally;
  return (
    <div className="pb-10" dir="rtl">
      <Link href="/dashboard/coach-tools" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ ניהול</Link>
      <div className="flex items-center gap-3 pb-3">
        <span className="grid h-[44px] w-[44px] place-items-center rounded-[12px] bg-[#FF3B30] text-white"><BellRing className="h-6 w-6" /></span>
        <h1 className="text-[28px] font-extrabold tracking-[-0.4px] text-ink-900">בריאות ההתראות</h1>
      </div>
      {!data && <div className="h-48 animate-pulse rounded-[16px] bg-card" />}
      {data && !data.ready && <p className="rounded-[16px] bg-card px-4 py-4 text-[14px] text-ink-600">מחכה למיגרציה 171 (push_deliveries). עד אז ההתראות נשלחות כרגיל, רק בלי מעקב.</p>}
      {data?.ready && t && (
        <>
          <section className="rounded-[16px] bg-card p-3.5">
            <p className="text-[12.5px] font-bold text-ink-500">24 השעות האחרונות</p>
            <p className="text-[40px] font-black leading-tight tracking-[-1px] text-ink-900">
              {data.rate == null ? '—' : <bdi dir="ltr">{data.rate}%</bdi>} <span className="text-[15px] font-bold text-ink-500">הוצגו בטלפון</span>
            </p>
            <div className="mt-2.5 grid grid-cols-4 gap-1.5 text-center">
              {[['נשלחו', t.sent, false], ['אפל קיבלה', t.accepted, false], ['הוצגו', t.shown, false], ['לא הוצגו', t.notShown, t.notShown > 0]].map(([l, n, bad]) => (
                <div key={String(l)} className={cn('rounded-[12px] px-1 py-2', bad ? 'bg-[#FEE2E2]' : 'bg-page')}>
                  <b className={cn('block text-[19px] tabular-nums', bad ? 'text-[#b91c1c]' : 'text-ink-900')}>{n as number}</b>
                  <small className="text-[11px] font-bold text-ink-500">{l as string}</small>
                </div>
              ))}
            </div>
            {t.waiting > 0 && <p className="mt-2 text-[12px] text-ink-400">{t.waiting} עוד בחלון של 10 הדקות · {t.noDevice} בלי מכשיר · {t.muted} כיבו את הסוג</p>}
            {(data.silent?.length ?? 0) > 0 && (
              <div className="mt-2.5 rounded-[14px] border-[1.5px] border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13px] leading-snug text-ink-700">
                <b className="text-[#b91c1c]">⚠️ {data.silent!.length === 1 ? 'טלפון אחד לא מציג' : `${data.silent!.length} טלפונים לא מציגים`} התראות</b> — אפל מקבלת, הטלפון לא מראה:{' '}
                {data.silent!.map((x) => `${x.name} (${x.unshown})`).join(', ')}. פתיחה אחת של האפליקציה בדרך כלל מתקנת.
              </div>
            )}
          </section>

          <p className="px-1 pb-1.5 pt-4 text-[12.5px] font-extrabold text-ink-500">לפי סוג · מה הוצג</p>
          <div className="overflow-hidden rounded-[16px] bg-card">
            {(data.byKind ?? []).slice(0, 12).map((k) => (
              <div key={k.kind} className="flex items-center gap-2.5 border-t-[0.5px] border-black/[0.07] px-3 py-2.5 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[14px] text-ink-900">{label(k.kind, k.title)}</b>
                  <small className="block text-[11.5px] text-ink-400">{k.tally.sent} נשלחו · {k.tally.shown} הוצגו</small>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#eee]"><i className="block h-full rounded-full" style={{ width: `${k.rate ?? 0}%`, background: barTone(k.rate) }} /></span>
                </span>
                <span className={cn('min-w-[44px] text-start text-[14px] font-black tabular-nums', tone(k.rate))}>{k.rate == null ? '—' : <bdi dir="ltr">{k.rate}%</bdi>}</span>
              </div>
            ))}
            {(data.byKind ?? []).length === 0 && <p className="px-3.5 py-3.5 text-13 text-ink-400">עוד לא נשלחה התראה מאז שהמעקב עלה.</p>}
          </div>

          <p className="px-1 pb-1.5 pt-4 text-[12.5px] font-extrabold text-ink-500">התראות אחרונות</p>
          <div className="overflow-hidden rounded-[16px] bg-card">
            {(data.recent ?? []).map((g) => {
              const judged = g.tally.shown + g.tally.notShown;
              const st = g.tally.notShown ? 'bg-[#FEE2E2] text-[#b91c1c]' : g.tally.waiting ? 'bg-[#FEF3C7] text-[#b45309]' : 'bg-[#DCFCE7] text-[#15803d]';
              return (
                <button key={g.nid} type="button" onClick={() => onOpen(g.nid)} className="flex w-full items-center gap-2.5 border-t-[0.5px] border-black/[0.07] px-3 py-2.5 text-start first:border-t-0 active:bg-page">
                  <span className="min-w-0 flex-1">
                    <b dir="auto" className="block truncate text-[14px] text-ink-900">{g.title || label(g.kind, null)}</b>
                    <small className="block text-[11.5px] text-ink-400">{hm(g.sentAt)} · {g.people} {g.people === 1 ? 'איש' : 'אנשים'}</small>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-extrabold tabular-nums', st)}>
                    {g.tally.waiting && !judged ? '⏳' : <bdi dir="ltr">{g.tally.shown}/{judged || g.tally.sent}</bdi>}
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PushDetail({ nid, onBack }: { nid: string; onBack: () => void }) {
  const { data } = useApi<Detail>(`/api/admin/push-health?nid=${nid}`, { refreshInterval: 30_000 });
  const p = data?.push;
  const order: DeliveryState[] = ['not_shown', 'refused', 'waiting', 'shown', 'no_device', 'muted'];
  const list = [...(data?.recipients ?? [])].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return (
    <div className="pb-10" dir="rtl">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ בריאות ההתראות</button>
      {!data && <div className="h-48 animate-pulse rounded-[16px] bg-card" />}
      {p && (
        <>
          <h1 dir="auto" className="text-[22px] font-extrabold leading-tight text-ink-900">{p.title}</h1>
          <p className="mb-2.5 mt-1 text-13 text-ink-500">{hm(p.sentAt)} · {p.tally.shown} הוצגו מתוך {p.tally.shown + p.tally.notShown + p.tally.waiting}</p>
          <div className="overflow-hidden rounded-[16px] bg-card">
            {list.map((r, i) => (
              <div key={i} className="flex items-center gap-2.5 border-t-[0.5px] border-black/[0.07] px-3 py-2.5 first:border-t-0">
                <FeedAvatar name={r.name} url={r.avatarUrl} className="h-8 w-8 shrink-0 text-[11px]" />
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[14px] text-ink-900">{r.name}</b>
                  <small className="block text-[11.5px] text-ink-400">{r.device} · נשלח {hm(r.sentAt)}{r.error && r.state === 'refused' ? ` · ${r.error}` : ''}</small>
                </span>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-extrabold', STATE[r.state].c)}>
                  {STATE[r.state].t}{r.state === 'shown' && r.shownAt ? ` ${hm(r.shownAt)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="px-1 pb-1.5 pt-4 text-[12.5px] font-extrabold text-ink-500">מה כל מצב אומר</p>
      <div className="overflow-hidden rounded-[16px] bg-card text-[12.5px] text-ink-600">
        {[['shown', 'הטלפון עצמו אישר שהציג אותה'], ['waiting', 'נשלחה, עוד לא עברו 10 דקות'], ['not_shown', 'אפל קיבלה, הטלפון לא אישר — מכשיר מת, הרשאה כובתה, או מצב ריכוז'], ['refused', 'שירות ההתראות דחה אותה'], ['no_device', 'לא הפעיל התראות — רק בתיבה באפליקציה'], ['muted', 'כיבה את הסוג הזה בהגדרות שלו']].map(([k, t]) => (
          <div key={k} className="flex items-center gap-2.5 border-t-[0.5px] border-black/[0.07] px-3 py-2 first:border-t-0">
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-extrabold', STATE[k as DeliveryState].c)}>{STATE[k as DeliveryState].t}</span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
