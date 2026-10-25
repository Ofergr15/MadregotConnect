'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { israelDateTime } from '@/lib/survey-reminders';
import { useLocale, useTranslations } from 'next-intl';
import {
  Apple, BarChart3, Bell, Check, ChevronLeft, ClipboardList, ExternalLink, Folder, History, Lock, MessageCircle, Pencil, Plus, Send, Star, Upload, Users, Watch,
} from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn, getPlanWeekStart, israelToday } from '@/lib/utils';
import { Sheet, Switch, SkeletonList, EmptyState } from '@/components/ui';
import { SECTIONS, addDays, canEdit, israelHourToIso, type Owner, type Owners, type Section, type TimelineRow } from '@/lib/week-setup/model';
import type { WeekSnapshot } from '@/lib/week-setup/server';
import { Btn, Chips, DAY_LONG, DAY_SHORT, Field, OwnerChip, Pill, Trail, WeekCard, dm, dowOf, hh, inputCls, type Tone } from './parts';
import { STEPS, lastByStep, mineOf, weekOfAction, type LogEntry, type Step } from '@/lib/week-setup/log';
import { pendingOf, type PlannedPoll } from '@/lib/week-setup/planned-polls';
import { FOLDER_KINDS, KIND_LABEL, type FolderKind } from '@/lib/photos/folder-kind';
import { MessageSheet, PollSheet } from './editors';

/**
 * "תחילת שבוע" — the club's week set up in one screen (mockup ~/.cache/madregot/week-setup.html,
 * Ofer 2026-10-19). One card per part of the week, each with its owner and its state, and the
 * action inside the card. Everyone on the staff sees the whole week; what each may change is
 * the owners' split (lib/week-setup/model canEdit). Everything here is changeable: the
 * automatic notifications for this week only, the photo folders before and after they are
 * made, the quality days, the polls.
 *
 * The flow (Ofer, 10-24: "we see who set what — Yair pushed the plan — and I know I can go
 * on to the polls; really a flow"; mockup ~/.cache/madregot/mockups/week-setup-v2.html): the
 * seven steps in their order, numbered, "הבא בתור" framed; under each, who did it and when
 * (lib/week-setup/log); "מה קרה השבוע" for everyone at the top; and sending to the watches
 * is the last step, after everything else.
 */

type Me = { id: string | null; admin: boolean; coach: boolean; approver: boolean };
type Data = WeekSnapshot & { me: Me; mine: Step[] };

const COLORS: Record<Step, string> = {
  workouts: '#1525FF', nutrition: '#B45309', quality: '#C2185B', notifications: '#6D28D9', polls: '#475569', message: '#15803d', watches: '#0B5285',
};

/** A step's place, its last line and whether it is next — what every card is given. */
type Meta = { step: number; trail: React.ReactNode; next: boolean };

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

async function send(url: string, method: string, body: unknown): Promise<boolean> {
  const res = await fetch(url, { method, headers: await apiHeaders(true), body: JSON.stringify(body) }).catch(() => null);
  return !!res?.ok;
}

