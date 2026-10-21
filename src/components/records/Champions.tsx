'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiHeaders, useApi } from '@/lib/api';
import { FeedAvatar } from '@/components/FeedAvatar';
import { AthleteLink } from '@/components/AthleteLink';
import { Sheet, SkeletonList } from '@/components/ui';
import {
  CHAMP_DISTANCES, DISTANCE_LABEL, DISTANCE_LONG, TOP, fmtRaceTime, parseRaceTime, placeOf, relevantSuggestions,
  type Board, type ChampDistance, type ChampScope, type ChampSex, type Ranked, type ResultRow,
} from '@/lib/champions/table';
import { cn } from '@/lib/utils';
import { personMatches } from '@/lib/search/match';
import { hintActivityAthlete } from '@/lib/activity/open-hint';

// אלופי המדרגות (mockup ~/.cache/madregot/champions, Ofer 10-20): official race times
// per distance, a podium with the faces, the pack (1, 2, 3 — not א ב ג), top 10, and the
// reader's own place. Men / women / together; this year / all time. Staff add results
// from the "ניהול" sheet — a watch's race-day run is only a suggestion.

const PACK = ['#FFD600', '#5BC0EB', '#F7797D', '#8E7CFF', '#86efac'];
const packColor = (n: number | null) => (n ? PACK[(n - 1) % PACK.length] : '#e5e7eb');
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}`;

function Pack({ n }: { n: number | null }) {
  if (!n) return null;
  return <span className="inline-block rounded-full px-1.5 text-[10.5px] font-extrabold text-ink-900" style={{ background: packColor(n) }}>דבוקה {n}</span>;
}

export function Champions() {
  const { data, mutate } = useApi<{ ready: boolean; boards: Record<string, Board>; canManage: boolean; pending?: number }>('/api/club/champions');
  const [distance, setDistance] = useState<ChampDistance>('half');
  const [sex, setSex] = useState<ChampSex>('men');
  const [scope, setScope] = useState<ChampScope>('all');
  const [managing, setManaging] = useState(false);
  if (!data) return <SkeletonList count={5} />;
  const b = data.boards[`${distance}:${sex}:${scope}`] ?? { top: [], me: null };
  const [first, second, third] = b.top;
  const rest = b.top.slice(3);
  const meOutside = b.me && !b.top.some((r) => r.athleteId === b.me!.athleteId) ? b.me : null;

  return (
    <div dir="rtl">
      <section className="overflow-hidden rounded-[22px] bg-gradient-to-b from-[#1525FF] to-[#0a1080] px-3.5 pt-3.5 text-white">
        <div className="flex items-start justify-between gap-2">
          <span>
            <h2 className="text-[22px] font-black">🏆 אלופי המדרגות</h2>
            <p className="text-[12.5px] opacity-80">הזמנים הרשמיים הכי טובים במועדון, ממרוצים</p>
          </span>
          {data.canManage && (
            <button type="button" onClick={() => setManaging(true)} className="relative min-h-[34px] shrink-0 rounded-full bg-white/15 px-3 text-[12.5px] font-bold">
              ניהול
              {!!data.pending && <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#FF3B30] px-1 text-[11px] font-extrabold" aria-label={`${data.pending} מחכים לאישור`}>{data.pending}</span>}
            </button>
          )}
        </div>
        <div className="mt-3 flex gap-1 rounded-[12px] bg-white/15 p-[3px]" role="tablist">
          {CHAMP_DISTANCES.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={distance === d} onClick={() => setDistance(d)}
              className={cn('min-h-[34px] flex-1 rounded-[9px] text-[13px] font-extrabold', distance === d ? 'bg-white text-[#1525FF]' : 'opacity-85')}>{DISTANCE_LABEL[d]}</button>
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {([['men', 'גברים'], ['women', 'נשים'], ['all', 'כולם']] as Array<[ChampSex, string]>).map(([s, l]) => (
              <button key={s} type="button" aria-pressed={sex === s} onClick={() => setSex(s)}
                className={cn('min-h-[30px] rounded-full px-3 text-[12px] font-extrabold', sex === s ? 'bg-[#FFD600] text-ink-900' : 'bg-white/15')}>{l}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {([['all', 'כל הזמנים'], ['year', 'השנה']] as Array<[ChampScope, string]>).map(([s, l]) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                className={cn('min-h-[30px] rounded-full px-2.5 text-[12px] font-bold', scope === s ? 'bg-white text-[#1525FF]' : 'opacity-80')}>{l}</button>
            ))}
          </div>
        </div>
        {!data.ready ? (
          <p className="py-8 text-center text-[13px] opacity-85">מחכה למיגרציה 163</p>
        ) : !first ? (
          <p className="py-8 text-center text-[13px] opacity-85">עוד אין תוצאות רשמיות כאן</p>
        ) : (
          <div className="mt-3 flex items-end justify-center gap-2">
            <Step r={second} medal="🥈" size={60} ring="#C0C0C0" h={58} bg="bg-white/20" />
            <Step r={first} medal="🥇" size={76} ring="#FFD600" h={86} bg="bg-[#FFD600]/35" />
            <Step r={third} medal="🥉" size={54} ring="#CD7F32" h={40} bg="bg-[#CD7F32]/35" />
          </div>
        )}
      </section>

      {(rest.length > 0 || meOutside) && (
        <div className="mt-2.5 overflow-hidden rounded-[18px] bg-card">
          {rest.map((r) => <Row key={r.athleteId} r={r} me={r.athleteId === b.me?.athleteId} />)}
          {meOutside && <Row r={meOutside} me />}
        </div>
      )}

      {data.canManage && <ManageSheet open={managing} onOpenChange={setManaging} onChanged={() => void mutate()} />}
    </div>
  );
}

function Step({ r, medal, size, ring, h, bg }: { r?: Ranked; medal: string; size: number; ring: string; h: number; bg: string }) {
  if (!r) return <div className="flex-1" />;
  return (
    <AthleteLink athleteId={r.athleteId} name={r.name} className="flex flex-1 flex-col items-center text-center">
      <span className="relative block rounded-full p-[3px]" style={{ background: ring }}>
        <span className="block overflow-hidden rounded-full border-2 border-white bg-white" style={{ width: size, height: size, fontSize: size / 3 }}>
          <FeedAvatar name={r.name} url={r.avatarUrl} className="h-full w-full" />
        </span>
        <span aria-hidden className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[20px]">{medal}</span>
      </span>
      <b dir="auto" className="mt-3 block max-w-full truncate text-[13.5px]">{r.name.split(/\s+/).slice(0, 2).join(' ')}</b>
      <span dir="ltr" className="block text-[15px] font-black tabular-nums">{fmtRaceTime(r.seconds)}</span>
      <Pack n={r.pack} />
      <span className={cn('mt-2 grid w-full place-items-center rounded-t-[12px] text-[24px] font-black text-white/90', bg)} style={{ height: h }}>{r.rank}</span>
    </AthleteLink>
  );
}

function Row({ r, me }: { r: Ranked; me?: boolean }) {
  return (
    <AthleteLink athleteId={r.athleteId} name={r.name}
      className={cn('flex min-h-[56px] items-center gap-2.5 border-b-[0.5px] border-black/[0.08] px-3 py-2 last:border-b-0', me && 'bg-[#EEF1FF]')}>
      <span className="w-6 text-center text-[14px] font-black text-ink-400 tabular-nums">{r.rank}</span>
      <FeedAvatar name={r.name} url={r.avatarUrl} className="h-9 w-9 text-[13px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold text-ink-900" dir="auto">
          {r.name}{r.isNew && <span className="ms-1 rounded-full bg-[#DCFCE7] px-1.5 text-[11px] font-extrabold text-[#15803d]">חדש</span>}
        </span>
        <span className="block truncate text-[11.5px] text-ink-400"><Pack n={r.pack} /> {r.raceName ? `${r.raceName} · ` : ''}{dm(r.raceDate)}</span>
      </span>
      <span dir="ltr" className="text-[14.5px] font-black tabular-nums text-ink-900">{fmtRaceTime(r.seconds)}</span>
    </AthleteLink>
  );
}

interface Suggestion { activityId: string; athleteId: string; name: string; avatarUrl: string | null; gender?: string | null; location?: string | null; distance: ChampDistance; watchSeconds: number; raceName: string | null; raceDate: string }
interface Athlete { id: string; name: string | null; status?: string | null }

/** Staff: confirm race-day runs with the official time, add one by hand, take one off. */
function ManageSheet({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const { data, mutate } = useApi<{ ready: boolean; results: ResultRow[]; suggestions: Suggestion[] }>(open ? '/api/admin/champions' : null);
  const { data: roster } = useApi<{ athletes: Athlete[] }>(open ? '/api/athletes' : null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ athleteId: '', q: '', distance: 'half' as ChampDistance, time: '', raceName: '', raceDate: '' });

  const call = async (method: string, body?: unknown, q = '') => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/champions${q}`, { method, headers: await apiHeaders(true), body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error === 'migration 163' ? 'צריך קודם את מיגרציה 163' : 'לא נשמר');
      if (method === 'POST') setMsg(json.place && json.place <= 10 ? `נכנס למקום ${json.place}${json.posted ? ' · עלה לפיד' : ''}` : 'נשמר');
      await mutate(); onChanged();
      return true;
    } catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(false); }
  };
  const add = (s: { athleteId: string; distance: ChampDistance; seconds: number | null; raceName: string | null; raceDate: string; activityId?: string }) => {
    if (!s.seconds) { setMsg('זמן לא תקין (למשל 1:15:22)'); return Promise.resolve(false); }
    return call('POST', s);
  };
  const matches = form.q.trim() ? (roster?.athletes || []).filter((a) => a.status !== 'removed' && personMatches(a.name, form.q)).slice(0, 5) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="אלופי המדרגות · ניהול">
      <div className="space-y-3 px-4 pb-8" dir="rtl">
        {msg && <p role="status" className="rounded-xl bg-page px-3 py-2 text-13 font-bold text-ink-700">{msg}</p>}
        {data && !data.ready && <p className="text-13 text-accent-red-ink">מיגרציה 163 עוד לא הודבקה.</p>}

        {(data?.suggestions.length ?? 0) > 0 && (
          <Waiting
            suggestions={data!.suggestions}
            results={data!.results}
            busy={busy}
            onApprove={(list) => call('POST', list.length === 1 ? { ...list[0] } : { bulk: list }).then((ok) => {
              if (ok && list.length > 1) setMsg(`✓ אושרו ${list.length} · ${DISTANCE_LONG[list[0].distance]} בטבלה`);
              return ok;
            })}
            onReject={(s) => void call('POST', { bulk: [{ ...s, seconds: s.watchSeconds, rejected: true }] }).then((ok) => ok && setMsg('לא נכנס לטבלה'))}
          />
        )}

        <div className="rounded-[16px] bg-page p-3">
          <b className="block text-[15px] text-ink-900">הוספת תוצאה רשמית</b>
          <input value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value, athleteId: '' })} placeholder="מי" aria-label="מי"
            className="mt-2 min-h-[44px] w-full rounded-xl bg-white px-3 text-base" />
          {!form.athleteId && matches.map((a) => (
            <button key={a.id} type="button" onClick={() => setForm({ ...form, athleteId: a.id, q: a.name || '' })} className="block min-h-[40px] w-full px-2 text-start text-[15px]">+ {a.name}</button>
          ))}
          <div className="mt-2 flex gap-1">
            {CHAMP_DISTANCES.map((d) => (
              <button key={d} type="button" aria-pressed={form.distance === d} onClick={() => setForm({ ...form, distance: d })}
                className={cn('min-h-[36px] flex-1 rounded-full text-13 font-bold', form.distance === d ? 'bg-ink-900 text-white' : 'bg-white text-ink-600')}>{DISTANCE_LABEL[d]}</button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="זמן רשמי 1:15:22" dir="ltr" inputMode="numeric" aria-label="זמן רשמי" className="min-h-[44px] rounded-xl bg-white px-3 text-base" />
            <input type="date" value={form.raceDate} onChange={(e) => setForm({ ...form, raceDate: e.target.value })} dir="ltr" aria-label="תאריך" className="min-h-[44px] rounded-xl bg-white px-3 text-base" />
          </div>
          <input value={form.raceName} onChange={(e) => setForm({ ...form, raceName: e.target.value })} placeholder="איזה מרוץ" aria-label="מרוץ" className="mt-2 min-h-[44px] w-full rounded-xl bg-white px-3 text-base" />
          <button type="button" disabled={busy || !form.athleteId || !form.raceDate}
            onClick={async () => { if (await add({ athleteId: form.athleteId, distance: form.distance, seconds: parseRaceTime(form.time), raceName: form.raceName, raceDate: form.raceDate })) setForm({ ...form, athleteId: '', q: '', time: '', raceName: '' }); }}
            className="mt-2 min-h-[46px] w-full rounded-xl bg-[#1525FF] text-[15px] font-extrabold text-white disabled:opacity-50">להוסיף לטבלה</button>
        </div>

        {(data?.results.length ?? 0) > 0 && (
          <div>
            <b className="block px-1 text-13 text-ink-400">בטבלה</b>
            {data!.results.slice(0, 200).map((r) => (
              <ResultEdit key={r.id} r={r} busy={busy}
                onSave={(patch) => call('PATCH', { id: r.id, ...patch })}
                onCancel={() => call('DELETE', undefined, `?id=${r.id}`)} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** One result in the table: the line, and ✏️ opens the admin's edit — time, distance, race, date — or cancel. */
function ResultEdit({ r, busy, onSave, onCancel }: { r: ResultRow; busy: boolean; onSave: (p: Record<string, unknown>) => Promise<boolean>; onCancel: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ time: fmtRaceTime(r.seconds), distance: r.distance, raceName: r.raceName || '', raceDate: r.raceDate });
  return (
    <div className="border-b border-page">
      <div className="flex min-h-[48px] items-center gap-2 px-1 text-[14px]">
        <span className="min-w-0 flex-1 truncate" dir="auto">{r.name} · {DISTANCE_LABEL[r.distance]} · {r.raceName || ''} {dm(r.raceDate)}</span>
        <span dir="ltr" className="font-bold tabular-nums">{fmtRaceTime(r.seconds)}</span>
        <button type="button" onClick={() => setOpen(!open)} aria-label="עריכה" className="min-h-[40px] px-2 text-13 font-bold text-[#1525FF]">{open ? 'סגירה' : '✏️ עריכה'}</button>
      </div>
      {open && (
        <div className="space-y-2 rounded-[14px] bg-page p-2.5">
          <div className="flex gap-1">
            {CHAMP_DISTANCES.map((d) => (
              <button key={d} type="button" aria-pressed={f.distance === d} onClick={() => setF({ ...f, distance: d })}
                className={cn('min-h-[34px] flex-1 rounded-full text-13 font-bold', f.distance === d ? 'bg-ink-900 text-white' : 'bg-white text-ink-600')}>{DISTANCE_LABEL[d]}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} dir="ltr" inputMode="numeric" aria-label="זמן רשמי" className="min-h-[42px] rounded-xl bg-white px-3 text-base" />
            <input type="date" value={f.raceDate} onChange={(e) => setF({ ...f, raceDate: e.target.value })} dir="ltr" aria-label="תאריך" className="min-h-[42px] rounded-xl bg-white px-3 text-base" />
          </div>
          <input value={f.raceName} onChange={(e) => setF({ ...f, raceName: e.target.value })} placeholder="מרוץ" aria-label="מרוץ" className="min-h-[42px] w-full rounded-xl bg-white px-3 text-base" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !parseRaceTime(f.time)}
              onClick={async () => { if (await onSave({ seconds: parseRaceTime(f.time), distance: f.distance, raceName: f.raceName, raceDate: f.raceDate })) setOpen(false); }}
              className="min-h-[42px] flex-1 rounded-xl bg-[#1525FF] text-[14px] font-extrabold text-white disabled:opacity-50">שמירה</button>
            <button type="button" disabled={busy} onClick={() => void onCancel()} className="min-h-[42px] flex-1 rounded-xl bg-white text-[14px] font-extrabold text-accent-red-ink">לבטל את התוצאה</button>
          </div>
        </div>
      )}
    </div>
  );
}

const israelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const isWomanG = (g?: string | null) => /^(f|female|woman|נקבה|אישה)$/i.test((g || '').trim());
const dmShort = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
type Approval = Suggestion & { seconds: number };

/**
 * The race-day runs waiting for approval (mockup ~/.cache/madregot/champions-approval.html,
 * Ofer 10-21): a tab per distance, the podium as it will stand, and each run with the
 * place it takes, where it was (race · date · place) and a link to the run itself. The
 * official time is typed over the watch's and the places move at once; a run that falls
 * out of the top 10 drops under the line. "Approve all" is the open distance only.
 */
function Waiting({ suggestions, results, busy, onApprove, onReject }: {
  suggestions: Suggestion[]; results: ResultRow[]; busy: boolean;
  onApprove: (list: Approval[]) => Promise<boolean>; onReject: (s: Suggestion) => void;
}) {
  const counts = new Map<ChampDistance, number>();
  for (const s of suggestions) counts.set(s.distance, (counts.get(s.distance) ?? 0) + 1);
  const [dist, setDist] = useState<ChampDistance>(counts.has('half') ? 'half' : (CHAMP_DISTANCES.find((d) => counts.has(d)) ?? 'half'));
  const open = counts.has(dist) ? dist : (CHAMP_DISTANCES.find((d) => counts.has(d)) ?? dist);
  // What is being typed, and the official times once typed (on Enter or leaving the box —
  // so a half-typed time does not throw the row around).
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [fixed, setFixed] = useState<Record<string, number>>({});
  const today = israelToday();

  const secondsOf = (s: Suggestion) => fixed[s.activityId] ?? s.watchSeconds;
  const commit = (s: Suggestion) => {
    const sec = parseRaceTime(typed[s.activityId] ?? '');
    if (sec) setFixed((f) => ({ ...f, [s.activityId]: sec }));
    setTyped((t) => { const n = { ...t }; delete n[s.activityId]; return n; });
  };
  const here = suggestions.filter((s) => s.distance === open);
  const asRow = (s: Suggestion): ResultRow => ({
    id: `w:${s.activityId}`, athleteId: s.athleteId, name: s.name, avatarUrl: s.avatarUrl, gender: s.gender ?? null,
    pack: null, distance: s.distance, seconds: secondsOf(s), raceName: s.raceName, raceDate: s.raceDate,
  });
  const waitingRows = here.map(asRow);
  const pool = [...results, ...waitingRows];
  // Still worth a place with the times as typed (the same rule as the server's list).
  const keep = new Set(relevantSuggestions(results, here.map((s) => ({ ...s, watchSeconds: secondsOf(s) })), today).map((s) => s.activityId));
  const ranked = here
    .map((s) => ({ s, seconds: secondsOf(s), place: placeOf(pool, asRow(s), today) ?? 99, inTop: keep.has(s.activityId) }))
    .sort((a, b) => a.seconds - b.seconds);
  const inTop = ranked.filter((r) => r.inTop);
  const out = ranked.filter((r) => !r.inTop);
  const podium = inTop.filter((r) => r.place <= 3).sort((a, b) => a.place - b.place);
  const race = here[0]?.raceName;

  const row = ({ s, seconds, place, inTop: on }: (typeof ranked)[number]) => {
    const edited = seconds !== s.watchSeconds;
    const where = [s.raceName || 'מרוץ', dmShort(s.raceDate), s.location].filter(Boolean).join(' · ');
    const run = `/dashboard/activities/${s.activityId}`;
    const hint = () => hintActivityAthlete(s.activityId, s.athleteId);
    return (
      <div key={s.activityId} className={cn('border-t-[0.5px] border-black/[0.08] px-2.5 py-2 first:border-t-0', !on && 'opacity-55', edited && 'bg-[#EEF0FF]')}>
        <div className="flex items-center gap-2">
          <span className={cn('w-6 shrink-0 text-center text-[15px] font-black tabular-nums', place === 1 ? 'text-[#C8961E]' : place === 2 ? 'text-[#8A93A3]' : place === 3 ? 'text-[#B4652A]' : 'text-ink-400')}>
            {on && place <= TOP ? place : '—'}
          </span>
          <Link href={run} onClick={hint} className="flex min-w-0 flex-1 items-center gap-2">
            <FeedAvatar name={s.name} url={s.avatarUrl} className="h-9 w-9 shrink-0 text-[13px]" />
            <span className="min-w-0">
              <b dir="auto" className="block text-[14.5px] leading-tight text-ink-900">{s.name}</b>
              {edited
                ? <span className="block text-[11.5px] font-bold text-[#1525FF]">בשעון <bdi dir="ltr">{fmtRaceTime(s.watchSeconds)}</bdi></span>
                : isWomanG(s.gender) && <span className="text-[11px] font-bold text-[#9D174D]">נשים</span>}
            </span>
          </Link>
          <input
            value={typed[s.activityId] ?? fmtRaceTime(seconds)}
            onChange={(e) => setTyped((t) => ({ ...t, [s.activityId]: e.target.value }))}
            onBlur={() => commit(s)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            dir="ltr" inputMode="numeric" aria-label={`זמן רשמי · ${s.name}`}
            className={cn('h-[36px] w-[76px] shrink-0 rounded-[10px] text-center text-[15px] font-extrabold tabular-nums', edited ? 'bg-white text-[#1525FF]' : 'bg-page text-ink-900')}
          />
          <button type="button" disabled={busy} aria-label={`לאשר · ${s.name}`} onClick={() => void onApprove([{ ...s, seconds }])}
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#15803d] text-[16px] font-black text-white disabled:opacity-50">✓</button>
          <button type="button" disabled={busy} aria-label={`לא · ${s.name}`} onClick={() => onReject(s)}
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-page text-[15px] font-black text-ink-500 disabled:opacity-50">✕</button>
        </div>
        {/* Where it was, and the run itself (Ofer 10-21: "race, date, location — and a link to the run"). */}
        <Link href={run} onClick={hint} className="ms-[76px] mt-0.5 flex min-h-[26px] items-center gap-1 text-[12px] text-ink-500">
          <span aria-hidden>📍</span>
          <span dir="auto" className="min-w-0 truncate">{where}</span>
          <span className="ms-auto shrink-0 font-bold text-[#1525FF]">לריצה ‹</span>
        </Link>
      </div>
    );
  };

  return (
    <div>
      <section className="overflow-hidden rounded-[24px] px-3.5 pt-3.5 text-white" style={{ background: 'radial-gradient(120% 90% at 85% 0%, #5B3FC4 0%, #23208F 55%, #151364 100%)' }}>
        <p className="text-[12px] font-bold opacity-75">מחכים לאישור · מהשעון, ביום מרוץ</p>
        <p dir="auto" className="mt-0.5 text-[19px] font-black leading-tight">{DISTANCE_LONG[open]}{race ? ` · ${race}` : ''}</p>
        <div className="mt-3 flex gap-1 rounded-full bg-white/[0.12] p-[3px]" role="tablist">
          {CHAMP_DISTANCES.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={open === d} disabled={!counts.has(d)} onClick={() => setDist(d)}
              className={cn('min-h-[34px] flex-1 rounded-full text-[13px] font-bold disabled:opacity-35', open === d ? 'bg-white text-[#23208F]' : 'text-white/75')}>
              {DISTANCE_LABEL[d]}<span className="ms-1 text-[11px] opacity-70">{counts.get(d) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-end justify-center gap-2.5">
          {[podium[1], podium[0], podium[2]].map((r, i) => r ? (
            <div key={r.s.activityId} className="flex w-[96px] flex-col items-center text-center">
              <span className="block overflow-hidden rounded-full border-[3px]" style={{ borderColor: ['#E6E9EF', '#F7D774', '#F3C3A0'][i], width: i === 1 ? 66 : 54, height: i === 1 ? 66 : 54 }}>
                <FeedAvatar name={r.s.name} url={r.s.avatarUrl} className="h-full w-full text-[18px]" />
              </span>
              <b dir="auto" className="mt-1.5 block max-w-full truncate text-[12.5px]">{r.s.name}</b>
              <span dir="ltr" className="block text-[12px] tabular-nums opacity-80">{fmtRaceTime(r.seconds)}</span>
              <span className="mt-1.5 grid w-full place-items-center rounded-t-[12px] text-[20px] font-black"
                style={{ height: [46, 64, 34][i], color: ['#8A93A3', '#C8961E', '#B4652A'][i], background: `linear-gradient(180deg, ${['#E6E9EF', '#F7D774', '#F3C3A0'][i]}, rgba(255,255,255,.85))` }}>{r.place}</span>
            </div>
          ) : <div key={i} className="w-[96px]" />)}
        </div>
      </section>

      <div className="mx-1 mb-1.5 mt-3 flex items-baseline justify-between">
        <b className="text-13 text-ink-500">{inTop.length} נכנסים לטבלה</b>
        <span className="text-[12px] text-ink-400">זמן מהשעון — לתקן לרשמי</span>
      </div>
      <div className="overflow-hidden rounded-[20px] bg-card">
        {inTop.map(row)}
        {out.length > 0 && <p className="bg-[#fff5f5] px-3 py-2 text-[11.5px] font-extrabold text-accent-red-ink">מחוץ לטופ 10 — לא ייכנסו</p>}
        {out.map(row)}
      </div>
      {inTop.length > 1 && (
        <div className="sticky bottom-2 z-10 mt-3">
          <button type="button" disabled={busy}
            onClick={() => void onApprove(inTop.map((r) => ({ ...r.s, seconds: r.seconds }))).then((ok) => ok && setFixed({}))}
            className="min-h-[52px] w-full rounded-full text-[16px] font-black text-white shadow-[0_10px_24px_rgba(35,32,143,0.35)] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #23208F, #5B3FC4)' }}>
            לאשר את כל {inTop.length} · {DISTANCE_LABEL[open]}
          </button>
        </div>
      )}
    </div>
  );
}
