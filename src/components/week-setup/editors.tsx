'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Send, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sheet, Switch } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { addDays, israelHourToIso, israelParts } from '@/lib/week-setup/model';
import type { PlannedPoll } from '@/lib/week-setup/planned-polls';
import type { WeekSnapshot } from '@/lib/week-setup/server';
import { Btn, DAY_LONG, Field, dm, dowOf, hh, inputCls } from './parts';

/**
 * The Saturday screen's editors (stage 3 of week-setup v2, Ofer 10-24: "editing for the polls,
 * the photos, everything"): a poll written, scheduled and changed in place — out "with the
 * day-before notification", now, or at a day and hour (lib/week-setup/planned-polls) — and the
 * week's message, published or scheduled, without leaving the screen.
 */

type T = ReturnType<typeof useTranslations>;
type Lang = 'he' | 'en';
type Run = (p: Promise<boolean>) => Promise<boolean>;

async function call(url: string, method: string, body: unknown): Promise<boolean> {
  const res = await fetch(url, { method, headers: await apiHeaders(true), body: JSON.stringify(body) }).catch(() => null);
  return !!res?.ok;
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 5);
const MIN30 = 30 * 60_000;

/** The week's days and the Saturday before it (a poll may go out tonight). */
const daysFor = (week: string) => Array.from({ length: 8 }, (_, i) => addDays(week, i - 1));