export function WeekSetup() {
  const t = useTranslations('weekSetup');
  const lang = useLocale().startsWith('en') ? 'en' : 'he';
  const thisWeek = getPlanWeekStart(new Date());
  // On a Saturday the screen is about the week that starts tomorrow (lib/week-setup/log weekOfAction).
  const [week, setWeek] = useState(() => weekOfAction(israelToday()));
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get('week');
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) setWeek(getPlanWeekStart(new Date(`${w}T12:00:00`)));
  }, []);
  const { data, error, isLoading, mutate } = useApi<Data>(`/api/week-setup?week=${week}`);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [notif, setNotif] = useState<TimelineRow | 'new' | null>(null);
  const [folderDate, setFolderDate] = useState<string | null>(null);
  // Stage 3: the poll (new, or one still waiting) and the message, edited in place.
  const [pollOpen, setPollOpen] = useState<PlannedPoll | 'new' | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id); }, [toast]);

  const run = async (p: Promise<boolean>) => {
    const ok = await p;
    setToast({ ok, text: ok ? t('saved') : t('failed') });
    await mutate();
    return ok;
  };

  if (error) return <EmptyState title={t('loadFailed')} />;
  if (isLoading || !data) return <div className="p-4"><SkeletonList count={5} /></div>;

  const me = data.me;
  const may = (s: Section) => canEdit(s, data.owners, me);
  const coach = data.staff.find((s) => s.role === 'coach');
  const admin = data.staff.find((s) => s.id === me.id && me.admin) ?? data.staff.find((s) => s.role === 'admin' && !/admin/i.test(s.name)) ?? data.staff.find((s) => s.role === 'admin');
  const coachName = firstName(coach?.name ?? 'Coach');
  const adminName = firstName(admin?.name ?? 'Admin');
  const ownerChip = (s: Section) => {
    const o = data.owners[s];
    if (o === 'both') return <OwnerChip name={t('own_both')} initials="2" color="#5F616C" />;
    const p = o === 'coach' ? coach : admin;
    const mine = !!p && p.id === me.id;
    return <OwnerChip name={firstName(p?.name ?? '')} initials={initials(p?.name ?? '?')} color={o === 'coach' ? '#0B5285' : '#1525FF'} me={mine ? t('you') : undefined} />;
  };
  const offset = Math.round((Date.parse(week) - Date.parse(thisWeek)) / (7 * 86_400_000));
  const planner = `/dashboard/plan/new${offset ? `?week=${offset}` : ''}`;
  const coachOnly = !me.admin;
  const mine = SECTIONS.filter(may);
  const others = SECTIONS.filter((s) => !may(s));
  const list = (ss: Section[]) => ss.map((s) => t(`sec_${s}`)).join(' · ');
  const nextWeek = addDays(thisWeek, 7);
  const range = (ws: string) => `${Number(ws.slice(8, 10))}–${dm(addDays(ws, 6))}`;
  // Who did what (lib/week-setup/log): the last line of each step, and the step that is next.
  const last = lastByStep(data.log);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const actLabel = (e: LogEntry) => `${t(`act_${e.action}`)}${e.detail ? ` · ${e.detail}` : ''}`;
  const meta = (st: Step): Meta => {
    const e = last[st];
    return {
      step: STEPS.indexOf(st) + 1,
      next: data.readiness.next === st,
      trail: e ? <Trail done={e.action !== 'unskipped'} name={firstName(e.name)} when={when(e.at)} what={actLabel(e)} /> : null,
    };
  };
  const skippedNow = (st: Step) => last[st]?.action === 'skipped';
  const skipBtn = (st: Step) => (
    <Btn kind="sec" onClick={() => run(send('/api/week-setup/skip', 'POST', { week, step: st, undo: skippedNow(st) }))}>{skippedNow(st) ? t('unskip') : t('skipWeek')}</Btn>
  );

  return (
    <div className="pb-28">
      <div className="px-[18px] pt-2">
        <h1 className="text-[30px] font-extrabold tracking-tight text-ink-900">{t('title')}</h1>
        <div className="mt-2.5 flex gap-1.5">
          {[thisWeek, nextWeek].map((ws, i) => (
            <button key={ws} type="button" onClick={() => setWeek(ws)}
              className={cn('min-h-[34px] rounded-full px-3 text-[13px] font-bold', week === ws ? 'bg-ink-900 text-white' : 'bg-card text-ink-500')}>
              {i === 0 ? t('thisWeek') : t('nextWeek')} · <bdi dir="ltr">{range(ws)}</bdi>
            </button>
          ))}
        </div>
      </div>

      {coachOnly ? (
        // A coach sees their own part: its progress and next step; the rest as status only (10-24).
        <div className="mx-4 mb-2.5 mt-3 rounded-2xl bg-[#EAF2F8] px-3.5 py-3">
          <b className="block text-[15px] text-[#0B3C61]">{t('coachHello', { name: coachName, what: list(mine) })}</b>
          {(() => { const m = mineOf(data.readiness, data.mine); return (
            <span className="mt-0.5 block text-13 font-bold text-[#0B5285]">
              {m.next ? <>{t('mineProgress', { done: m.done, total: m.total })} · {t('next', { what: t(`miss_${m.next}`) })}</> : t('mineDone')}
            </span>
          ); })()}
        </div>
      ) : (
        <Progress r={data.readiness} t={t} />
      )}

      <WeekLog entries={data.log} t={t} when={when} label={actLabel} />

      {may('workouts') && <WorkoutsCard d={data} m={meta('workouts')} t={t} lang={lang} owner={ownerChip('workouts')} planner={planner} adminName={adminName}
        doneAlready={!!data.log.some((e) => e.action === 'done' && e.by === me.id)}
        onDone={coachOnly ? () => run(send('/api/week-setup/done', 'POST', { week, sections: mine })) : undefined} />}
      {may('nutrition') && <NutritionCard d={data} m={meta('nutrition')} t={t} lang={lang} owner={ownerChip('nutrition')} onUpload={(f) => run(uploadNutrition(data, f))}
        skip={!data.pdf.nutrition ? skipBtn('nutrition') : undefined} />}
      {may('quality') && <QualityCard d={data} m={meta('quality')} t={t} lang={lang} owner={ownerChip('quality')} onOpenFolder={setFolderDate}
        onSave={(days) => run(send('/api/quality-session/plan-days', 'PUT', { week, days }))}
        onCreate={(date, name) => run(send('/api/social/folders', 'POST', { date, name }))} />}
      {may('notifications') && <NotificationsCard d={data} m={meta('notifications')} t={t} lang={lang} owner={ownerChip('notifications')} onOpen={setNotif}
        onToggle={(r, on) => run(send('/api/week-setup/override', 'PUT', { week, key: r.key, value: on ? null : { ...overrideOf(r), off: true } }))}
        onApproveAll={me.approver ? () => run(approveAll(data.timeline)) : undefined} />}
      {may('polls') && <PollsCard d={data} m={meta('polls')} t={t} lang={lang} owner={ownerChip('polls')} onOpen={setPollOpen}
        skip={!data.polls.length && !pendingOf(data.plannedPolls).length ? skipBtn('polls') : undefined} />}
      {may('message') && (
        <WeekCard icon={MessageCircle} color={COLORS.message} title={t('sec_message')} owner={ownerChip('message')} {...meta('message')}
          actions={<>
            <Btn kind="sec" icon={Plus} onClick={() => setMsgOpen(true)}>{t('writeMessage')}</Btn>
            {!data.log.some((e) => e.step === 'message' && e.action === 'message_sent') && skipBtn('message')}
          </>}>
          <p className="mt-[9px] text-[13.5px] leading-relaxed text-ink-500">{t('messageLead')}</p>
        </WeekCard>
      )}
      {may('workouts') && <WatchesCard d={data} m={meta('watches')} t={t} owner={ownerChip('workouts')} onSent={() => { void mutate(); }} />}

      {others.length > 0 && (
        // The rest of the week, as status only: whose it is, done or not, and the last line without its detail.
        <section className="mx-4 mb-2.5 rounded-[22px] bg-card px-3.5 py-3">
          <div className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-ink-400" /><b className="text-[14px] font-extrabold text-ink-900">{t('othersTitle')}</b></div>
          {STEPS.filter((st) => !data.mine.includes(st)).map((st) => {
            const ok = !data.readiness.missing.includes(st);
            const e = last[st];
            return (
              <div key={st} className="flex items-center gap-2 border-b border-[#F3F4F6] py-2 text-[13px] last:border-0">
                <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black', ok ? 'bg-[#15803d] text-white' : 'bg-[#EEEFF2] text-ink-400')}>{ok ? '✓' : STEPS.indexOf(st) + 1}</span>
                <b className="flex-1 font-bold text-ink-900">{t(`sec_${st}`)}</b>
                <span className="truncate text-[12px] text-ink-400">{e ? `${firstName(e.name)} · ${when(e.at)}` : adminName} · {ok ? t('othersDone') : t('othersOpen')}</span>
              </div>
            );
          })}
        </section>
      )}

      {me.admin && (
        <button type="button" onClick={() => setOwnersOpen(true)} className="mx-4 mt-1 flex w-[calc(100%-2rem)] items-center gap-[11px] rounded-[18px] bg-card px-3.5 py-[13px] text-start">
          <Users className="h-[18px] w-[18px] text-ink-500" />
          <span className="flex flex-1 flex-col">
            <b className="text-[14.5px] text-ink-900">{t('owners')}</b>
            <span className="text-[12.5px] text-ink-400">{ownersLine(data.owners, coachName, adminName, t)}</span>
          </span>
          <ChevronLeft className="h-[17px] w-[17px] text-ink-300 ltr:rotate-180" />
        </button>
      )}

      <OwnersSheet open={ownersOpen} onClose={() => setOwnersOpen(false)} owners={data.owners} coachName={coachName} adminName={adminName} t={t}
        onSave={async (o) => { if (await run(send('/api/week-setup/owners', 'PUT', { owners: o }))) setOwnersOpen(false); }} />
      <NotifSheet row={notif} d={data} t={t} lang={lang} week={week} approver={me.approver} onClose={() => setNotif(null)} run={run} />
      <FolderSheet date={folderDate} d={data} t={t} lang={lang} admin={me.admin} onClose={() => setFolderDate(null)} run={run} />
      <PollSheet open={!!pollOpen} poll={pollOpen && pollOpen !== 'new' ? pollOpen : null} d={data} t={t} lang={lang} onClose={() => setPollOpen(null)} run={run} />
      <MessageSheet open={msgOpen} d={data} t={t} lang={lang} onClose={() => setMsgOpen(false)} run={run} />

      {toast && (
        <div role="status" className={cn('fixed inset-x-0 bottom-[96px] z-50 mx-auto w-fit rounded-full px-4 py-2 text-sm font-bold text-white shadow-lg', toast.ok ? 'bg-ink-900' : 'bg-[#AD3838]')}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;
type Lang = 'he' | 'en';

function ownersLine(o: Owners, coach: string, admin: string, t: T) {
  const by = (who: Owner) => SECTIONS.filter((s) => o[s] === who).map((s) => t(`sec_${s}`));
  const c = by('coach'); const b = by('both');
  return [c.length ? `${coach} — ${c.join(', ')}` : null, b.length ? `${t('own_both')} — ${b.join(', ')}` : null, `${admin} — ${by('admin').join(', ') || '—'}`]
    .filter(Boolean).join(' · ');
}

function overrideOf(r: TimelineRow) {
  return {
    title: r.title !== r.defaultTitle ? r.title : undefined,
    body: r.body !== r.defaultBody ? r.body : undefined,
    // Kept: turning it off and back on used to drop an hour change made to it (10-24).
    hour: r.changed ? r.hour : undefined,
  };
}

async function approveAll(rows: TimelineRow[]): Promise<boolean> {
  const dates = [...new Set(rows.filter((r) => r.state === 'approve').map((r) => addDays(r.date, 1)))];
  const res = await Promise.all(dates.map((date) => send('/api/notifications/approvals', 'POST', { date, action: 'approve' })));
  return res.every(Boolean);
}

async function uploadNutrition(d: WeekSnapshot, file: File): Promise<boolean> {
  const fd = new FormData();
  fd.append('week_number', String(d.weekNumber));
  fd.append('week_start_date', d.weekStart);
  fd.append('nutrition_pdf', file);
  const res = await fetch('/api/program-weeks', { method: 'POST', headers: await bearerHeaders(false), body: fd }).catch(() => null);
  return !!res?.ok;
}

// ── progress ────────────────────────────────────────────────────────────────────────

function Progress({ r, t }: { r: WeekSnapshot['readiness']; t: T }) {
  const C = 2 * Math.PI * 26;
  const ready = r.missing.length === 0;
  return (
    <div className="mx-4 mb-1 mt-3.5 flex items-center gap-3.5 rounded-[22px] bg-card px-4 py-3.5">
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
          <circle cx="32" cy="32" r="26" fill="none" stroke="#EEF0F6" strokeWidth="7" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={ready ? '#15803d' : '#1525FF'} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${(C * r.done) / r.total} 999`} transform="rotate(-90 32 32)" />
        </svg>
        <b className="absolute inset-0 grid place-items-center text-base font-black text-ink-900"><bdi dir="ltr">{r.done}/{r.total}</bdi></b>
      </div>
      <div className="min-w-0">
        <b className="block text-base font-extrabold text-ink-900">{ready ? t('ready') : t('notReady')}</b>
        {!ready && r.next && <span className="block text-13 font-bold leading-snug text-brand-600">{t('next', { what: t(`miss_${r.next}`) })}</span>}
        {!ready && <span className="text-13 leading-snug text-ink-400">{t('missing', { list: r.missing.map((s) => t(`miss_${s}`)).join(' · ') })}</span>}
      </div>
    </div>
  );
}

// ── workouts ────────────────────────────────────────────────────────────────────────

const PLAN_TONE: Record<WeekSnapshot['plan']['status'], Tone> = { none: 'todo', draft: 'warn', partial: 'warn', pushed: 'ok' };

function WorkoutsCard({ d, m, t, lang, owner, planner, adminName, onDone, doneAlready }: { d: WeekSnapshot; m: Meta; t: T; lang: Lang; owner: React.ReactNode; planner: string; adminName: string; onDone?: () => Promise<boolean>; doneAlready: boolean }) {
  // Kept in the week's log, so it is still "sent" after a reload (it used to be this tap's state).
  const [done, setDone] = useState(doneAlready);
  useEffect(() => { setDone(doneAlready); }, [doneAlready]);
  const created = d.plan.createdAt ? new Date(d.plan.createdAt).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <>
      <div className="h-2.5" />
      {/* Sending to the watches is the last step now (WatchesCard), after everything else. */}
      <WeekCard icon={ClipboardList} color={COLORS.workouts} title={t('sec_workouts')} owner={owner} {...m}
        status={<Pill tone={d.plan.status === 'none' ? 'todo' : 'ok'}>{d.plan.status === 'none' ? t('plan_none') : t('act_plan_uploaded')}</Pill>}
        actions={<Btn kind={d.plan.status === 'none' ? 'pri' : 'sec'} href={planner}>{t('openPlanner')}</Btn>}>
        <div className="mt-3 flex gap-1">
          {d.days.map((day) => {
            const km = day.sessions.reduce((a, s) => a + s.km, 0);
            const main = day.sessions.find((x) => !x.optional) ?? day.sessions[0];
            const name = main ? t(`type_${main.type}`) : day.daySession?.title || '';
            return (
              <Link key={day.date} href={planner}
                className={cn('relative flex min-w-0 flex-1 flex-col items-center gap-px rounded-xl px-0.5 pb-1.5 pt-[7px]',
                  day.quality ? 'bg-[#FCE9F2] shadow-[inset_0_0_0_1.5px_#C2185B44]' : day.team ? 'bg-brand-600/[0.07] shadow-[inset_0_0_0_1.5px_#1525FF33]' : 'bg-[#F4F5F8]')}>
                <span className="text-[11px] font-bold text-ink-400">{DAY_SHORT[lang][day.dayOfWeek]}</span>
                <b className="text-sm font-extrabold text-ink-900"><bdi dir="ltr">{km ? Math.round(km * 10) / 10 : '–'}</bdi></b>
                <span className="w-full truncate text-center text-[9.5px] text-ink-400">{name}</span>
                {day.team && <i className="mt-px text-[8.5px] font-extrabold not-italic text-brand-600">{t('team')}</i>}
              </Link>
            );
          })}
        </div>
        <p className="mt-2.5 text-[12.5px] leading-normal text-ink-400">
          {[t('tapDay'), created ? t('uploadedAt', { when: created }) : null, d.pdf.training ? null : t('noTrainingPdf')].filter(Boolean).join(' · ')}
        </p>
        {onDone && (
          <button type="button" disabled={done} onClick={async () => { if (await onDone()) setDone(true); }}
            className="mt-2.5 flex w-full items-center gap-2 rounded-[14px] bg-[#E8F6EE] px-3 py-[11px] text-start text-[13.5px] font-bold text-[#15803d]">
            <Check className="h-4 w-4" strokeWidth={3} />
            <span>{done ? t('doneSent', { name: adminName }) : t('doneBtn', { name: adminName })}</span>
          </button>
        )}
      </WeekCard>
    </>
  );
}

// ── nutrition ───────────────────────────────────────────────────────────────────────

function NutritionCard({ d, m, t, lang, owner, onUpload, skip }: { d: WeekSnapshot; m: Meta; t: T; lang: Lang; owner: React.ReactNode; onUpload: (f: File) => Promise<boolean>; skip?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The days that have something to eat around: a team day, a one-day session, or guidance already written.
  const days = d.days.filter((x) => x.team || x.daySession || x.sessions.some((s) => s.km >= 20));
  return (
    <WeekCard icon={Apple} color={COLORS.nutrition} title={t('sec_nutrition')} owner={owner} {...m} actions={skip}
      status={<Pill tone={d.pdf.nutrition ? 'ok' : 'todo'}>{d.pdf.nutrition ? t('pdfThere') : t('pdfMissing')}</Pill>}>
      <input ref={input} type="file" accept="application/pdf" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); await onUpload(f); setBusy(false); }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()}
        className="mt-2.5 flex w-full items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-[#B4530966] px-3 py-[11px] text-start text-[13.5px] font-bold text-[#B45309] disabled:opacity-60">
        <Upload className="h-[18px] w-[18px]" />
        <span className="flex-1">{d.pdf.nutrition ? `${t('nutritionPdf')} · ${t('uploadPdf')}` : t('uploadPdf')}</span>
        {d.pdf.nutrition && <a href={d.pdf.nutrition} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-4 w-4" /></a>}
      </button>
      <div className="mt-2">
        {days.map((day) => {
          const n = day.daySession?.nutrition ?? [];
          const main = day.sessions.find((x) => !x.optional) ?? day.sessions[0];
          const what = main ? `${t(`type_${main.type}`)} · ${t('km', { km: main.km })}` : day.daySession?.title || '';
          const title = n.length ? n.map((x) => `${t(`nutritionWhen_${x.when}` as 'nutritionWhen_before')}: ${x.text}`).join(' · ') : what;
          return (
            <Link key={day.date} href={`/dashboard/day-session?date=${day.date}`} className="flex items-center gap-2 border-b border-[#F3F4F6] py-[9px] last:border-0">
              <span className="w-[62px] shrink-0 text-xs font-extrabold text-ink-500">{DAY_SHORT[lang][day.dayOfWeek]} <bdi dir="ltr">{dm(day.date)}</bdi></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13.5px] font-bold text-ink-900">{title || DAY_LONG[lang][day.dayOfWeek]}</b>
                {!n.length && <span className="flex items-center gap-1 text-[11.5px] text-ink-400">{t('nutritionNone')}</span>}
              </span>
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#F2F3F6] text-ink-500">
                {n.length ? <Pencil className="h-[15px] w-[15px]" /> : <Plus className="h-[15px] w-[15px]" />}
              </span>
            </Link>
          );
        })}
      </div>
    </WeekCard>
  );
}

// ── quality days and folders ────────────────────────────────────────────────────────

function QualityCard({ d, m, t, lang, owner, onSave, onOpenFolder, onCreate }: {
  d: WeekSnapshot; m: Meta; t: T; lang: Lang; owner: React.ReactNode;
  onSave: (days: number[]) => Promise<boolean>; onOpenFolder: (date: string) => void; onCreate: (date: string, name: string) => Promise<boolean>;
}) {
  const [days, setDays] = useState<number[]>(d.qualityDays);
  useEffect(() => { setDays(d.qualityDays); }, [d.weekStart, d.qualityDays.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = days.join(',') !== d.qualityDays.join(',') || !d.qualityPicked;
  const toggle = (k: number) => setDays((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k].sort()));
  const status = d.qualityPicked ? <Pill tone="ok">{d.qualityDays.map((k) => DAY_SHORT[lang][k]).join(' · ') || '—'}</Pill>
    : <Pill tone={d.qualityDays.length ? 'warn' : 'todo'}>{d.qualityDays.length ? t('qualityGuessed') : t('qualityNone')}</Pill>;
  return (
    <WeekCard icon={Star} color={COLORS.quality} title={t('sec_quality')} owner={owner} status={status} {...m}
      actions={dirty ? <Btn icon={Check} onClick={() => onSave(days)}>{t('saveQuality')}</Btn> : undefined}>
      <p className="mt-[9px] text-[13.5px] leading-relaxed text-ink-500">{t('qualityLead')}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {d.days.map((day) => (
          <button key={day.date} type="button" onClick={() => toggle(day.dayOfWeek)} aria-pressed={days.includes(day.dayOfWeek)}
            className={cn('min-h-[36px] rounded-xl px-2.5 text-[13px] font-bold',
              days.includes(day.dayOfWeek) ? 'bg-[#FCE9F2] text-[#C2185B] shadow-[inset_0_0_0_1.5px_#C2185B55]' : 'bg-[#F2F3F6] text-ink-500')}>
            {DAY_SHORT[lang][day.dayOfWeek]} · <bdi dir="ltr">{dm(day.date)}</bdi>
          </button>
        ))}
      </div>
      {d.qualityDays.length > 0 && (
        <div className="mt-2.5 border-t border-[#F0F1F4]">
          {d.qualityDays.map((k) => {
            const day = d.days[k];
            const f = d.folders[day.date];
            const made = !!f?.folderId;
            return (
              <div key={day.date} className="flex items-center gap-2.5 border-b border-[#F5F6F8] py-[9px]">
                <Folder className={cn('h-[17px] w-[17px] shrink-0', f?.skipped ? 'text-ink-300' : 'text-[#B45309]')} />
                <button type="button" onClick={() => onOpenFolder(day.date)} className="flex min-w-0 flex-1 flex-col text-start">
                  <span className={cn('truncate text-[13.5px] font-bold', f?.skipped ? 'text-ink-400 line-through' : 'text-ink-900')}>{f?.name || day.folderName}</span>
                  <em className="text-[11.5px] not-italic text-ink-400">
                    {DAY_SHORT[lang][k]} <bdi dir="ltr">{dm(day.date)}</bdi> · {f?.skipped ? t('folderSkipped') : made ? t('folderMade') : t('folderOpensAt')}
                  </em>
                </button>
                <button type="button" onClick={() => onOpenFolder(day.date)} aria-label={t('folderSheet')} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#F2F3F6] text-ink-500">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {made ? (
                  <a href={f.link} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-600">{t('openDrive')}</a>
                ) : !f?.skipped && (
                  <button type="button" onClick={() => onCreate(day.date, f?.name || day.folderName)} className="min-h-[36px] text-xs font-bold text-brand-600">{t('folderOpenNow')}</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WeekCard>
  );
}

function FolderSheet({ date, d, t, lang, admin, onClose, run }: { date: string | null; d: WeekSnapshot; t: T; lang: Lang; admin: boolean; onClose: () => void; run: (p: Promise<boolean>) => Promise<boolean> }) {
  const day = date ? d.days.find((x) => x.date === date) : null;
  const f = date ? d.folders[date] : undefined;
  const [name, setName] = useState('');
  const [autoFeed, setAutoFeed] = useState(true);
  const [tell, setTell] = useState(true);
  const [kind, setKind] = useState<FolderKind | ''>('');
  const [tags, setTags] = useState('');
  const [pinned, setPinned] = useState(false);
  useEffect(() => { if (day) {
    setName(f?.name || day.folderName); setAutoFeed(f?.autoFeed !== false); setTell(!f?.toldAt);
    const x = f as unknown as { kind?: FolderKind; tags?: string[]; pinned?: boolean } | undefined;
    setKind(x?.kind ?? ''); setTags((x?.tags ?? []).join(', ')); setPinned(!!x?.pinned);
  } }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const tagList = tags.split(/[,،]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);
  const extra = { ...(kind ? { kind } : {}), tags: tagList };
  if (!day) return <Sheet open={false} onOpenChange={() => {}} title="">{null}</Sheet>;
  const made = !!f?.folderId;
  const close = (ok: boolean) => { if (ok) onClose(); };
  return (
    <Sheet open={!!date} onOpenChange={(o) => { if (!o) onClose(); }} title={t('folderSheet')}>
      <div className="pb-2">
        <div className="flex justify-end"><Pill tone={f?.skipped ? 'pause' : made ? 'ok' : 'auto'}>{f?.skipped ? t('folderSkipped') : made ? t('folderMade') : t('folderOpensAt')}</Pill></div>
        <Field label={t('folderName')} hint={t('folderNameHint')}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label={t('fDay')}><div className={inputCls}>{DAY_LONG[lang][day.dayOfWeek]} <bdi dir="ltr">{dm(day.date)}</bdi></div></Field>
        {!made && (
          <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('tellEditors')}</span><Switch checked={tell} onChange={setTell} activeColor="bg-[#15803d]" /></div>
        )}
        <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('autoFeed')}</span><Switch checked={autoFeed} onChange={setAutoFeed} activeColor="bg-[#15803d]" /></div>
        <Field label={t('folderKind')}>
          <div className="flex flex-wrap gap-1.5">
            {FOLDER_KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(kind === k ? '' : k)}
                className={cn('min-h-[36px] rounded-xl px-3 text-[13px] font-bold', kind === k ? 'bg-ink-900 text-white' : 'bg-[#F2F3F6] text-ink-500')}>{KIND_LABEL[k]}</button>
            ))}
          </div>
        </Field>
        <Field label={t('folderTags')} hint={t('folderTagsHint')}><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} dir="auto" /></Field>
        {/* The album's pin is the admin's (api/photos/folder-meta). */}
        {made && admin && <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('folderPin')}</span><Switch checked={pinned} onChange={setPinned} activeColor="bg-[#15803d]" /></div>}
        <div className="mt-4 flex gap-2">
          <Btn icon={Check} onClick={async () => {
            const okFolder = await send('/api/social/folders', 'PATCH', { date: day.date, name: name.trim(), autoFeed, ...extra });
            // The pin is the album's (folder-meta), once the Drive folder exists.
            const okPin = made && pinned !== !!(f as unknown as { pinned?: boolean })?.pinned ? await send('/api/photos/folder-meta', 'PATCH', { id: f!.folderId, pinned }) : true;
            close(await run(Promise.resolve(okFolder && okPin)));
          }}>{t('save')}</Btn>
          {made ? <Btn kind="sec" icon={ExternalLink} href={f!.link}>{t('openDrive')}</Btn>
            : !f?.skipped && <Btn kind="sec" icon={Folder} onClick={async () => close(await run(send('/api/social/folders', 'POST', { date: day.date, name: name.trim() || day.folderName, autoFeed, notifyEditors: tell, ...extra })))}>{t('folderOpenNow')}</Btn>}
        </div>
        <div className="mt-3.5 flex justify-center">
          {f?.skipped
            ? <button type="button" className="min-h-[40px] text-[13.5px] font-bold text-brand-600" onClick={async () => close(await run(send('/api/social/folders', 'PATCH', { date: day.date, skipped: false })))}>{t('bringBack')}</button>
            : <button type="button" className="min-h-[40px] text-[13.5px] font-bold text-[#AD3838]" onClick={async () => close(await run(send('/api/social/folders', 'PATCH', { date: day.date, skipped: true })))}>{t('noFolder')}</button>}
        </div>
      </div>
    </Sheet>
  );
}

// ── notifications ───────────────────────────────────────────────────────────────────

const STATE_TONE: Record<TimelineRow['state'], Tone> = { sent: 'ok', off: 'pause', approve: 'warn', skipped: 'pause', scheduled: 'auto' };

function NotificationsCard({ d, m, t, lang, owner, onOpen, onToggle, onApproveAll }: {
  d: WeekSnapshot; m: Meta; t: T; lang: Lang; owner: React.ReactNode; onOpen: (r: TimelineRow | 'new') => void; onToggle: (r: TimelineRow, on: boolean) => void;
  /** Only for who may approve (it failed quietly for everyone else, 10-24). */
  onApproveAll?: () => void;
}) {
  const pending = d.timeline.filter((r) => r.state === 'approve').length;
  return (
    <WeekCard icon={Bell} color={COLORS.notifications} title={t('sec_notifications')} owner={owner} {...m}
      status={pending ? <Pill tone="warn">{t('toApprove', { n: pending })}</Pill> : undefined}
      actions={<>
        {pending > 0 && onApproveAll && <Btn icon={Check} onClick={onApproveAll}>{t('approveAll')}</Btn>}
        <Btn kind="sec" icon={Plus} onClick={() => onOpen('new')}>{t('addNotif')}</Btn>
      </>}>
      <div className="mt-2">
        {d.timeline.map((r) => {
          const off = r.state === 'off';
          const sent = r.state === 'sent';
          return (
            <div key={r.key} className="flex items-center gap-2 border-b border-[#F3F4F6] py-[9px] last:border-0">
              <span className="w-[62px] shrink-0 text-xs font-extrabold text-ink-500">{DAY_SHORT[lang][dowOf(r.date)]} <bdi dir="ltr">{hh(r.hour)}</bdi></span>
              <button type="button" onClick={() => onOpen(r)} className="flex min-w-0 flex-1 flex-col text-start">
                <b className={cn('truncate text-[13.5px] font-bold', off ? 'text-ink-300 line-through' : 'text-ink-900')}>{r.title}</b>
                <span className="flex flex-wrap items-center gap-1 text-[11.5px] text-ink-400">
                  {t(`aud_${audKey(r.audience)}`)} · <Pill tone={STATE_TONE[r.state]}>{t(`st_${r.state}`)}</Pill>
                  {r.changed && !off && <span className="text-brand-600">{t('changedTag')}</span>}
                </span>
              </button>
              {!sent && (
                <button type="button" onClick={() => onOpen(r)} aria-label={t('fTitle')} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#F2F3F6] text-ink-500">
                  <Pencil className="h-[15px] w-[15px]" />
                </button>
              )}
              {!sent && r.stage !== 'custom' && <Switch size="sm" checked={!off} onChange={(on) => onToggle(r, on)} activeColor="bg-[#15803d]" ariaLabel={t('offThisWeek')} />}
            </div>
          );
        })}
      </div>
    </WeekCard>
  );
}

const audKey = (a: string) => (a === 'all' || a === 'noAnswer' || a === 'ranThisWeek' ? a : a === 'group' ? 'group' : 'all');

function NotifSheet({ row, d, t, lang, week, approver, onClose, run }: {
  row: TimelineRow | 'new' | null; d: WeekSnapshot; t: T; lang: Lang; week: string; approver: boolean; onClose: () => void; run: (p: Promise<boolean>) => Promise<boolean>;
}) {
  const isNew = row === 'new';
  const r = row && row !== 'new' ? row : null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hour, setHour] = useState(8);
  const [date, setDate] = useState(week);
  const [as, setAs] = useState<'club' | 'me'>('club');
  const [group, setGroup] = useState('');
  useEffect(() => {
    if (r) { setTitle(r.title); setBody(r.body); setHour(r.hour); setDate(r.date); setGroup(r.group ?? ''); }
    else if (isNew) { setTitle(''); setBody(''); setHour(8); setDate(d.days.find((x) => x.date >= israelToday())?.date ?? week); }
    setAs('club');
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = !!row;
  const story = r?.stage === 'weekStory';
  const auto = !!r && r.stage !== 'custom';
  const past = Date.parse(israelHourToIso(date, hour)) <= Date.now();
  const done = (ok: boolean) => { if (ok) onClose(); };
  const slot = (value: unknown) => send('/api/week-setup/override', 'PUT', { week, key: r!.key, value });
  const value = () => ({
    title: r && title.trim() !== r.defaultTitle ? title : undefined,
    body: r && body.trim() !== r.defaultBody ? body : undefined,
    hour: r && (hour !== r.hour || r.changed) ? hour : undefined,
    // One pace group this week instead of everyone (the tick sends to the override's audience).
    audience: r?.stage === 'dayBefore' && group ? group : undefined,
  });
  const sendNow = () => send('/api/notifications', 'POST', {
    title_he: title.trim(), body_he: body.trim(), schedule_type: 'now', audience_type: 'all', url: '/dashboard', ...(as === 'me' ? { as: 'me' } : {}),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}
      title={isNew ? t('newNotif') : r ? t('notifSheet', { when: `${DAY_SHORT[lang][dowOf(r.date)]} ${hh(r.hour)}` }) : ''}>
      {open && (
        <div className="pb-2">
          {r && <div className="flex items-center justify-between"><Pill tone={STATE_TONE[r.state]}>{t(`st_${r.state}`)}</Pill></div>}
          {auto && <p className="mt-1.5 text-13 leading-normal text-ink-400">{t('autoNote')}</p>}
          {!story && <>
            <Field label={t('fTitle')}><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
            <Field label={t('fBody')}><textarea className={cn(inputCls, 'min-h-[72px] resize-none')} value={body} onChange={(e) => setBody(e.target.value)} maxLength={400} /></Field>
            <div className="flex gap-2">
              <div className="flex-1">
                <Field label={t('fDay')}>
                  {isNew || r?.stage === 'custom' ? (
                    <select className={inputCls} value={date} onChange={(e) => setDate(e.target.value)}>
                      {d.days.map((x) => <option key={x.date} value={x.date}>{DAY_LONG[lang][x.dayOfWeek]} {dm(x.date)}</option>)}
                    </select>
                  ) : <div className={inputCls}>{DAY_LONG[lang][dowOf(date)]} <bdi dir="ltr">{dm(date)}</bdi></div>}
                </Field>
              </div>
              <div className="flex-1">
                <Field label={t('fHour')}>
                  <select className={inputCls} value={hour} onChange={(e) => setHour(Number(e.target.value))} dir="ltr">
                    {Array.from({ length: 18 }, (_, i) => i + 5).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </>}
          {(isNew || auto) && !story && (
            <Field label={t('fSender')} hint={t('senderHint')}>
              <Chips value={as} onChange={setAs} options={[{ value: 'club', label: t('senderClub') }, { value: 'me', label: t('senderMe') }]} />
            </Field>
          )}
          {r && r.stage === 'dayBefore' ? (
            <Field label={t('notifAudience')}>
              <select className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">{t('notifAudienceAll')}</option>
                {d.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          ) : r && <Field label={t('fAudience')}><div className={inputCls}>{t(`aud_${audKey(r.audience)}`)}</div></Field>}
          {past && (isNew || r?.stage === 'custom') && <p className="mt-2 text-[12.5px] font-bold text-[#AD3838]">{t('pastTime')}</p>}

          <div className="mt-4 flex gap-2">
            {isNew && <>
              <Btn icon={Check} disabled={!title.trim() || !body.trim() || past} onClick={async () => done(await run(send('/api/notifications', 'POST', {
                title_he: title.trim(), body_he: body.trim(), schedule_type: 'once_at', scheduled_at: israelHourToIso(date, hour), audience_type: 'all', url: '/dashboard', ...(as === 'me' ? { as: 'me' } : {}),
              })))}>{t('schedule')}</Btn>
              <Btn kind="sec" icon={Send} disabled={!title.trim() || !body.trim()} onClick={async () => done(await run(sendNow()))}>{t('sendNow')}</Btn>
            </>}
            {auto && !story && r.state !== 'sent' && <>
              <Btn icon={Check} onClick={async () => {
                const ok = await slot({ ...value(), off: r.state === 'off' ? true : undefined });
                const approved = r.state === 'approve' && approver ? await send('/api/notifications/approvals', 'POST', { date: addDays(r.date, 1), action: 'approve' }) : true;
                done(await run(Promise.resolve(ok && approved)));
              }}>{r.state === 'approve' && approver ? t('approveSave') : t('save')}</Btn>
              {r.stage === 'dayBefore' && <Btn kind="sec" icon={Send} disabled={!title.trim() || !body.trim()} onClick={async () => {
                // Sent now in its place, so the automatic one stays quiet this week.
                const ok = await sendNow();
                done(await run(Promise.resolve(ok && await slot({ ...value(), off: true }))));
              }}>{t('sendNow')}</Btn>}
            </>}
            {r?.stage === 'custom' && r.state !== 'sent' && (
              <Btn icon={Check} disabled={past || !title.trim()} onClick={async () => done(await run(send('/api/notifications', 'PUT', {
                id: r.id, title_he: title.trim(), body_he: body.trim(), schedule_type: 'once_at', scheduled_at: israelHourToIso(date, hour),
              })))}>{t('save')}</Btn>
            )}
          </div>
          {r && r.state !== 'sent' && (
            <div className="mt-3.5 flex justify-center gap-[18px] text-[13.5px] font-bold">
              {r.stage === 'custom'
                ? <button type="button" className="min-h-[40px] text-[#AD3838]" onClick={async () => done(await run(send('/api/notifications', 'PUT', { id: r.id, status: 'cancelled' })))}>{t('offThisWeek')}</button>
                : r.state === 'off'
                  ? <button type="button" className="min-h-[40px] text-brand-600" onClick={async () => done(await run(slot(value())))}>{t('turnOn')}</button>
                  : <button type="button" className="min-h-[40px] text-ink-500" onClick={async () => done(await run(slot({ ...value(), off: true })))}>{t('offThisWeek')}</button>}
              {r.changed && r.stage !== 'custom' && (
                <button type="button" className="min-h-[40px] text-ink-500" onClick={async () => done(await run(slot(null)))}>{t('resetDefault')}</button>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ── polls ───────────────────────────────────────────────────────────────────────────

function PollsCard({ d, m, t, lang, owner, skip, onOpen }: { d: WeekSnapshot; m: Meta; t: T; lang: Lang; owner: React.ReactNode; skip?: React.ReactNode; onOpen: (p: PlannedPoll | 'new') => void }) {
  // What is in the air this week and how many answered (mockup polls-proposal, 10-20). The
  // fixed weekly pack poll is gone: "מגיעים מחר?" asks attendance; a poll is any other question.
  const open = d.polls.filter((p) => p.open);
  const day = (iso: string) => { const x = israelDateTime(iso); return `${DAY_LONG[lang][x.dow]} ${x.time}`; };
  return (
    <WeekCard icon={BarChart3} color={COLORS.polls} title={t('sec_polls')} owner={owner} {...m}
      status={<Pill tone={open.length ? 'ok' : pendingOf(d.plannedPolls).length ? 'auto' : 'pause'}>
        {open.length ? t('pollsOpenCount', { n: open.length }) : pendingOf(d.plannedPolls).length ? t('pollsScheduledCount', { n: pendingOf(d.plannedPolls).length }) : t('pollsNoneShort')}
      </Pill>}
      actions={<><Btn kind="sec" icon={Plus} onClick={() => onOpen('new')}>{t('newPoll')}</Btn>{skip}</>}>
      {!d.polls.length && !pendingOf(d.plannedPolls).length && <p className="mt-[9px] text-[13.5px] leading-relaxed text-ink-500">{t('pollsNone')}</p>}
      {/* Written here, waiting for their moment (lib/week-setup/planned-polls): a tap edits. */}
      <div className="mt-2">
        {d.plannedPolls.filter((p) => !p.publishedAt || p.error).map((p) => {
          const at = israelDateTime(p.sendAt);
          return (
            <button key={p.id} type="button" disabled={!!p.publishedAt} onClick={() => onOpen(p)} className="flex min-h-[48px] w-full items-center gap-2 border-b border-[#F3F4F6] py-[9px] text-start last:border-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <b dir="auto" className="truncate text-[13.5px] font-bold text-ink-900">{p.question || t('sec_polls')}</b>
                <span className={cn('truncate text-[11.5px]', p.error ? 'font-bold text-[#AD3838]' : 'text-ink-400')}>
                  {p.error ? t('pollFailed', { error: p.error }) : t('pollScheduled', { when: `${DAY_LONG[lang][at.dow]} ${at.time}${p.rides ? ` · ${t('pollRides')}` : ''}` })}
                </span>
              </span>
              {!p.publishedAt && <Pencil className="h-4 w-4 shrink-0 text-ink-400" />}
            </button>
          );
        })}
      </div>
      <div className="mt-0.5">
        {d.polls.map((p) => (
          <Link key={p.id} href={`/dashboard/content/surveys/${p.id}`} className="flex min-h-[48px] items-center gap-2 border-b border-[#F3F4F6] py-[9px] last:border-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <b dir="auto" className="truncate text-[13.5px] font-bold text-ink-900">{p.question}</b>
              <span className="truncate text-[11.5px] text-ink-400">
                <bdi dir="ltr">{p.answered}/{p.asked}</bdi> {t('pollsAnswered')}{p.closesAt ? <> · {p.open ? t('pollCloses', { when: day(p.closesAt) }) : t('pollClosed')}</> : null}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
          </Link>
        ))}
      </div>
    </WeekCard>
  );
}

// ── the watches: the last step ──────────────────────────────────────────────────────

function WatchesCard({ d, m, t, owner, onSent }: { d: WeekSnapshot; m: Meta; t: T; owner: React.ReactNode; onSent: () => void }) {
  // Everything before it that is still open — sending is meant for after (Ofer, 10-24).
  const before = d.readiness.missing.filter((s) => s !== 'watches');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const w = d.watches;
  // The planner's own send, prepared on the server (lib/week-setup/watch-batches) and posted to
  // the same route; `only` + resend: just the runners who didn't get it, their rows updated.
  const sendWeek = async (only?: string[]) => {
    if (!only && before.length && !window.confirm(t('watchesSendAnyway', { list: before.map((s) => t(`miss_${s}`)).join(' · ') }))) return;
    setBusy(true); setErr(null);
    try {
      const prep = await fetch(`/api/week-setup/watches?week=${d.weekStart}${only ? `&only=${only.join(',')}` : ''}`, { headers: await apiHeaders() });
      if (!prep.ok) throw new Error(prep.status === 404 ? t('watchesNoPlan') : t('failed'));
      const { planId, batches } = await prep.json();
      const res = await fetch('/api/garmin/push-workouts', {
        method: 'POST', headers: await apiHeaders(true),
        body: JSON.stringify({ planId, weekStartDate: d.weekStart, batches, wholeWeek: true, notifyAthletes: true, ...(only ? { resend: true } : {}) }),
      }).catch(() => null);
      // A dropped connection is not a failure: the server finishes the send without us.
      if (res && !res.ok) throw new Error(t('failed'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
      onSent();
    }
  };
  return (
    <WeekCard icon={Watch} color={COLORS.watches} title={t('sec_watches')} owner={owner} {...m}
      status={<Pill tone={PLAN_TONE[d.plan.status]}>{w ? t('watchesHave', { ok: w.ok, total: w.total }) : t(`plan_${d.plan.status}`)}</Pill>}
      actions={d.plan.status === 'none' ? undefined : busy ? <Btn icon={Send} disabled>{t('watchesSending')}</Btn>
        : w?.failed.length ? <Btn icon={Send} onClick={() => sendWeek(w.failed.map((f) => f.id))}>{t('watchesResend', { n: w.failed.length })}</Btn>
          : <Btn kind={d.plan.status === 'pushed' ? 'sec' : 'pri'} icon={Send} onClick={() => sendWeek()}>{d.plan.status === 'pushed' ? t('watchesAgain') : t('watchesSend')}</Btn>}>
      <p className="mt-[9px] text-[13.5px] leading-relaxed text-ink-500">{d.plan.status === 'none' ? t('watchesNoPlan') : t('watchesLead')}</p>
      {before.length > 0 && d.plan.status !== 'pushed' && (
        <p className="mt-1.5 text-[12.5px] font-bold text-[#B45309]">{t('watchesWaiting', { list: before.map((s) => t(`miss_${s}`)).join(' · ') })}</p>
      )}
      {w && w.failed.length > 0 && (
        // Who doesn't have it, and why — kept, so tomorrow still shows who is missing (lib/week-setup/watch-results).
        <div className="mt-2.5 rounded-[14px] bg-[#FFF3E0] px-3 py-2.5 text-[12.5px] text-[#8A4A00]">
          <b className="block font-extrabold">{t('watchesMissingTitle', { n: w.failed.length })}</b>
          {w.failed.map((f) => (
            <span key={f.id} className="block truncate"><bdi>{firstName(f.name)}</bdi>{f.error ? <> — <bdi>{f.error}</bdi></> : null}</span>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-[12.5px] font-bold text-[#AD3838]">{err}</p>}
    </WeekCard>
  );
}

// ── what happened this week ─────────────────────────────────────────────────────────

function WeekLog({ entries, t, when, label }: { entries: LogEntry[]; t: T; when: (iso: string) => string; label: (e: LogEntry) => string }) {
  const [all, setAll] = useState(false);
  const list = [...entries].reverse();
  const shown = all ? list : list.slice(0, 4);
  return (
    <section className="mx-4 mb-2.5 mt-2.5 rounded-[22px] bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-ink-500" />
        <b className="flex-1 text-[14.5px] font-extrabold text-ink-900">{t('logTitle')}</b>
        {list.length > 4 && <button type="button" onClick={() => setAll((v) => !v)} className="min-h-[32px] text-[12.5px] font-bold text-brand-600">{all ? t('logLess') : t('logAll', { n: list.length })}</button>}
      </div>
      {!list.length && <p className="mt-1.5 text-[12.5px] text-ink-400">{t('logEmpty')}</p>}
      <ol className="mt-1.5">
        {shown.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex items-baseline gap-2 border-b border-[#F3F4F6] py-[7px] text-[13px] last:border-0">
            <span className="w-[74px] shrink-0 text-[11.5px] font-bold text-ink-400"><bdi dir="ltr">{when(e.at)}</bdi></span>
            <span className="min-w-0 flex-1"><b className="font-extrabold text-ink-900"><bdi>{firstName(e.name)}</bdi></b> · {label(e)}</span>
            <span className="shrink-0 text-[11px] font-bold text-ink-300">{t(`sec_${e.step}`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── owners ──────────────────────────────────────────────────────────────────────────

const ICONS: Record<Section, typeof Bell> = { workouts: ClipboardList, nutrition: Apple, quality: Star, notifications: Bell, polls: BarChart3, message: MessageCircle };

function OwnersSheet({ open, onClose, owners, coachName, adminName, t, onSave }: {
  open: boolean; onClose: () => void; owners: Owners; coachName: string; adminName: string; t: T; onSave: (o: Owners) => void;
}) {
  const [o, setO] = useState(owners);
  useEffect(() => { if (open) setO(owners); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }} title={t('owners')}>
      <div className="pb-2">
        <p className="mb-2 text-13 leading-normal text-ink-400">{t('ownersLead')}</p>
        {SECTIONS.map((s) => {
          const Icon = ICONS[s];
          return (
            <div key={s} className="flex items-center gap-2.5 border-b border-[#F0F1F4] py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${COLORS[s]} 12%, #fff)`, color: COLORS[s] }}><Icon className="h-4 w-4" /></span>
              <b className="flex-1 text-[14.5px] text-ink-900">{t(`sec_${s}`)}</b>
              <div className="flex rounded-[10px] bg-[#EEEFF2] p-0.5">
                {(['coach', 'admin', 'both'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setO({ ...o, [s]: k })}
                    className={cn('min-h-[34px] rounded-lg px-2.5 text-xs font-bold', o[s] === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>
                    {k === 'coach' ? coachName : k === 'admin' ? adminName : t('own_both')}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <button type="button" onClick={() => onSave(o)} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-ink-900 text-[15px] font-bold text-white">{t('save')}</button>
      </div>
    </Sheet>
  );
}
