'use client';

// /dashboard/notifications/approve — the admin's OK before the pushes that go
// out ahead of a team workout (lib/notifications/approval.ts). One card per team
// day in the coming week: the workout, whether it needs an approval, and every
// push that will go out for it, as the runners will read it. The approver's push
// links here with ?date=, and that day's card is highlighted. Approvers and the
// super user only (the API answers 403 to anyone else).

import { useEffect, useState } from 'react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, Card, SegmentedControl, Spinner } from '@/components/ui';
import type { ApprovalDay, ApprovalMode, GateState } from '@/lib/notifications/approval';

interface Data { mode: ApprovalMode; today: string; days: ApprovalDay[] }

const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MODES: Array<{ value: ApprovalMode; label: string }> = [
  { value: 'quality', label: 'לפני אימוני איכות' },
  { value: 'team', label: 'לפני כל אימון' },
  { value: 'off', label: 'בלי אישור' },
];
const STATE: Record<GateState, { label: string; cls: string }> = {
  pending: { label: '🟡 ממתין לאישור', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: '✓ אושר', cls: 'bg-green-100 text-green-800' },
  skipped: { label: 'לא יישלח', cls: 'bg-red-100 text-red-700' },
  not_needed: { label: 'בלי אישור', cls: 'bg-page text-ink-500' },
};
const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const time = (iso: string) => new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' });

export default function ApprovePushesPage() {
  const { data, error, mutate } = useApi<Data>('/api/notifications/approvals');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => { setFocus(new URLSearchParams(window.location.search).get('date')); }, []);
  useEffect(() => {
    if (focus && data) document.getElementById(`day-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, data]);

  const send = async (key: string, method: 'POST' | 'PUT', body: unknown) => {
    setBusy(key);
    setFailed(false);
    try {
      const res = await fetch('/api/notifications/approvals', { method, headers: await apiHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      await mutate(await res.json(), { revalidate: false });
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="mt-10 text-center text-sm text-accent-red">אין הרשאה למסך הזה, או שהטעינה נכשלה.</p>;
  if (!data) return <div className="mt-20 flex justify-center"><Spinner size={28} /></div>;

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-12" dir="rtl">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-ink-700">אישור התראות</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">
          ההתראות שיוצאות לרצים לפני אימון מחכות לאישור שלך. בלי אישור עד מועד השליחה — הן לא יוצאות.
        </p>
      </div>

      <Card>
        <p className="mb-2 text-xs font-bold text-ink-500">מתי לבקש אישור</p>
        <SegmentedControl value={data.mode} onChange={(mode) => send('mode', 'PUT', { mode })} options={MODES} />
      </Card>

      {failed && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-accent-red">לא הצלחתי לשמור. לנסות שוב.</p>}

      {data.days.length === 0 && <p className="text-center text-sm text-ink-500">אין אימון קבוצתי בשבוע הקרוב.</p>}

      {data.days.map((d) => {
        const st = STATE[d.state];
        const gated = d.state !== 'not_needed';
        return (
          <Card key={d.date} id={`day-${d.date}`} className={cn(focus === d.date && 'ring-2 ring-brand-600')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-ink-700">יום {DAY[d.dayOfWeek]} <bdi dir="ltr">{ddmm(d.date)}</bdi></h2>
                <p className="text-sm text-ink-500" dir="auto">
                  {d.quality ? `⭐ אימון איכות${d.workoutName ? ` · ${d.workoutName}` : ''}` : 'לא אימון איכות'}
                </p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', st.cls)}>{st.label}</span>
            </div>

            <ul className="mt-3 space-y-2">
              {d.pushes.map((p) => (
                <li key={p.key} className="rounded-xl bg-page px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-2xs font-bold text-ink-400">
                    <span>{p.when}</span><span>{p.audience}</span>
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-ink-700">{p.title}</p>
                  <p className="text-13 leading-snug text-ink-500">{p.body}</p>
                </li>
              ))}
            </ul>

            {d.decidedBy && d.decidedAt && (
              <p className="mt-2 text-xs text-ink-400">{d.state === 'approved' ? 'אושר' : 'סומן לא לשלוח'} ע״י {d.decidedBy} · {time(d.decidedAt)}</p>
            )}

            {gated && (
              <div className="mt-3 flex gap-2">
                {d.state !== 'approved' && (
                  <Button className="min-h-[44px] flex-1" disabled={busy !== null} onClick={() => send(d.date, 'POST', { date: d.date, action: 'approve' })}>
                    {busy === d.date ? <Spinner size={16} /> : 'אישור · ההתראות יישלחו'}
                  </Button>
                )}
                {d.state !== 'skipped' && (
                  <Button variant="secondary" className="min-h-[44px] flex-1 text-accent-red" disabled={busy !== null} onClick={() => send(d.date, 'POST', { date: d.date, action: 'skip' })}>
                    לא לשלוח
                  </Button>
                )}
                {d.state !== 'pending' && (
                  <Button variant="secondary" className="min-h-[44px]" disabled={busy !== null} onClick={() => send(d.date, 'POST', { date: d.date, action: 'reset' })}>
                    ביטול
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
