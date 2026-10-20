'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, ChevronRight, MapPin, MessageCircle, Plus, Send } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';
import { dayHeading, KIND_LABEL, paceToSeconds, type MeetupPerson, type RunMeetup } from '@/lib/runs/meetups';
import { Face, KindChip, MatchChip, PackChip, StaticMap, firstName, packHex } from '@/components/run-together/parts';

// One run (mockup screen 4): where on a map, the host and what they said, who is
// coming in their packs' colours, "אני מצטרף" in one tap, WhatsApp, the calendar,
// and short messages between the people going.

interface Detail {
  meetup: RunMeetup & { status: string; over: boolean };
  messages: Array<{ id: string; body: string; createdAt: string; from: MeetupPerson; mine: boolean }>;
}

const WA_ICON = 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6 0l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z';
function WhatsAppIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden><path d={WA_ICON} /></svg>;
}

function dateLine(m: RunMeetup, today: string) {
  const h = dayHeading(m.date, today);
  return `${h.title} ${h.title === 'היום' || h.title === 'מחר' ? '' : `${h.sub} `}· ${m.startTime}`.replace('  ', ' ');
}

/** An .ics for the phone's calendar — built here, so it needs no signed-in download. */
function downloadIcs(m: RunMeetup) {
  const [y, mo, d] = m.date.split('-');
  const [hh, mm] = m.startTime.split(':');
  const start = `${y}${mo}${d}T${hh}${mm}00`;
  const mins = m.distanceKm && paceToSeconds(m.plannedPace) ? Math.round((m.distanceKm * paceToSeconds(m.plannedPace)!) / 60) + 15 : 75;
  const end = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm + mins));
  const fmt = (dt: Date) => `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}T${String(dt.getUTCHours()).padStart(2, '0')}${String(dt.getUTCMinutes()).padStart(2, '0')}00`;
  const title = `ריצה ${m.kind ? KIND_LABEL[m.kind] : ''} עם ${firstName(m.host.name)}`.replace('  ', ' ');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Madregot//Run together//HE', 'BEGIN:VEVENT',
    `UID:${m.id}@madregot.app`, `DTSTART;TZID=Asia/Jerusalem:${start}`, `DTEND;TZID=Asia/Jerusalem:${fmt(end)}`,
    `SUMMARY:${title}`, `LOCATION:${m.location}`, `URL:https://www.madregot.app/dashboard/run-together/${m.id}`,
    'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url; a.download = `madregot-run-${m.date}.ics`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, mutate } = useApi<Detail>(`/api/runs/meetups/${id}`);
  const { data: board, mutate: mutateBoard } = useApi<{ today: string; viewer: { pace: string | null } | null }>('/api/runs/meetups');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;
  const m = data.meetup;
  const today = board?.today ?? m.date;
  const color = packHex(m.pack);
  const secs = paceToSeconds(m.plannedPace);
  // Distance × pace, as h:mm — 24 km at 4:55 is 1:58.
  const etaMin = m.distanceKm && secs ? Math.round((m.distanceKm * secs) / 60) : null;
  const eta = etaMin != null ? `${Math.floor(etaMin / 60)}:${String(etaMin % 60).padStart(2, '0')}` : null;
  const closed = m.status !== 'open' || m.over;

  const join = async (on: boolean) => {
    setBusy(true);
    try {
      await fetch(on ? '/api/runs/meetups/requests' : `/api/runs/meetups/requests?meetupId=${encodeURIComponent(m.id)}`, {
        method: on ? 'POST' : 'DELETE', headers: await apiHeaders(true), ...(on ? { body: JSON.stringify({ meetupId: m.id }) } : {}),
      });
      await Promise.all([mutate(), mutateBoard()]);
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!window.confirm('לבטל את הריצה? מי שהצטרף יראה שהיא בוטלה.')) return;
    setBusy(true);
    await fetch(`/api/runs/meetups?id=${encodeURIComponent(m.id)}`, { method: 'DELETE', headers: await apiHeaders(true) }).catch(() => {});
    await mutateBoard();
    router.push('/dashboard/run-together');
  };
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    const res = await fetch(`/api/runs/meetups/${m.id}`, { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ body: text.trim() }) }).catch(() => null);
    if (res?.ok) { setText(''); await mutate(); }
    setSending(false);
  };
  const shareText = `${firstName(m.host.name)} יוצא/ת ל${m.kind ? `ריצה ${KIND_LABEL[m.kind]}` : 'ריצה'} ${dateLine(m, today)} · ${m.location}${m.distanceKm ? ` · ${m.distanceKm} ק״מ` : ''}${m.plannedPace ? ` · קצב ${m.plannedPace}` : ''}. מצטרפים? https://www.madregot.app/dashboard/run-together/${m.id}`;
  const canWrite = m.isHost || m.joined;
  // WhatsApp straight to one of the run's people: the server hands back the wa.me link,
  // so a member's number is never in this page's data.
  const waTo = async (toId: string) => {
    const res = await fetch(`/api/runs/meetups/${m.id}/wa?to=${encodeURIComponent(toId)}`, { headers: await apiHeaders() }).catch(() => null);
    const j = res?.ok ? ((await res.json().catch(() => null)) as { url?: string } | null) : null;
    if (j?.url) window.location.href = j.url;
  };

  return (
    <div dir="rtl" className="-mx-4 -mt-4 pb-32">
      <div className="relative h-[230px]">
        {m.lat != null && m.lng != null
          ? <StaticMap lat={m.lat} lng={m.lng} zoom={16} color={color} pinSize={30} className="absolute inset-0" />
          : <div className="absolute inset-0 bg-gradient-to-b from-brand-600/20 to-page" />}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-page" />
        <button type="button" onClick={() => router.push('/dashboard/run-together')} aria-label="חזרה"
          className="absolute start-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-ink-900 shadow-md"><ChevronRight className="h-6 w-6" /></button>
        <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" aria-label="שליחה בוואטסאפ"
          className="absolute end-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-[#128C4A] shadow-md"><WhatsAppIcon className="h-5 w-5" /></a>
      </div>
      <div className="relative -mt-6 px-4">
        <div className="flex flex-wrap gap-1.5"><KindChip m={m} /><PackChip pack={m.pack} small /><MatchChip m={m} myPace={board?.viewer?.pace} /></div>
        <h1 className="mt-2 text-[26px] font-black leading-tight tracking-tight text-ink-900"><bdi>{dateLine(m, today)}</bdi></h1>
        <p className="mt-1 flex items-center gap-1 text-[15px] text-ink-700"><MapPin className="h-4 w-4 shrink-0 text-[#FF5315]" /><b className="font-extrabold"><bdi>{m.location}</bdi></b></p>
        {closed && <p className="mt-2 rounded-xl bg-ink-900/[0.06] px-3 py-2 text-sm font-bold text-ink-500">{m.status === 'cancelled' ? 'הריצה בוטלה' : 'הריצה כבר הייתה'}</p>}

        {(m.distanceKm || m.plannedPace) && (
          <div className="mt-3 flex rounded-2xl bg-card py-2.5">
            {m.distanceKm != null && <Stat label="מרחק" value={`${m.distanceKm} ק״מ`} />}
            {m.plannedPace && <Stat label="קצב" value={m.plannedPace} />}
            {eta && <Stat label="זמן משוער" value={eta} />}
          </div>
        )}

        <div className="mt-2.5 flex gap-3 rounded-2xl bg-card p-3">
          <Face p={m.host} size={44} ring />
          <div className="min-w-0">
            <b className="block text-[15px] font-black text-ink-900"><bdi>{m.host.name}</bdi></b>
            <small className="text-xs font-bold text-ink-400">מארח/ת{m.host.pack ? ` · דבוקה ${m.host.pack}` : ''}</small>
            {m.notes && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-700" dir="auto">{m.notes}</p>}
          </div>
          {m.host.hasWhatsApp && (
            <button type="button" onClick={() => void waTo(m.host.id)} aria-label={`וואטסאפ ל${firstName(m.host.name)}`}
              className="-m-1 ms-auto flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-full text-[#128C4A] active:bg-[#128C4A]/10"><WhatsAppIcon className="h-[22px] w-[22px]" /></button>
          )}
        </div>

        <p className="mb-2 mt-4 px-0.5 text-[13px] font-extrabold text-ink-400">מגיעים · {m.going.length}</p>
        <div className="flex flex-wrap gap-3">
          {m.going.map((p) => (
            <div key={p.id} className="w-[54px] text-center">
              <span className="relative mx-auto block w-fit">
                <Face p={p} size={44} ring />
                {p.hasWhatsApp && (
                  <button type="button" onClick={() => void waTo(p.id)} aria-label={`וואטסאפ ל${firstName(p.name)}`}
                    className="absolute -bottom-3 -end-3 flex h-11 w-11 items-center justify-center">
                    <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#25D366] text-white ring-2 ring-page"><WhatsAppIcon className="h-[13px] w-[13px]" /></span>
                  </button>
                )}
              </span>
              <small className="mt-1.5 block truncate text-[11.5px] font-extrabold text-ink-900"><bdi>{firstName(p.name)}</bdi></small>
            </div>
          ))}
          {!m.joined && !m.isHost && !closed && (
            <button type="button" onClick={() => void join(true)} className="w-[54px] text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-brand-600/40 text-brand-600"><Plus className="h-5 w-5" /></span>
              <small className="mt-1.5 block text-[11.5px] font-extrabold text-brand-600">את/ה?</small>
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
            className="flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-card text-[14px] font-extrabold text-[#0B6E38]"><WhatsAppIcon className="h-[18px] w-[18px]" />וואטסאפ</a>
          <button type="button" onClick={() => downloadIcs(m)} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-card text-[14px] font-extrabold text-brand-600"><CalendarPlus className="h-[18px] w-[18px]" />ליומן</button>
        </div>

        <p className="mb-2 mt-5 flex items-center gap-1.5 px-0.5 text-[13px] font-extrabold text-ink-400"><MessageCircle className="h-4 w-4" />הודעות{data.messages.length ? ` · ${data.messages.length}` : ''}</p>
        <div className="space-y-1.5">
          {data.messages.length === 0 && <p className="rounded-2xl bg-card px-3.5 py-3 text-[13.5px] text-ink-400">{canWrite ? 'כתבו משהו למי שמגיע — איפה בדיוק נפגשים, מים, קצב.' : 'מי שמגיע יכול לכתוב כאן.'}</p>}
          {data.messages.map((x) => (
            <div key={x.id} className={cn('flex items-end gap-2', x.mine && 'flex-row-reverse')}>
              <Face p={x.from} size={28} />
              <p className={cn('max-w-[78%] rounded-2xl px-3 py-2 text-[14px] leading-relaxed', x.mine ? 'rounded-ee-md bg-brand-600 text-white' : 'rounded-es-md bg-card text-ink-900')} dir="auto">
                {!x.mine && <b className="mb-0.5 block text-[11.5px] font-black text-ink-500">{firstName(x.from.name)}</b>}{x.body}
              </p>
            </div>
          ))}
        </div>
        {canWrite && !closed && (
          <div className="mt-2 flex items-end gap-2 rounded-2xl bg-card p-1.5 ps-3.5">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={400} placeholder="הודעה למי שמגיע…" aria-label="הודעה"
              className="min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none" />
            <button type="button" onClick={() => void send()} disabled={sending || !text.trim()} aria-label="שליחה"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40"><Send className="h-[18px] w-[18px]" /></button>
          </div>
        )}
        {m.isHost && !closed && (
          <button type="button" onClick={() => void cancel()} disabled={busy} className="mt-6 min-h-[44px] w-full text-[14px] font-extrabold text-accent-red">ביטול הריצה</button>
        )}
      </div>

      {!m.isHost && !closed && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-40 mx-auto flex max-w-xl items-center justify-between gap-3 border-t border-ink-900/[0.06] bg-card/95 px-4 py-3 backdrop-blur">
          {m.joined ? (
            <>
              <div><b className="block text-[15px] font-black text-accent-900">✓ מגיע/ה</b><small className="text-xs font-bold text-ink-400">{firstName(m.host.name)} יודע/ת</small></div>
              <button type="button" onClick={() => void join(false)} disabled={busy} className="h-11 rounded-xl px-4 text-[14px] font-extrabold text-ink-500">לא אוכל להגיע</button>
            </>
          ) : (
            <>
              <div><b className="block text-[15px] font-black text-ink-900">מצטרפים?</b><small className="text-xs font-bold text-ink-400">התראה תגיע ל{firstName(m.host.name)}</small></div>
              <button type="button" onClick={() => void join(true)} disabled={busy}
                className="h-[50px] rounded-2xl bg-brand-600 px-6 text-base font-black text-white shadow-[0_8px_18px_-8px_rgba(21,37,255,0.7)] disabled:opacity-60">{busy ? '…' : 'אני מצטרף/ת'}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 border-s border-ink-900/[0.06] text-center first:border-s-0">
      <small className="block text-[11.5px] font-bold text-ink-400">{label}</small>
      <b className="text-lg font-black text-ink-900"><bdi>{value}</bdi></b>
    </div>
  );
}
