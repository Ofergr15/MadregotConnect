'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { shortDay } from '@/lib/content/hub';
import { Chips, DateTile, Empty, Group, PlusButton, SectionHead, TypePage } from '@/components/content/hub-ui';
import { useHubContent } from '@/components/content/use-hub';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › סקרים (mockup content-v4, 4): what is open, with the votes so far, and
// for each survey that closed — how many answered and what won. Every survey
// opens its own results: /dashboard/content/surveys/[id], with who hasn't answered
// and the reminders.
// ═════════════════════════════════════════════════════════════════════════════

interface SurveyRow {
  id: string; question: string; createdAt: string; closesOn: string | null; open: boolean;
  options: Array<{ option: string; count: number }>; answers: number; delivered: number | null; postId: string | null;
  fixed?: boolean;
}

export default function ContentSurveysPage() {
  const { data, error } = useApi<{ today: string; surveys: SurveyRow[] }>('/api/admin/content/surveys');
  const { data: hub } = useHubContent();
  const members = hub?.members ?? 0;
  const open = (data?.surveys ?? []).filter((s) => s.open);
  const closed = (data?.surveys ?? []).filter((s) => !s.open);

  return (
    <TypePage type="surveys" action={<PlusButton label="סקר" href="/dashboard/content/publish?type=survey" />}>
      <SectionHead>באוויר</SectionHead>
      {error ? <Group><Empty>לא הצלחתי לטעון את הסקרים.</Empty></Group>
        : !data ? <Group><Empty>טוען…</Empty></Group>
        : open.length === 0 ? <Group><Empty>אין סקר פתוח. ״＋ סקר״ למעלה.</Empty></Group>
        : open.map((s) => <OpenSurvey key={s.id} s={s} members={members} today={data.today} />)}

      {closed.length > 0 && (
        <>
          <SectionHead gray>נסגרו · התוצאה של כל סקר</SectionHead>
          <Group>
            {closed.map((s) => {
              const top = [...s.options].sort((a, b) => b.count - a.count)[0];
              const body = (
                <>
                  <DateTile date={s.closesOn ?? s.createdAt.slice(0, 10)} />
                  <span className="min-w-0 flex-1">
                    <b dir="auto" className="block truncate text-[15.5px] font-semibold text-ink-900">{s.question}</b>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chips chips={[{ key: 'answers', text: `${s.answers} ענו` }]} />
                      {s.fixed && <span className="text-[12px] font-semibold text-ink-400">סקר קבוע (הוסר)</span>}
                      {top && top.count > 0 && (
                        <span className="rounded-[8px] px-[7px] py-[3px] text-12 font-bold" style={{ background: 'var(--c2)', color: 'var(--ci)' }}>ניצח: {top.option} · {top.count}</span>
                      )}
                    </span>
                  </span>
                  <ChevronLeft className="h-5 w-5 shrink-0 text-[#c4c4c9]" />
                </>
              );
              return <Link key={s.id} href={`/dashboard/content/surveys/${s.id}`} className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5 active:bg-page">{body}</Link>;
            })}
          </Group>
        </>
      )}
    </TypePage>
  );
}

function OpenSurvey({ s, members, today }: { s: SurveyRow; members: number; today: string }) {
  const top = Math.max(0, ...s.options.map((o) => o.count));
  const missing = members > 0 ? Math.max(0, members - s.answers) : null;
  const closes = !s.closesOn ? 'פתוח' : s.closesOn === today ? 'נסגר היום' : `נסגר ${shortDay(s.closesOn)}`;
  return (
    <Group className="mb-2.5">
      <div className="px-3.5 pb-1 pt-3">
        <b dir="auto" className="block text-[16.5px] font-bold text-ink-900">{s.question}</b>
        <small className="text-13 text-ink-400">{closes} · {members > 0 ? `${s.answers} מתוך ${members} ענו` : `${s.answers} ענו`}{s.delivered ? ` · התראה ל־${s.delivered}` : ''}</small>
      </div>
      {s.options.map((o) => {
        const lead = top > 0 && o.count === top;
        return (
          <div key={o.option} className="px-3.5 py-2.5">
            <div className="flex justify-between text-[14.5px]">
              <span dir="auto" className={lead ? 'font-extrabold text-ink-900' : 'font-semibold text-ink-900'}>
                {o.option}{lead && <span className="text-12 font-bold" style={{ color: 'var(--c)' }}> · מוביל</span>}
              </span>
              <span className="font-semibold text-ink-400"><bdi dir="ltr">{o.count}</bdi></span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eeeef2]">
              <i className="block h-full rounded-full" style={{ width: `${s.answers ? (o.count / s.answers) * 100 : 0}%`, background: 'var(--c)' }} />
            </div>
          </div>
        );
      })}
      <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">
        <span className="flex-1 text-13 text-ink-700">{missing ? `${missing} עוד לא ענו` : ''}</span>
        <Link href={`/dashboard/content/surveys/${s.id}`} className="inline-flex min-h-[36px] items-center rounded-full px-[13px] text-[13px] font-bold text-white" style={{ background: 'var(--c)' }}>תוצאות ותזכורות</Link>
      </div>
    </Group>
  );
}
