'use client';

/**
 * The academy coach's Management page — "today, by trainee" (mockup
 * ~/.cache/madregot/attendance-nav/academy-coach.html, approved 2026-10-17).
 *
 * Top to bottom: who wrote (unread messages, a reply button each), the day in five
 * numbers, then the trainees who need the coach as full cards with the reason on
 * top, then everyone on plan as one row each, then the recent runs and feedback.
 * Nothing here needs opening a trainee to learn that something is wrong.
 *
 * Data: GET /api/academy/coach-today (lib/academy/coach-today.ts) and the existing
 * threads inbox, both scoped server-side to the trainees this coach may see.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, MessageCircle, Phone } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { formatDuration, formatPace } from '@/components/activity/format';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import type { BoardEvent, BoardTrainee, DayState, Reason } from '@/lib/academy/coach-today';
import type { InboxRow } from '@/lib/academy/thread';

type Trainee = BoardTrainee & { avatarUrl: string | null; phone: string | null };
interface CoachToday { today: string; trainees: Trainee[]; events: BoardEvent[] }
type Filter = 'attention' | 'all' | 'done' | 'notyet';

function Num({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr" className="whitespace-nowrap tabular-nums">{children}</bdi>;
}

const km = (m: number) => (m / 1000).toFixed(1);

const DOT: Record<DayState, string> = {
  done: 'bg-accent-600',
  missed: 'bg-accent-red',
  rest: 'bg-ink-300/60',
  upcoming: 'border border-ink-300 bg-card',
  today: 'border-2 border-dashed border-band-3-ink bg-card',
};

function Strip({ strip }: { strip: Trainee['strip'] }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {strip.map((d, i) => (
        <i key={d.date} className={cn('block h-2.5 w-2.5 rounded-full', DOT[d.state], i === strip.length - 1 && 'ring-[1.5px] ring-brand-600 ring-offset-1')} />
      ))}
    </span>
  );
}

function Ring({ score, size = 36 }: { score: number; size?: number }) {
  const color = score >= 85 ? '#16a34a' : score >= 70 ? '#FF5315' : '#AD3838';
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full text-xs font-extrabold text-ink-900 tabular-nums"
      style={{ width: size, height: size, background: `radial-gradient(closest-side,#fff 76%,transparent 78%),conic-gradient(${color} ${score}%,#E5E7EB 0)` }}
    >
      {score}
    </span>
  );
}

const waNumber = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('0') ? `972${d.slice(1)}` : d; };
const handledKey = (today: string) => `mc:handled:${today}`;
const reasonId = (athleteId: string, r: Reason) => `${athleteId}:${r.kind}`;

export function AcademyCoachToday({ scope }: { scope?: 'coach' }) {
  const t = useTranslations('management');
  const q = scope ? '?scope=coach' : '';
  const { data, error } = useApi<CoachToday>(`/api/academy/coach-today${q}`);
  const { data: inbox } = useApi<{ rows: InboxRow[] }>(`/api/academy/threads/inbox${q}`);
  const [filter, setFilter] = useState<Filter>('attention');
  const [open, setOpen] = useState<string | null>(null);
  const [allEvents, setAllEvents] = useState(false);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  // "טופל" lasts the day: tomorrow a fresh reason is a fresh card.
  useEffect(() => {
    if (!data?.today) return;
    try { setHandled(new Set(JSON.parse(localStorage.getItem(handledKey(data.today)) || '[]'))); } catch { /* empty */ }
  }, [data?.today]);
  const markHandled = (tr: Trainee) => {
    if (!data) return;
    const next = new Set(handled);
    tr.reasons.forEach((r) => next.add(reasonId(tr.athleteId, r)));
    setHandled(next);
    try { localStorage.setItem(handledKey(data.today), JSON.stringify([...next])); } catch { /* empty */ }
  };

  const trainees = useMemo(() => (data?.trainees ?? []).map((tr) => ({
    ...tr,
    open: tr.reasons.filter((r) => !handled.has(reasonId(tr.athleteId, r))),
  })), [data, handled]);
  const attention = trainees.filter((tr) => tr.open.length > 0);
  const onPlan = trainees.filter((tr) => tr.open.length === 0);
  const counts = {
    all: trainees.length,
    done: trainees.filter((tr) => tr.today.state === 'done').length,
    notyet: trainees.filter((tr) => tr.today.state === 'notyet').length,
    rest: trainees.filter((tr) => tr.today.state === 'rest').length,
  };
  const messages = (inbox?.rows ?? [])
    .filter((r) => r.unreadCount > 0 || r.reason === 'awaiting_reply')
    .sort((a, b) => (b.lastTraineeMessageAt || '').localeCompare(a.lastTraineeMessageAt || ''));
  const unreadTotal = messages.reduce((s, r) => s + r.unreadCount, 0);

  const ago = (iso: string | null) => {
    if (!iso) return '';
    // Own strings, not Intl.RelativeTimeFormat: its Hebrew ("לפני שעה (1)") read as a
    // bidi glitch in a 12px line.
    const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (mins < 60) return t('agoMin', { n: mins });
    if (mins < 60 * 24) return t('agoHour', { n: Math.round(mins / 60) });
    return t('agoDay', { n: Math.round(mins / 1440) });
  };

  const reasonText = (r: Reason) => {
    switch (r.kind) {
      case 'missedStreak': return t('reasonMissed', { n: r.count });
      case 'pain': return r.detail ? t('reasonPainDetail', { detail: r.detail }) : t('reasonPain');
      case 'wantsReply': return r.comment ? t('reasonReplyQuote', { quote: r.comment.slice(0, 60) }) : t('reasonReply');
      case 'offPlan': return t(r.direction === 'too_fast' ? 'reasonFast' : r.direction === 'too_slow' ? 'reasonSlow' : 'reasonMixed');
    }
  };

  const planned = (tr: Trainee) => tr.today.state === 'rest'
    ? t('restDay')
    : <>{tr.today.name}{tr.today.plannedM > 0 && <> · <Num>{km(tr.today.plannedM)}</Num> {t('km')}</>}
      {tr.today.paceMin && tr.today.paceMax ? <> @ <Num>{`${formatPace(tr.today.paceMin)}–${formatPace(tr.today.paceMax)}`}</Num></> : null}</>;
  const done = (tr: Trainee) => {
    if (tr.today.state === 'done' && tr.today.actual) {
      const a = tr.today.actual;
      return <span className="font-bold text-ink-700"><Num>{km(a.distanceM)}</Num> {t('km')} · <Num>{formatDuration(a.durationSec)}</Num>{a.pace ? <> · <Num>{formatPace(a.pace)}</Num></> : null}{a.hr ? <> · ♥ <Num>{Math.round(a.hr)}</Num></> : null}</span>;
    }
    if (tr.today.state === 'notyet') return <span className="font-bold text-band-3-ink">{t('notYet')}</span>;
    return <span className="text-ink-400">—</span>;
  };

  if (error) return <p className="rounded-card border border-page bg-card px-4 py-5 text-center text-sm text-ink-400">{t('loadFailed')}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-card" />;
  const list = filter === 'attention' ? attention : filter === 'done'
    ? trainees.filter((tr) => tr.today.state === 'done') : filter === 'notyet'
      ? trainees.filter((tr) => tr.today.state === 'notyet') : trainees;

  return (
    <div className="space-y-3">
      {/* ── Messages ── */}
      {messages.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <h2 className="text-sm font-extrabold text-ink-700">{t('messages')}</h2>
            {unreadTotal > 0 && <span className="rounded-full bg-accent-red px-1.5 text-2xs font-bold text-white">{unreadTotal}</span>}
            <Link href={academyThreadUrl({ recipientIsStaff: true, traineeId: null })} className="ms-auto text-xs font-bold text-brand-600">{t('allChats')}</Link>
          </div>
          <div className="divide-y divide-page overflow-hidden rounded-card border border-page bg-card">
            {messages.slice(0, 4).map((m) => (
              <div key={m.athleteId} className="flex items-center gap-2.5 px-3 py-2.5">
                <FeedAvatar name={m.name} url={null} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="truncate text-sm text-ink-900">{m.name}</b>
                    <span className="shrink-0 text-2xs text-ink-400">{ago(m.lastTraineeMessageAt)}</span>
                  </div>
                  <p className="truncate text-xs text-ink-700" dir="auto">{m.lastFromTrainee && m.lastText ? m.lastText : t('waitingReply')}</p>
                </div>
                {m.unreadCount > 0 && <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1 text-2xs font-extrabold text-white">{m.unreadCount}</span>}
                <Link href={academyThreadUrl({ recipientIsStaff: true, traineeId: m.athleteId })} className="grid h-9 place-items-center rounded-xl bg-brand-600/10 px-3 text-xs font-extrabold text-brand-600">{t('reply')}</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── The day in five numbers ── */}
      <div className="grid grid-cols-5 overflow-hidden rounded-card border border-page bg-card text-center">
        {([['all', counts.all, 'text-ink-900'], ['done', counts.done, 'text-accent-900'], ['notyet', counts.notyet, 'text-band-3-ink'], ['attention', attention.length, 'text-accent-red'], ['rest', counts.rest, 'text-ink-500']] as const).map(([k, n, c], i) => (
          <div key={k} className={cn('py-2', i > 0 && 'border-s border-page')}>
            <b className={cn('block text-xl font-black tabular-nums', c)}>{n}</b>
            <span className="text-3xs text-ink-400">{t(`sum_${k}`)}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(['attention', 'all', 'done', 'notyet'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('h-9 shrink-0 rounded-full px-3.5 text-xs font-bold', filter === f ? 'bg-ink-900 text-white' : 'bg-card text-ink-500')}>
            {t(`filter_${f}`)} <Num>{f === 'attention' ? attention.length : counts[f]}</Num>
          </button>
        ))}
      </div>

      {/* ── Cards ── */}
      {list.length === 0 && <p className="px-1 py-4 text-center text-sm text-ink-400">{filter === 'attention' ? t('allGood') : t('none')}</p>}
      {list.map((tr) => {
        const loud = tr.open.length > 0 && filter !== 'done';
        const expanded = loud || open === tr.athleteId;
        if (!expanded) {
          return (
            <button key={tr.athleteId} onClick={() => setOpen(tr.athleteId)} className="flex w-full items-center gap-2.5 rounded-card border border-page bg-card px-3 py-2.5 text-start">
              <FeedAvatar name={tr.name} url={tr.avatarUrl} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm text-ink-900">{tr.name}</b>
                <span className="block truncate text-xs text-ink-500">{tr.today.state === 'done' ? <>✓ {tr.today.name}</> : tr.today.state === 'rest' ? t('restDay') : <>{t('today')}: {tr.today.name}</>}</span>
              </div>
              <Strip strip={tr.strip} />
              {tr.today.score != null ? <Ring score={tr.today.score} size={30} /> : <ChevronDown className="h-4 w-4 text-ink-300" />}
            </button>
          );
        }
        const first = tr.open[0];
        const call = first?.kind === 'missedStreak' && tr.phone;
        return (
          <article key={tr.athleteId} className="overflow-hidden rounded-card border border-page bg-card">
            {first && (
              <div className={cn('px-3 py-2 text-[13px] font-extrabold', first.kind === 'wantsReply' ? 'bg-band-2/10 text-band-2-ink' : 'bg-accent-red/10 text-accent-red-ink')} dir="auto">
                {reasonText(first)}{tr.open.length > 1 && <span className="font-semibold opacity-80"> · {t('moreReasons', { n: tr.open.length - 1 })}</span>}
              </div>
            )}
            <div className="p-3">
              <Link href={`/dashboard/academy/week?athleteId=${encodeURIComponent(tr.athleteId)}`} className="flex items-center gap-2.5">
                <FeedAvatar name={tr.name} url={tr.avatarUrl} className="h-9 w-9" />
                <b className="min-w-0 flex-1 truncate text-[15px] text-ink-900">{tr.name}</b>
                <Strip strip={tr.strip} />
                {tr.today.score != null && <Ring score={tr.today.score} />}
              </Link>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs leading-snug">
                <div className="rounded-xl bg-page/50 px-2.5 py-2"><span className="block text-3xs font-bold text-ink-400">{t('planned')}</span>{planned(tr)}</div>
                <div className="rounded-xl bg-page/50 px-2.5 py-2"><span className="block text-3xs font-bold text-ink-400">{t('doneLabel')}</span>{done(tr)}</div>
              </div>
              {tr.weekKm.planned > 0 && (
                <div className="mt-2.5 flex items-center gap-2 text-xs">
                  <span className="font-bold text-ink-400">{t('week')}</span>
                  <div dir="ltr" className="h-1.5 flex-1 overflow-hidden rounded-full bg-page">
                    <div className={cn('h-full rounded-full', tr.weekKm.done < tr.weekKm.planned * 0.6 ? 'bg-accent-red' : 'bg-brand-600')} style={{ width: `${Math.min(100, (tr.weekKm.done / tr.weekKm.planned) * 100)}%` }} />
                  </div>
                  <b className="text-ink-700"><Num>{`${tr.weekKm.done}/${tr.weekKm.planned}`}</Num> {t('km')}</b>
                </div>
              )}
              {(tr.lastFeel || tr.tomorrow) && (
                <p className="mt-1.5 text-2xs text-ink-500">
                  {tr.lastFeel?.difficulty != null && <>{t('lastEffort', { n: tr.lastFeel.difficulty })}</>}
                  {tr.lastFeel?.difficulty != null && tr.tomorrow && ' · '}
                  {tr.tomorrow && <>{t('tomorrow')}: {tr.tomorrow.name}</>}
                </p>
              )}
              <div className="mt-2.5 flex gap-1.5">
                {call ? (
                  <a href={`tel:${tr.phone}`} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-page/60 text-xs font-bold text-ink-700"><Phone className="h-4 w-4" />{t('call')}</a>
                ) : (
                  <Link href={academyThreadUrl({ recipientIsStaff: true, traineeId: tr.athleteId })} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-page/60 text-xs font-bold text-ink-700"><MessageCircle className="h-4 w-4" />{tr.open.length ? t('message') : t('wellDone')}</Link>
                )}
                {tr.phone && !call && (
                  <a href={`https://wa.me/${waNumber(tr.phone)}`} target="_blank" rel="noreferrer" className="grid h-10 w-11 place-items-center rounded-xl bg-page/60 text-xs font-bold text-ink-700" aria-label={t('whatsapp')}>WA</a>
                )}
                {tr.open.length > 0 ? (
                  <button onClick={() => markHandled(tr)} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 text-xs font-bold text-white"><Check className="h-4 w-4" />{t('handled')}</button>
                ) : (
                  <button onClick={() => setOpen(null)} className="grid h-10 w-11 place-items-center rounded-xl bg-page/60 text-ink-500" aria-label={t('collapse')}><ChevronDown className="h-4 w-4 rotate-180" /></button>
                )}
              </div>
            </div>
          </article>
        );
      })}
      {filter === 'attention' && onPlan.length > 0 && (
        <section>
          <h2 className="mb-1.5 px-1 text-sm font-extrabold text-ink-700">{t('onPlan')} <span className="font-medium text-ink-400">· {onPlan.length}</span></h2>
          <div className="space-y-1.5">
            {onPlan.map((tr) => (
              open === tr.athleteId ? null : (
                <button key={tr.athleteId} onClick={() => { setFilter('all'); setOpen(tr.athleteId); }} className="flex w-full items-center gap-2.5 rounded-card border border-page bg-card px-3 py-2.5 text-start">
                  <FeedAvatar name={tr.name} url={tr.avatarUrl} className="h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm text-ink-900">{tr.name}</b>
                    <span className="block truncate text-xs text-ink-500">{tr.today.state === 'done' ? <>✓ {tr.today.name}{tr.today.actual && <> · <Num>{km(tr.today.actual.distanceM)}</Num> {t('km')}</>}</> : tr.today.state === 'rest' ? t('restDay') : <>{t('today')}: {tr.today.name}</>}</span>
                  </div>
                  <Strip strip={tr.strip} />
                  {tr.today.score != null && <Ring score={tr.today.score} size={30} />}
                </button>
              )
            ))}
          </div>
        </section>
      )}

      {/* ── Recent ── */}
      {data.events.length > 0 && (
        <section>
          <h2 className="mb-1.5 px-1 text-sm font-extrabold text-ink-700">{t('recent')}</h2>
          <div className="divide-y divide-page overflow-hidden rounded-card border border-page bg-card">
            {(allEvents ? data.events : data.events.slice(0, 3)).map((e, i) => (
              <div key={`${e.athleteId}-${e.at}-${i}`} className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-0.5 text-base" aria-hidden>{e.kind === 'run' ? '🏃' : e.kind === 'pain' ? '🩹' : e.kind === 'reply' ? '💬' : '📝'}</span>
                <div className="min-w-0 flex-1 text-xs leading-snug text-ink-700" dir="auto">
                  <b>{e.name.split(' ')[0]}</b>{' '}
                  {e.kind === 'run' ? t('evRun', { name: e.text || '' }) : e.kind === 'pain' ? t('evPain') : e.kind === 'reply' ? t('evReply') : t('evFeedback')}
                  {e.kind === 'run' && e.score != null && <> — <Num>{e.score}</Num></>}
                  {e.text && e.kind !== 'run' && <span className="block truncate text-ink-500">{e.text}</span>}
                </div>
              </div>
            ))}
            {data.events.length > 3 && !allEvents && (
              <button onClick={() => setAllEvents(true)} className="h-10 w-full text-center text-xs font-bold text-brand-600">{t('moreRecent', { n: data.events.length - 3 })}</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
