'use client';

// השבוע (mockup "יאיר · אימונים" › השבוע): the plan week day by day — published or not and how
// many watches got it (/api/week-setup + /api/plans/watch-status) — km this week by pack so far
// and who has not run this week (/api/coach/volume + /api/admin/people).

import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import { addDaysToDateStr, cn, israelToday, planWeekStartOf } from '@/lib/utils';
import { HE_DAYS, dayPublish, kmByPack, notRunThisWeek, PACK_TITLE, shortDay, watchCountsByDay } from '@/lib/coach-space/model';
import { Avatar, B, Card, CardHead, Loading, PackTag, ScreenHeader, SessionText, useOpenRunner, usePeople, useVolume, useWeek } from './shared';

export function CoachWeek() {
  const openRunner = useOpenRunner();
  const people = usePeople();
  const volume = useVolume();
  const today = people.data?.today ?? israelToday();
  const { weekStart, week, watch } = useWeek(planWeekStartOf(today));

  if (!week.data || !people.data) return <><ScreenHeader title="השבוע" /><Loading /></>;

  const planStatus = week.data.plan.status;
  const planDays = watch.data?.planDays ?? [];
  const counts = watchCountsByDay(watch.data?.runners ?? []);
  const days = week.data.days;
  const end = addDaysToDateStr(weekStart, 6);
  const packs = kmByPack(volume.data?.athletes ?? []);
  const maxKm = Math.max(1, ...packs.map((p) => p.km));
  const quiet = notRunThisWeek(people.data.people, volume.data?.athletes ?? []);
  const sourceOf = new Map(people.data.people.map((p) => [p.id, p.source]));

  return (
    <>
      <ScreenHeader title="השבוע" />

      {planStatus !== 'pushed' && (
        <Card tone="warn">
          <p className="text-[14.5px] font-extrabold text-[#7A3E06]">
            השבוע · <B>{`${shortDay(weekStart)}–${shortDay(end)}`}</B> — {planStatus === 'none' ? 'עוד אין תוכנית' : 'טיוטה · עוד לא פורסמה לרצים'}
          </p>
          <Link href="/dashboard/week" className="mt-3 flex min-h-[44px] items-center justify-center rounded-[14px] bg-brand-600 text-[14.5px] font-bold text-white">לפרסם</Link>
        </Card>
      )}

      <Card className="p-0">
        <ul className="divide-y divide-page">
          {days.map((d) => {
            const state = dayPublish(planStatus, planDays, d.dayOfWeek, d.sessions.length > 0, counts[d.dayOfWeek] ?? 0);
            const text = d.sessions.map((s) => s.name).filter(Boolean).join(' + ') || (d.team ? 'קבוצתי' : '—');
            const isToday = d.date === today;
            return (
              <li key={d.date} className={cn('flex min-h-[56px] items-center gap-3 px-4', isToday && 'bg-[#EEF0FF]/60')}>
                <span className={cn('w-7 text-center text-[15px] font-black', isToday ? 'text-brand-600' : 'text-ink-900')}>{HE_DAYS[d.dayOfWeek]}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[14.5px] font-bold text-ink-900" ><SessionText text={text} />{d.team && text !== 'קבוצתי' ? ' · קבוצתי' : ''}</b>
                  <span className={cn('text-[12px] font-semibold', state === 'published' ? 'text-[#15803d]' : state === 'draft' ? 'text-[#B45309]' : 'text-ink-400')}>
                    {state === 'published' ? <>פורסם · <B>{counts[d.dayOfWeek] ?? 0}</B> בשעון</> : state === 'draft' ? 'לא פורסם' : state === 'rest' ? 'מנוחה' : 'אין תוכנית'}
                  </span>
                </span>
                {state === 'published'
                  ? <Check className="h-5 w-5 text-[#15803d]" aria-label="פורסם" />
                  : state === 'draft' ? <Link href="/dashboard/week" aria-label="לפרסם" className="grid h-11 w-11 place-items-center rounded-full text-brand-600"><Plus className="h-5 w-5" /></Link> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHead title="ק״מ השבוע לפי דבוקה" side="עד עכשיו" />
        {packs.length === 0 ? <p className="text-[14px] text-ink-400">עוד אין ריצות השבוע</p> : (
          <div className="space-y-3">
            {packs.map((p) => (
              <div key={p.pack}>
                <div className="flex items-baseline justify-between text-[13.5px]">
                  <span className="flex items-center gap-1.5 font-bold text-ink-700"><PackTag pack={p.pack} /><B>{PACK_TITLE[p.pack]}</B></span>
                  <span className="text-ink-500"><b className="text-[17px] font-black text-ink-900"><B>{p.km}</B></b> ק״מ · <B>{p.runners}</B> רצים</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-page">
                  <i className={cn('block h-full rounded-full', p.pack === 'A' ? 'bg-[#C2410C]' : p.pack === 'B' ? 'bg-brand-600' : 'bg-accent-900')} style={{ width: `${(p.km / maxKm) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title={<>עוד לא רצו השבוע · <B>{quiet.length}</B></>} />
        {quiet.length === 0 ? <p className="text-[14px] text-ink-400">כולם כבר רצו השבוע</p> : (
          <ul className="divide-y divide-page">
            {quiet.map(({ person, lastWeekKm }) => (
              <li key={person.id}>
                <button type="button" onClick={() => openRunner(person.id)} className="flex min-h-[56px] w-full items-center gap-3 text-start">
                  <Avatar person={person} size={38} />
                  <span className="min-w-0 flex-1">
                    <b className="block text-[14.5px] font-bold text-ink-900" dir="auto">{person.name}</b>
                    <span className="text-[12px] text-ink-400">
                      {lastWeekKm ? <>שבוע שעבר: <B>{lastWeekKm}</B> ק״מ</> : 'גם לא בשבוע שעבר'}
                      {!sourceOf.get(person.id) && ' · בלי שעון'}
                    </span>
                  </span>
                  <span className="rounded-full bg-[#EEF0FF] px-3 py-1.5 text-[12.5px] font-bold text-brand-600">לכרטיס</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
