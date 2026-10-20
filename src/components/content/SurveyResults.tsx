'use client';

import Link from 'next/link';
import { israelDateTime } from '@/lib/survey-reminders';
import { Empty, Group, SectionHead, typeVars } from '@/components/content/hub-ui';
import { cn } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// One poll, for the staff (mockup ~/.cache/madregot/polls-proposal.html, "תוצאות חיות, מי
// לא ענה, ותזכורות"): live bars with who chose what, who hasn't answered by pack, every
// reminder and what it did, a reminder now, the no-push names to paste into WhatsApp, and
// closing it. GET/POST /api/admin/content/surveys/[id].
// ═════════════════════════════════════════════════════════════════════════════

export interface SurveyResultsData {
  survey: { id: string; question: string; closesAt: string | null; createdAt: string; open: boolean; audience: string; pack: string | null; multi: boolean; anonymous: boolean; postId: string | null };
  asked: number;
  answered: number;
  options: Array<{ option: string; people: Array<{ id: string; name: string }> }>;
  waiting: Array<{ pack: string | null; people: Array<{ id: string; name: string; push: boolean }> }>;
  push: { status: string; sent: number; at: string | null } | null;
  reminders: Array<{ id: string; at: string | null; state: 'scheduled' | 'sent' | 'cancelled'; sent: number; after: number | null }>;
}

const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const when = (iso: string) => { const x = israelDateTime(iso); return `${DAYS[x.dow]} ${Number(x.date.slice(8, 10))}.${Number(x.date.slice(5, 7))} · ${x.time}`; };

