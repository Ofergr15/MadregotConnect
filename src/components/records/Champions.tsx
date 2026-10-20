'use client';

import { useState } from 'react';
import { apiHeaders, useApi } from '@/lib/api';
import { FeedAvatar } from '@/components/FeedAvatar';
import { AthleteLink } from '@/components/AthleteLink';
import { Sheet, SkeletonList } from '@/components/ui';
import {
  CHAMP_DISTANCES, DISTANCE_LABEL, fmtRaceTime, parseRaceTime,
  type Board, type ChampDistance, type ChampScope, type ChampSex, type Ranked, type ResultRow,
} from '@/lib/champions/table';
import { cn } from '@/lib/utils';

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

interface Suggestion { activityId: string; athleteId: string; name: string; distance: ChampDistance; watchSeconds: number; raceName: string | null; raceDate: string }
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
  const matches = form.q.trim() ? (roster?.athletes || []).filter((a) => a.status !== 'removed' && (a.name || '').toLowerCase().includes(form.q.trim().toLowerCase())).slice(0, 5) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="אלופי המדרגות · ניהול">
      <div className="space-y-3 px-4 pb-8" dir="rtl">
        {msg && <p role="status" className="rounded-xl bg-page px-3 py-2 text-13 font-bold text-ink-700">{msg}</p>}
        {data && !data.ready && <p className="text-13 text-accent-red-ink">מיגרציה 163 עוד לא הודבקה.</p>}

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

        {(data?.suggestions.length ?? 0) > 0 && (
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <b className="text-13 text-ink-400">מחכים לאישור · מהשעון, ביום מרוץ</b>
              <button type="button" disabled={busy}
                onClick={() => void call('POST', { bulk: data!.suggestions.map((s) => ({ ...s, seconds: s.watchSeconds })) }).then((ok) => ok && setMsg(`אושרו ${data!.suggestions.length}. אפשר לערוך כל אחד למטה`))}
                className="min-h-[36px] rounded-full bg-[#1525FF] px-3 text-13 font-extrabold text-white">לאשר את כל {data!.suggestions.length}</button>
            </div>
            {data!.suggestions.slice(0, 40).map((s) => (
              <SuggestionRow key={s.activityId} s={s} busy={busy} onAdd={(sec) => add({ ...s, seconds: sec })}
                onReject={() => void call('POST', { bulk: [{ ...s, seconds: s.watchSeconds, rejected: true }] }).then((ok) => ok && setMsg('לא נכנס לטבלה'))} />
            ))}
          </div>
        )}

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

function SuggestionRow({ s, busy, onAdd, onReject }: { s: Suggestion; busy: boolean; onAdd: (seconds: number | null) => Promise<boolean>; onReject: () => void }) {
  const [time, setTime] = useState(fmtRaceTime(s.watchSeconds));
  return (
    <div className="mt-1.5 rounded-[14px] bg-page px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[14px]">
        <b dir="auto" className="truncate">{s.name}</b>
        <span className="shrink-0 text-12 text-ink-400">{DISTANCE_LABEL[s.distance]} · {s.raceName || 'מרוץ'} · {dm(s.raceDate)}</span>
      </div>
      <div className="mt-1.5 flex gap-2">
        <input value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" inputMode="numeric" aria-label="זמן רשמי" className="min-h-[40px] min-w-0 flex-1 rounded-xl bg-white px-3 text-base" />
        <button type="button" disabled={busy} onClick={() => void onAdd(parseRaceTime(time))} className="min-h-[40px] rounded-xl bg-ink-900 px-3 text-13 font-bold text-white">לאשר</button>
        <button type="button" disabled={busy} onClick={onReject} className="min-h-[40px] rounded-xl bg-white px-3 text-13 font-bold text-ink-500">לא</button>
      </div>
      <small className="mt-1 block text-[11.5px] text-ink-400">בשעון: {fmtRaceTime(s.watchSeconds)} — לתקן לזמן הרשמי לפני האישור</small>
    </div>
  );
}
