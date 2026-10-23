'use client';

// The runner card — the one every coach tab opens (mockup "כרטיס רץ"). It reads the same
// three answers the tabs already hold (SWR-keyed, so opening it costs no request): the member
// row (/api/admin/people), the weekly volume (/api/coach/volume) and the feedback list.

import Link from 'next/link';
import { Watch, Smartphone, Footprints, MessageSquare, UserRound } from 'lucide-react';
import { cn, israelToday } from '@/lib/utils';
import { teammateHref } from '@/lib/athletes/profile-link';
import { Columns } from '@/components/club-numbers/charts';
import { packLabel, shortDay, waitingFeedback } from '@/lib/coach-space/model';
import { Avatar, B, useFeedback, usePeople, useVolume } from './shared';

function daysAgo(day: string | null, today: string): number | null {
  if (!day) return null;
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}
function ago(n: number | null): string {
  if (n === null) return '—';
  if (n <= 0) return 'היום';
  if (n === 1) return 'אתמול';
  return `לפני ${n} ימים`;
}

function Line({ icon, tint, label, value, bad }: { icon: React.ReactNode; tint: string; label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-3.5">
      <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white', tint)}>{icon}</span>
      <span className="flex-1 text-[15px] text-ink-700">{label}</span>
      <span className={cn('text-end text-[14.5px]', bad ? 'font-semibold text-accent-red' : 'text-ink-500')}>{value}</span>
    </div>
  );
}

export function RunnerCard({ athleteId }: { athleteId: string }) {
  const people = usePeople();
  const volume = useVolume();
  const feedback = useFeedback();
  const today = people.data?.today ?? israelToday();
  const p = people.data?.people.find((x) => x.id === athleteId);
  if (!p) return <p className="py-10 text-center text-sm text-ink-400">טוען…</p>;

  const v = volume.data?.athletes.find((r) => r.athleteId === athleteId);
  const weeks = volume.data?.weeks ?? [];
  const series = v?.series ?? weeks.map(() => 0);
  const mine = (feedback.data?.items ?? []).filter((i) => i.athleteId === athleteId);
  const waiting = waitingFeedback(mine);
  const run = daysAgo(p.lastRunDay, today);
  const seen = daysAgo(p.lastSeenAt, today);
  const profile = teammateHref(p.id);
  const tags = [packLabel(p.groupName), p.isAcademy ? 'אקדמיה' : null].filter(Boolean).join(' · ');

  return (
    <div className="pb-4" dir="rtl">
      <div className="text-center">
        <span className="mx-auto block w-fit"><Avatar person={p} size={84} /></span>
        <p className="mt-2 text-[23px] font-black text-ink-900" dir="auto">{p.name}</p>
        {tags && <p className="text-sm text-ink-400" dir="auto">{tags}</p>}
      </div>

      <div className="mt-4 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <Line icon={<Watch className="h-4 w-4" />} tint="bg-accent-900" label="שעון"
          value={p.source === 'garmin' ? 'Garmin מחובר' : p.source === 'strava' ? 'Strava מחובר' : 'לא מחובר'} bad={!p.source} />
        <Line icon={<Smartphone className="h-4 w-4" />} tint="bg-brand-600" label="אפליקציה"
          value={seen === null ? 'לא נפתחה' : seen > 7 ? `לא נפתחה מאז ${shortDay(p.lastSeenAt!)}` : ago(seen)} bad={seen === null || seen > 7} />
        <Line icon={<Footprints className="h-4 w-4" />} tint="bg-[#ff9500]" label="ריצה אחרונה" value={ago(run)} bad={run === null || run > 7} />
      </div>

      <div className="mt-3 rounded-2xl bg-card p-3.5">
        <div className="mb-2 flex items-baseline justify-between">
          <b className="text-[14px] font-extrabold text-ink-900">השבוע</b>
          <span className="text-[13px] text-ink-500"><B>{v?.thisWeekKm ?? 0}</B> ק״מ · <B>{v?.thisWeekRuns ?? 0}</B> ריצות</span>
        </div>
        <Columns values={series} labels={weeks.map((w) => shortDay(w))} height={104} hi={[series.length - 1]} showValues={[series.length - 1]} />
        <p className="mt-1.5 text-[12px] text-ink-400">
          <B>{weeks.length}</B> שבועות אחורה · ממוצע <B>{v?.avgKm ?? 0}</B> ק״מ · שיא <B>{v?.peakKm ?? 0}</B>
        </p>
      </div>

      {mine.length > 0 && (
        <div className="mt-3 rounded-2xl bg-card p-3.5">
          <b className="text-[14px] font-extrabold text-ink-900">משובים אחרונים</b>
          <ul className="mt-1.5 space-y-1.5">
            {mine.slice(0, 3).map((f) => (
              <li key={f.id} className="text-[13.5px] text-ink-700">
                <span className="text-ink-400"><B>{shortDay(f.createdAt)}</B> · </span>
                {f.pain ? <span className="font-semibold text-accent-red">כאב{f.painDetail ? ` · ${f.painDetail}` : ''} </span> : null}
                {f.comment ? <span dir="auto">״{f.comment}״</span> : f.difficulty != null ? <span>קושי <B>{f.difficulty}</B></span> : null}
              </li>
            ))}
          </ul>
          {waiting.length > 0 && <p className="mt-1.5 text-[12.5px] font-bold text-[#B45309]"><B>{waiting.length}</B> מחכים לתשובה</p>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {profile && (
          <Link href={profile} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl bg-card text-[14px] font-semibold text-brand-600">
            <UserRound className="h-4 w-4" />הפרופיל המלא
          </Link>
        )}
        <Link href="/dashboard/workout-feedback" className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl bg-card text-[14px] font-semibold text-brand-600">
          <MessageSquare className="h-4 w-4" />משובים
        </Link>
      </div>
    </div>
  );
}
