'use client';

// היום (mockup "יאיר · אימונים" › היום): who already ran against today's published session,
// who has not yet, the feedback waiting for an answer (answered here through the existing
// /api/workout-feedback/reply), and tomorrow — published? who confirmed?

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { addDaysToDateStr, cn, israelToday, planWeekStartOf } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import {
  HE_DAY_NAMES, QUICK_REPLIES, askCount, dayPublish, shortDay, todaySplit, waitingFeedback, watchCountsByDay,
  type FeedbackItem,
} from '@/lib/coach-space/model';
import { Avatar, B, Card, CardHead, Loading, ScreenHeader, SessionText, useFeedback, useOpenRunner, usePeople, useWeek } from './shared';

const NOT_YET_SHOWN = 6;

function sessionText(sessions: Array<{ name: string; km: number }> | undefined): string | null {
  if (!sessions?.length) return null;
  return sessions.map((s) => s.name || (s.km ? `${s.km} ק״מ` : '')).filter(Boolean).join(' + ');
}

function FeedbackReply({ item, asks, onSent }: { item: FeedbackItem; asks: number; onSent: () => void }) {
  const openRunner = useOpenRunner();
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const send = async (reply: string) => {
    if (!reply.trim()) return;
    setState('busy');
    try {
      const res = await fetch('/api/workout-feedback/reply', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ feedbackId: item.id, reply }) });
      setState(res.ok ? 'ok' : 'fail');
      if (res.ok) onSent();
    } catch { setState('fail'); }
  };
  return (
    <div>
      <button type="button" onClick={() => openRunner(item.athleteId)} className="flex min-h-[44px] w-full items-center gap-3 text-start">
        <Avatar person={item} size={42} />
        <span className="min-w-0 flex-1">
          <b className="block text-[15.5px] font-extrabold text-ink-900" dir="auto">{item.name}</b>
          <span className="text-[12.5px] text-ink-400">
            <B>{shortDay(item.createdAt)}</B>
            {item.difficulty != null && <> · קושי <B>{item.difficulty}</B></>}
            {item.pain && <span className="font-bold text-accent-red"> · כאב</span>}
            {asks > 1 && <> · ביקש משוב <B>{asks}</B> פעמים</>}
          </span>
        </span>
      </button>
      {(item.comment || item.painDetail) && (
        <p className="mt-2 rounded-[14px] bg-page px-3 py-2 text-[14.5px] text-ink-700" dir="auto">״{item.comment || item.painDetail}״</p>
      )}
      {state === 'ok' ? (
        <p className="mt-3 rounded-[14px] bg-[#E8F6EE] px-3 py-2.5 text-[14px] font-bold text-[#15803d]">✓ התשובה נשלחה ל{item.name.split(' ')[0]}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_REPLIES.map((q) => (
              <button key={q} type="button" onClick={() => setText(q)}
                className={cn('min-h-[44px] rounded-full px-3.5 text-[13.5px] font-bold', text === q ? 'bg-brand-600 text-white' : 'bg-[#EEF0FF] text-brand-600')}>
                {q}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex items-end gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="לכתוב תשובה…" aria-label="תשובה"
              className="min-h-[44px] flex-1 resize-none rounded-[14px] bg-page px-3 py-2.5 text-[16px] text-ink-900 placeholder:text-ink-400" dir="auto" />
            <button type="button" onClick={() => send(text)} disabled={!text.trim() || state === 'busy'}
              className="min-h-[44px] rounded-[14px] bg-brand-600 px-4 text-[14.5px] font-bold text-white disabled:opacity-40">
              {state === 'busy' ? 'שולח…' : 'שליחה'}
            </button>
          </div>
          {state === 'fail' && <p className="mt-1.5 text-xs font-semibold text-accent-red">לא נשלח, אפשר לנסות שוב</p>}
        </>
      )}
    </div>
  );
}

export function CoachToday() {
  const openRunner = useOpenRunner();
  const people = usePeople();
  const feedback = useFeedback();
  const today = people.data?.today ?? israelToday();
  const tomorrow = addDaysToDateStr(today, 1);
  const { week, watch } = useWeek(planWeekStartOf(today));
  const tomorrowWeek = planWeekStartOf(tomorrow);
  const tomorrowDow = new Date(`${tomorrow}T12:00:00`).getDay();
  const att = useApi<{ goingCount: number; total: number; roster: Array<{ athleteId: string; name: string; attending: boolean | null }> }>(
    `/api/attendance?weekStart=${tomorrowWeek}&day=${tomorrowDow}&roster=full`,
  );
  const [showAll, setShowAll] = useState(false);

  if (!people.data) return <><ScreenHeader title="היום" /><Loading /></>;

  const { ran, notYet } = todaySplit(people.data.people, today);
  const total = ran.length + notYet.length;
  const dow = new Date(`${today}T12:00:00`).getDay();
  const days = week.data?.days ?? [];
  const todayDay = days.find((d) => d.date === today);
  const counts = watchCountsByDay(watch.data?.runners ?? []);
  const planStatus = week.data?.plan.status ?? 'none';
  const planDays = watch.data?.planDays ?? [];
  const todayState = dayPublish(planStatus, planDays, dow, !!todayDay?.sessions.length, counts[dow] ?? 0);
  const okToday = new Set((watch.data?.runners ?? []).filter((r) => r.days[dow] === 'ok').map((r) => r.athleteId));
  const ranWithWatch = ran.filter((p) => okToday.has(p.id)).length;

  // Tomorrow is in this week unless today is Saturday.
  const tDay = tomorrowWeek === week.data?.weekStart ? days.find((d) => d.date === tomorrow) : undefined;
  const tState = tDay ? dayPublish(planStatus, planDays, tomorrowDow, !!tDay.sessions.length, counts[tomorrowDow] ?? 0) : 'none';
  const tTeam = !!tDay?.team || (week.data?.teamDays ?? []).includes(tomorrowDow);
  const going = att.data?.goingCount ?? 0;

  const items = feedback.data?.items ?? [];
  const waiting = waitingFeedback(items);
  const shownNotYet = showAll ? notYet : notYet.slice(0, NOT_YET_SHOWN);

  return (
    <>
      <ScreenHeader title="היום" />

      <Card>
        <div className="flex items-baseline gap-2">
          <b className="text-[34px] font-black leading-none text-ink-900"><B>{`${ran.length}/${total}`}</B></b>
          <span className="text-[15px] font-bold text-ink-500">רצו היום</span>
        </div>
        <div className="mt-3 rounded-[16px] bg-page px-3 py-2.5">
          <p className="text-[12.5px] font-bold text-ink-400">
            {todayState === 'published' ? <>פורסם · נשלח ל־<B>{counts[dow] ?? 0}</B> שעונים</> : todayState === 'draft' ? 'טיוטה · עוד לא פורסם' : todayState === 'rest' ? 'יום מנוחה' : 'אין אימון בתוכנית'}
          </p>
          {sessionText(todayDay?.sessions) && <p className="mt-0.5 text-[16px] font-extrabold text-ink-900" ><SessionText text={sessionText(todayDay?.sessions)!} /></p>}
          {todayState === 'published' && <p className="mt-0.5 text-[12.5px] text-ink-500"><B>{ranWithWatch}</B> רצו עם האימון מהשעון</p>}
        </div>
      </Card>

      {notYet.length > 0 && (
        <Card>
          <CardHead title={<>עוד לא רצו · <B>{notYet.length}</B></>} />
          <div className="flex flex-wrap gap-2">
            {shownNotYet.map((p) => (
              <button key={p.id} type="button" onClick={() => openRunner(p.id)} className="flex min-h-[44px] items-center gap-2 rounded-full bg-page py-1 pe-3.5 ps-1">
                <Avatar person={p} size={34} />
                <span className="text-[13.5px] font-semibold text-ink-700" dir="auto">{p.name}</span>
              </button>
            ))}
            {!showAll && notYet.length > NOT_YET_SHOWN && (
              <button type="button" onClick={() => setShowAll(true)} className="min-h-[44px] rounded-full bg-page px-3.5 text-[13.5px] font-bold text-brand-600">
                <B>{`+${notYet.length - NOT_YET_SHOWN}`}</B>
              </button>
            )}
          </div>
          {/* TODO(coach-space): no endpoint sends a "you haven't run yet" reminder. The only
              reminder (/api/admin/entry-queue/nudge) is about finishing setup, and
              /api/admin/publish/message also posts on the club feed — neither is this. */}
          <button type="button" disabled aria-disabled className="mt-3 min-h-[44px] w-full rounded-[14px] bg-[#EEF0FF] text-[14.5px] font-bold text-brand-600 opacity-50">
            לשלוח תזכורת עדינה
          </button>
          <p className="mt-1.5 text-center text-[11.5px] text-ink-400">עוד לא מחובר — אין עדיין שליחה של תזכורת ריצה</p>
        </Card>
      )}

      <Card>
        <CardHead title="משוב שמחכה לתשובה" side={waiting.length > 0 ? <B>{waiting.length}</B> : undefined} />
        {!feedback.data ? <div className="h-20 animate-pulse rounded-[14px] bg-page" />
          : waiting.length === 0 ? <p className="py-2 text-[14px] text-ink-400">אין משוב שמחכה. הכול נענה.</p>
            : (
              <>
                <FeedbackReply key={waiting[0].id} item={waiting[0]} asks={askCount(items, waiting[0].athleteId)} onSent={() => feedback.mutate()} />
                {waiting.length > 1 && (
                  <Link href="/dashboard/workout-feedback" className="mt-3 flex min-h-[44px] items-center justify-between rounded-[14px] bg-page px-3 text-[14px] font-bold text-brand-600">
                    <span>ועוד <B>{waiting.length - 1}</B> משובים שמחכים</span><ChevronLeft className="h-4 w-4" />
                  </Link>
                )}
              </>
            )}
      </Card>

      <Card tone={tState === 'published' ? undefined : 'warn'}>
        <CardHead title={<>מחר · {HE_DAY_NAMES[tomorrowDow]}{tTeam ? ' · קבוצתי' : ''}</>} side={<B>{shortDay(tomorrow)}</B>} />
        {sessionText(tDay?.sessions) && <p className="text-[15px] font-extrabold text-ink-900" ><SessionText text={sessionText(tDay?.sessions)!} /></p>}
        <p className={cn('mt-1 text-[13.5px] font-semibold', tState === 'published' ? 'text-[#15803d]' : 'text-[#7A3E06]')}>
          {tState === 'published' ? <>פורסם · <B>{counts[tomorrowDow] ?? 0}</B> בשעונים</> : tState === 'rest' ? 'יום מנוחה' : 'האימון עוד לא פורסם'}
        </p>
        {tTeam && (
          <p className="mt-0.5 text-[13.5px] text-ink-600">
            {going > 0 ? <><B>{going}</B> אישרו הגעה</> : 'אף אחד לא אישר הגעה'}
          </p>
        )}
        {tState !== 'published' && tState !== 'rest' && (
          <Link href="/dashboard/week" className="mt-3 flex min-h-[44px] items-center justify-center rounded-[14px] bg-brand-600 text-[14.5px] font-bold text-white">לפרסם</Link>
        )}
      </Card>
    </>
  );
}