export function SurveyResultsView({ data, busy, note, confirmClose, onAskClose, onRemind, onClose, onCopy }: {
  data: SurveyResultsData; busy: 'remind' | 'close' | null; note: string | null; confirmClose: boolean;
  onAskClose: () => void; onRemind: () => void; onClose: () => void; onCopy: (names: string[]) => void;
}) {
  const { survey: s } = data;
  const waitingCount = data.waiting.reduce((n, g) => n + g.people.length, 0);
  const noPush = data.waiting.flatMap((g) => g.people.filter((p) => !p.push));
  const withPush = waitingCount - noPush.length;
  const total = data.options.reduce((n, o) => n + o.people.length, 0);
  const share = (n: number) => (s.multi ? (data.answered ? n / data.answered : 0) : (total ? n / total : 0));
  const top = Math.max(0, ...data.options.map((o) => o.people.length));
  const audience = s.audience === 'group' ? `דבוקה ${s.pack ?? ''}`.trim() : s.audience === 'academy' ? 'האקדמיה' : 'כל המועדון';

  return (
    <div style={typeVars('surveys')} className="space-y-0 pb-8" dir="rtl">
      <div className="flex h-11 items-center justify-between">
        <Link href="/dashboard/content/surveys" className="inline-flex min-h-[44px] items-center gap-0.5 text-[17px] text-[#007aff]">‹ סקרים</Link>
        {s.open && (
          confirmClose
            ? <button type="button" disabled={!!busy} onClick={onClose} className="inline-flex min-h-[38px] items-center rounded-full bg-accent-red px-3.5 text-[14px] font-bold text-white">לסגור עכשיו?</button>
            : <button type="button" onClick={onAskClose} className="inline-flex min-h-[44px] items-center px-1 text-[16px] text-[#007aff]">סגירה</button>
        )}
      </div>

      <Group className="mb-2.5">
        <div className="px-3.5 pb-2 pt-3">
          <b dir="auto" className="block text-[18px] font-extrabold text-ink-900">{s.question}</b>
          <small className="text-13 text-ink-400">
            {audience} · {s.closesAt ? (s.open ? <>נסגר <bdi dir="ltr">{when(s.closesAt)}</bdi></> : 'נסגר') : 'פתוח'}
            {data.push?.status === 'sent' && data.push.sent ? ` · התראה ל-${data.push.sent}` : data.push?.status === 'scheduled' ? ' · ההתראה עוד לא יצאה' : ''}
            {s.anonymous ? ' · אנונימי לרצים' : ''}
          </small>
        </div>
        <div className="flex items-center gap-3 px-3.5 pb-3">
          <b className="text-[30px] font-black leading-none text-ink-900"><bdi dir="ltr">{data.answered}/{data.asked}</bdi></b>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eeeef2]" dir="ltr">
            <i className="block h-full rounded-full" style={{ width: `${data.asked ? (data.answered / data.asked) * 100 : 0}%`, background: 'var(--c)' }} />
          </span>
          <span className="text-13 font-semibold text-ink-400">ענו</span>
        </div>
      </Group>

      <Group className="mb-2.5">
        {data.options.map((o) => {
          const n = o.people.length;
          return (
            <div key={o.option} className="border-b border-[#F0F0F3] px-3.5 py-3 last:border-0">
              <div className="flex items-baseline justify-between gap-2">
                <b dir="auto" className="text-[15px] font-bold text-ink-900">{o.option}{top > 0 && n === top && <span className="text-[12px] font-bold" style={{ color: 'var(--c)' }}> · מוביל</span>}</b>
                <span className="text-13 font-semibold text-ink-400"><bdi dir="ltr">{Math.round(share(n) * 100)}% · {n}</bdi></span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eeeef2]">
                <i className="block h-full rounded-full" style={{ width: `${share(n) * 100}%`, background: 'var(--c)' }} />
              </div>
              {n > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {o.people.map((p) => <span key={p.id} dir="auto" className="rounded-full bg-page px-2.5 py-1 text-[12px] font-semibold text-ink-600">{p.name}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </Group>

      <SectionHead>עוד לא ענו · {waitingCount}</SectionHead>
      <Group className="mb-2.5">
        {waitingCount === 0 ? <Empty>כולם ענו 🎉</Empty> : data.waiting.map((g) => (
          <div key={g.pack ?? '-'} className="border-b border-[#F0F0F3] px-3.5 py-2.5 last:border-0">
            <small className="text-[12px] font-bold text-ink-400">{g.pack ? `דבוקה ${g.pack}` : 'בלי דבוקה'} · {g.people.length}</small>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {g.people.map((p) => (
                <span key={p.id} dir="auto" className={cn('rounded-full px-2.5 py-1 text-[12px] font-semibold', p.push ? 'bg-[#FFF4E5] text-[#B45309]' : 'bg-page text-ink-600')}>
                  {p.name}{!p.push && ' · בלי התראות'}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Group>

      {data.reminders.length > 0 && (
        <>
          <SectionHead>התזכורות של הסקר</SectionHead>
          <Group className="mb-2.5">
            {data.reminders.map((r) => (
              <div key={r.id} className="flex min-h-[54px] items-center gap-3 border-b border-[#F0F0F3] px-3.5 py-2 last:border-0">
                <span className="min-w-0 flex-1">
                  <b className="block text-[14.5px] font-semibold text-ink-900">{r.at ? <bdi dir="ltr">{when(r.at)}</bdi> : '—'}</b>
                  <small className="text-[12px] text-ink-400">
                    {r.state === 'sent' ? `נשלחה ל-${r.sent}${r.after ? ` · ${r.after} ענו אחריה` : ''}` : r.state === 'scheduled' ? `כרגע תגיע ל-${withPush}` : 'בוטלה'}
                  </small>
                </span>
                <span className={cn('rounded-full px-2.5 py-1 text-[11.5px] font-extrabold',
                  r.state === 'sent' ? 'bg-[#E8F6EE] text-[#15803d]' : r.state === 'scheduled' ? 'bg-[#EEF0FF] text-brand-600' : 'bg-page text-ink-500')}>
                  {r.state === 'sent' ? 'נשלחה' : r.state === 'scheduled' ? 'מתוזמנת' : 'בוטלה'}
                </span>
              </div>
            ))}
          </Group>
        </>
      )}

      {s.open && waitingCount > 0 && (
        <div className="mb-2.5 flex items-center gap-3 rounded-[18px] bg-ink-900 px-4 py-3 text-white">
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-extrabold">תזכורת עכשיו ל-{waitingCount} שלא ענו</b>
            <small className="text-[12px] opacity-80">{withPush} מהם מקבלים התראות · בנוסף למתוזמנות</small>
          </span>
          <button type="button" disabled={!!busy || withPush === 0} onClick={onRemind} className="min-h-[40px] rounded-full bg-white px-4 text-[14px] font-extrabold text-ink-900 disabled:opacity-50">
            {busy === 'remind' ? 'שולח…' : 'שליחה'}
          </button>
        </div>
      )}
      {noPush.length > 0 && (
        <>
          <p className="px-1.5 pb-2 text-13 text-ink-500">{noPush.length} בלי התראות — אפשר להעתיק את השמות לוואטסאפ של הקבוצה.</p>
          <button type="button" onClick={() => onCopy(noPush.map((p) => p.name))} className="mb-2.5 flex min-h-[48px] w-full items-center justify-center rounded-[16px] bg-card text-[15px] font-bold text-brand-600">העתקת השמות</button>
        </>
      )}
      {s.postId && <Link href={`/dashboard/content/post/${s.postId}`} className="flex min-h-[48px] items-center justify-center rounded-[16px] bg-card text-[15px] font-bold text-ink-700">הפרסום בפיד ‹</Link>}
      {note && <p role="status" className="mt-2.5 rounded-[14px] bg-accent-600/10 px-3 py-2.5 text-center text-sm font-bold text-accent-900">{note}</p>}
    </div>
  );
}