function DayHour({ lang, days, date, hour, onDate, onHour }: { lang: Lang; days: string[]; date: string; hour: number; onDate: (d: string) => void; onHour: (h: number) => void }) {
  return (
    <div className="flex gap-2">
      <select className={cn(inputCls, 'flex-[1.6]')} value={date} onChange={(e) => onDate(e.target.value)}>
        {days.map((x) => <option key={x} value={x}>{DAY_LONG[lang][dowOf(x)]} {dm(x)}</option>)}
      </select>
      <select className={cn(inputCls, 'flex-1')} value={hour} onChange={(e) => onHour(Number(e.target.value))} dir="ltr">
        {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
      </select>
    </div>
  );
}

export function PollSheet({ open, poll, d, t, lang, onClose, run }: {
  open: boolean; poll: PlannedPoll | null; d: WeekSnapshot; t: T; lang: Lang; onClose: () => void; run: Run;
}) {
  // "With the day-before notification": that notification's own time this week, half an hour before it.
  const rides = useMemo(() => d.timeline.filter((r) => r.stage === 'dayBefore' && r.state !== 'sent' && r.state !== 'off').map((r) => {
    const at = Date.parse(israelHourToIso(r.date, r.hour)) - MIN30;
    return { key: `dayBefore:${r.teamDay}`, teamDay: r.teamDay!, sendAt: new Date(at).toISOString(), label: t('pollWithNotif', { day: DAY_LONG[lang][dowOf(r.date)], hour: hh(r.hour) }), past: at < Date.now() };
  }), [d.timeline, t, lang]);
  const days = daysFor(d.weekStart);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [when, setWhen] = useState<string>('now'); // 'now' | 'at' | dayBefore:N
  const [sendDate, setSendDate] = useState(d.weekStart);
  const [sendHour, setSendHour] = useState(8);
  const [closes, setCloses] = useState<'none' | 'at'>('none');
  const [closeDate, setCloseDate] = useState(d.weekStart);
  const [closeHour, setCloseHour] = useState(d.workoutHour);
  const [group, setGroup] = useState<string>('');
  const [multi, setMulti] = useState(false);
  const [anon, setAnon] = useState(false);
  const [feed, setFeed] = useState(true);
  useEffect(() => {
    if (!open) return;
    if (poll) {
      setQuestion(poll.question); setOptions(poll.options.length >= 2 ? poll.options : [...poll.options, '', ''].slice(0, 2));
      setWhen(poll.rides ?? 'at');
      const s = israelParts(poll.sendAt); setSendDate(s.date); setSendHour(s.hour);
      if (poll.closesAt) { const c = israelParts(poll.closesAt); setCloses('at'); setCloseDate(c.date); setCloseHour(c.hour); } else setCloses('none');
      setGroup(poll.audienceType === 'group' ? poll.audienceId ?? '' : ''); setMulti(poll.multi); setAnon(poll.anonymous); setFeed(poll.feed);
    } else {
      const first = rides.find((r) => !r.past);
      setQuestion(''); setOptions(['', '']); setWhen(first ? first.key : 'now');
      setSendDate(d.weekStart); setSendHour(8);
      // Riding with a team day's notification: it closes when that session starts.
      if (first) { setCloses('at'); setCloseDate(addDays(d.weekStart, first.teamDay)); setCloseHour(d.workoutHour); } else setCloses('none');
      setGroup(''); setMulti(false); setAnon(false); setFeed(true);
    }
  }, [open, poll?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ride = rides.find((r) => r.key === when);
  const sendAt = when === 'now' ? new Date().toISOString() : ride ? ride.sendAt : israelHourToIso(sendDate, sendHour);
  const closesAt = closes === 'at' ? israelHourToIso(closeDate, closeHour) : null;
  const clean = options.map((o) => o.trim()).filter(Boolean);
  const pastSend = when !== 'now' && Date.parse(sendAt) < Date.now();
  const badClose = !!closesAt && Date.parse(closesAt) <= Math.max(Date.parse(sendAt), Date.now()) + 5 * 60_000;
  const ok = !!question.trim() && clean.length >= 2 && !pastSend && !badClose;
  // Now: only the closing time has to be ahead of this moment.
  const okNow = !!question.trim() && clean.length >= 2 && !(closesAt && Date.parse(closesAt) <= Date.now() + 5 * 60_000);
  const body = (now: boolean) => ({
    week: d.weekStart, now,
    poll: {
      ...(poll ? { id: poll.id } : {}), question, options: clean, closesAt, multi, anonymous: anon, feed,
      audienceType: group ? 'group' : 'all', audienceId: group || null, sendAt, ...(ride ? { rides: ride.key } : {}),
    },
  });
  const done = (x: boolean) => { if (x) onClose(); };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={poll ? t('pollEdit') : t('pollNew')}>
      {open && (
        <div className="pb-2">
          <Field label={t('pollQuestion')}><textarea className={cn(inputCls, 'min-h-[64px] resize-none')} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} dir="auto" /></Field>
          <Field label={t('pollOptions')}>
            <div className="space-y-1.5">
              {options.map((o, i) => (
                <div key={i} className="flex gap-1.5">
                  <input className={inputCls} value={o} onChange={(e) => setOptions((v) => v.map((x, k) => (k === i ? e.target.value : x)))} maxLength={80} dir="auto" />
                  {options.length > 2 && (
                    <button type="button" aria-label="✕" onClick={() => setOptions((v) => v.filter((_, k) => k !== i))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#F2F3F6] text-ink-500"><X className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
              {options.length < 8 && <button type="button" onClick={() => setOptions((v) => [...v, ''])} className="min-h-[40px] text-[13.5px] font-bold text-brand-600">{t('pollAddOption')}</button>}
            </div>
          </Field>
          <Field label={t('pollWhen')}>
            <select className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)}>
              {rides.map((r) => <option key={r.key} value={r.key} disabled={r.past}>{r.label}</option>)}
              <option value="now">{t('pollNow')}</option>
              <option value="at">{t('pollAt')}</option>
            </select>
          </Field>
          {when === 'at' && <div className="mt-1.5"><DayHour lang={lang} days={days} date={sendDate} hour={sendHour} onDate={setSendDate} onHour={setSendHour} /></div>}
          <Field label={t('pollCloses')}>
            <select className={inputCls} value={closes} onChange={(e) => setCloses(e.target.value as 'none' | 'at')}>
              <option value="none">{t('pollOpenEnded')}</option>
              <option value="at">{t('pollAt')}</option>
            </select>
          </Field>
          {closes === 'at' && <div className="mt-1.5"><DayHour lang={lang} days={days.slice(1)} date={closeDate} hour={closeHour} onDate={setCloseDate} onHour={setCloseHour} /></div>}
          <Field label={t('pollAudience')}>
            <select className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">{t('pollAll')}</option>
              {d.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('pollMulti')}</span><Switch checked={multi} onChange={setMulti} activeColor="bg-[#15803d]" /></div>
          <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('pollAnon')}</span><Switch checked={anon} onChange={setAnon} activeColor="bg-[#15803d]" /></div>
          <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('pollFeed')}</span><Switch checked={feed} onChange={setFeed} activeColor="bg-[#15803d]" /></div>
          {(pastSend || badClose) && <p className="mt-2 text-[12.5px] font-bold text-[#AD3838]">{t('pastTime')}</p>}
          <div className="mt-4 flex gap-2">
            {when !== 'now' && <Btn icon={Check} disabled={!ok} onClick={async () => done(await run(call('/api/week-setup/polls', 'POST', body(false))))}>{t('pollSchedule')}</Btn>}
            <Btn kind={when === 'now' ? 'pri' : 'sec'} icon={Send} disabled={!okNow}
              onClick={async () => done(await run(call('/api/week-setup/polls', 'POST', body(true))))}>{t('pollSendNow')}</Btn>
          </div>
          {poll && (
            <div className="mt-3.5 flex justify-center">
              <button type="button" className="flex min-h-[40px] items-center gap-1.5 text-[13.5px] font-bold text-[#AD3838]"
                onClick={async () => done(await run(call('/api/week-setup/polls', 'DELETE', { week: d.weekStart, id: poll.id })))}><Trash2 className="h-4 w-4" />{t('pollDelete')}</button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function MessageSheet({ open, d, t, lang, onClose, run }: { open: boolean; d: WeekSnapshot; t: T; lang: Lang; onClose: () => void; run: Run }) {
  const [text, setText] = useState('');
  const [later, setLater] = useState(false);
  const [date, setDate] = useState(d.weekStart);
  const [hour, setHour] = useState(8);
  const [push, setPush] = useState(true);
  const [group, setGroup] = useState('');
  useEffect(() => { if (open) { setText(''); setLater(false); setDate(d.weekStart); setHour(8); setPush(true); setGroup(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = later ? israelHourToIso(date, hour) : null;
  const past = !!at && Date.parse(at) < Date.now() + 60_000;
  // A scheduled message is a scheduled push (api/admin/publish/message): later needs the push.
  const ok = !!text.trim() && !past && (!later || push);
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={t('msgTitle')}>
      {open && (
        <div className="pb-2">
          <Field label={t('msgText')}><textarea className={cn(inputCls, 'min-h-[110px] resize-none')} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} dir="auto" /></Field>
          <Field label={t('msgWhen')}>
            <select className={inputCls} value={later ? 'at' : 'now'} onChange={(e) => setLater(e.target.value === 'at')}>
              <option value="now">{t('pollNow')}</option>
              <option value="at">{t('pollAt')}</option>
            </select>
          </Field>
          {later && <div className="mt-1.5"><DayHour lang={lang} days={daysFor(d.weekStart)} date={date} hour={hour} onDate={setDate} onHour={setHour} /></div>}
          <Field label={t('pollAudience')}>
            <select className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">{t('pollAll')}</option>
              {d.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <div className="mt-3 flex items-center justify-between text-sm font-semibold text-ink-900"><span>{t('msgPush')}</span><Switch checked={push} onChange={setPush} activeColor="bg-[#15803d]" /></div>
          {past && <p className="mt-2 text-[12.5px] font-bold text-[#AD3838]">{t('pastTime')}</p>}
          <div className="mt-4 flex gap-2">
            <Btn icon={later ? Check : Send} disabled={!ok} onClick={async () => {
              const sent = await run(call('/api/admin/publish/message', 'POST', {
                text: text.trim(), push, scheduleAt: later ? at : null,
                audience: group ? { mode: 'groups', groupIds: [group] } : { mode: 'all' },
              }));
              if (sent) onClose();
            }}>{later ? t('msgSchedule') : t('msgPublish')}</Btn>
          </div>
        </div>
      )}
    </Sheet>
  );
}
