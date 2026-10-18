'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { COACH_ID } from '@/lib/constants';
import { cn, GROUP_HEX } from '@/lib/utils';
import { sortByPaceGroup } from '@/lib/plans/pace-group';
import { CARD } from '@/components/academy/book/ui';
import { countsOf, reasonText, type WatchState } from '@/lib/day-session/watch-status';

// "לשלוח לשעונים" (mockup watch-send-v3): who it goes to — everyone, a pack, or by name —
// and then where it stands, runner by runner. Hebrew only, like the rest of the form.

interface Athlete { id: string; name: string; group_id?: string; status: string; hasGarmin?: boolean }
interface Group { id: string; name: string; marathonGoal?: string }

export interface RosterPerson { id: string; name: string; pack: 0 | 1 | 2; hasWatch: boolean }

/** The club as the send screen draws it: active members, each in pack 1..3 (fastest first). */
export function useRoster() {
  const { data: a } = useApi<{ athletes: Athlete[] }>(`/api/athletes?coach_id=${COACH_ID}`);
  const { data: g } = useApi<{ groups: Group[] }>(`/api/groups?coach_id=${COACH_ID}`);
  return useMemo(() => {
    if (!a || !g) return null;
    const order = sortByPaceGroup(g.groups || []).map((x) => x.id);
    const packOf = (gid?: string) => {
      const i = gid ? order.indexOf(gid) : -1;
      return (i < 0 ? 1 : Math.min(i, 2)) as 0 | 1 | 2;
    };
    return (a.athletes || []).filter((x) => x.status === 'active')
      .map((x) => ({ id: x.id, name: x.name, pack: packOf(x.group_id), hasWatch: !!x.hasGarmin }))
      .sort((x, y) => x.pack - y.pack || x.name.localeCompare(y.name));
  }, [a, g]);
}

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

export function Avatar({ name, pack, size = 36, dim }: { name: string; pack: number; size?: number; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full font-extrabold text-white', dim && 'opacity-40')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: GROUP_HEX[pack] }}
    >{initials(name)}</span>
  );
}

function Stack({ people, max = 8, size = 30 }: { people: RosterPerson[]; max?: number; size?: number }) {
  const more = people.length - max;
  return (
    <span className="inline-flex ps-2.5">
      {people.slice(0, max).map((p) => (
        <span key={p.id} className="-ms-2.5 inline-flex rounded-full ring-[2.5px] ring-white"><Avatar name={p.name} pack={p.pack} size={size} /></span>
      ))}
      {more > 0 && <span className="-ms-2.5 grid place-items-center rounded-full bg-[#E7E7EE] text-2xs font-bold text-ink-500 ring-[2.5px] ring-white" style={{ width: size, height: size }}>+{more}</span>}
    </span>
  );
}

const Tick = ({ on, color, disabled }: { on: boolean; color?: string; disabled?: boolean }) => (
  <span
    className={cn('grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-2 text-white', on ? 'border-transparent' : disabled ? 'border-dashed border-[#E5E5EB]' : 'border-ink-300')}
    style={on ? { background: color || '#1525FF' } : undefined}
  >{on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
);

type Mode = 'all' | 'pack' | 'one';

/** Who it goes to. `onSend` gets the ids, only people with a watch. */
export function WatchChoose({ roster, paces, session, busy, onSend }: {
  roster: RosterPerson[];
  /** Each pack's pace text, for the rows ("3:15"); null = the session has none. */
  paces: Array<string | null>;
  session: ReactNode;
  busy: boolean;
  onSend: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode>('all');
  const [packs, setPacks] = useState<number[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const withWatch = roster.filter((p) => p.hasWatch);
  const noWatch = roster.filter((p) => !p.hasWatch);
  const ids = mode === 'all' ? withWatch.map((p) => p.id)
    : mode === 'pack' ? withWatch.filter((p) => packs.includes(p.pack)).map((p) => p.id)
      : picked;
  const label = mode === 'all' ? `לשלוח לכולם · ${ids.length}`
    : mode === 'pack' ? (packs.length === 1 ? `לשלוח לדבוקה ${packs[0] + 1} · ${ids.length}` : `לשלוח ל־${ids.length}`)
      : `לשלוח ל־${ids.length}`;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shown = q.trim() ? roster.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : roster;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {session}
        <div className="flex rounded-[13px] bg-[#E3E3E9] p-[3px]" role="tablist">
          {([['all', '👥', 'כולם'], ['pack', '🎽', 'דבוקה'], ['one', '👤', 'יחידים']] as const).map(([m, e, t]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cn('flex min-h-[52px] flex-1 flex-col items-center justify-center rounded-[11px] text-[15px] font-bold', mode === m ? 'bg-white text-ink-900 shadow-[0_2px_8px_rgba(0,0,0,0.08)]' : 'text-ink-500')}>
              <span aria-hidden className="text-[17px] leading-none">{e}</span>{t}
            </button>
          ))}
        </div>

        {mode === 'all' && (
          <>
            <div className={cn(CARD, 'px-4 pb-4 pt-5 text-center')}>
              <p className="text-[15px] font-semibold text-ink-500">יגיע לשעון אצל</p>
              <p className="text-[64px] font-extrabold leading-none tracking-tight text-ink-900"><bdi dir="ltr">{withWatch.length}</bdi></p>
              <p className="mt-1 text-[15px] font-semibold text-ink-500">רצים, כל אחד בקצב של הדבוקה שלו</p>
              <div className="mt-3"><Stack people={withWatch} /></div>
              <div className="mt-4 flex border-t border-[#E5E5EB] pt-3.5">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="flex-1">
                    <p className="text-[22px] font-extrabold" style={{ color: GROUP_HEX[k] }}><bdi dir="ltr">{withWatch.filter((p) => p.pack === k).length}</bdi></p>
                    <p className="text-xs font-bold text-ink-500">דבוקה {k + 1}{paces[k] && <> · <bdi dir="ltr">{paces[k]}</bdi></>}</p>
                  </div>
                ))}
              </div>
            </div>
            {noWatch.length > 0 && (
              <div className={cn(CARD, 'flex items-center gap-3 px-4 py-3')}>
                <span aria-hidden className="text-xl">🔌</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px] text-ink-900"><bdi dir="ltr">{noWatch.length}</bdi> בלי שעון מחובר</b>
                  <small className="block truncate text-13 text-ink-400">{noWatch.map((p) => p.name).join(', ')}</small>
                </span>
                <span className="rounded-lg bg-[#EFEFF4] px-2 py-1 text-xs font-bold text-ink-500">לא יקבלו</span>
              </div>
            )}
          </>
        )}

        {mode === 'pack' && (
          <>
            <p className="px-1.5 text-13 font-bold text-ink-400">לבחור דבוקה אחת או יותר</p>
            <div className={cn(CARD, 'overflow-hidden')}>
              {[0, 1, 2].map((k) => {
                const members = roster.filter((p) => p.pack === k);
                const ready = members.filter((p) => p.hasWatch);
                const on = packs.includes(k);
                return (
                  <button key={k} type="button" onClick={() => setPacks((p) => toggle(p, k))} aria-pressed={on}
                    className="flex w-full items-center gap-3 border-b border-[#EFEFF4] px-4 py-3.5 text-start last:border-0">
                    <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[15px] text-xl font-extrabold text-white" style={{ background: GROUP_HEX[k] }}>{k + 1}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[17px] text-ink-900">דבוקה {k + 1}</b>
                      <small className="block text-13 text-ink-500">
                        {paces[k] && <>חזרות ב־<b style={{ color: GROUP_HEX[k] }}><bdi dir="ltr">{paces[k]}</bdi></b> · </>}
                        <bdi dir="ltr">{ready.length}</bdi> מתוך <bdi dir="ltr">{members.length}</bdi> עם שעון
                      </small>
                      <span className="mt-1.5 block"><Stack people={members} max={6} size={26} /></span>
                    </span>
                    <Tick on={on} color={GROUP_HEX[k]} />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {mode === 'one' && (
          <>
            <label className="flex h-11 items-center gap-2 rounded-xl bg-[#E3E3E9] px-3 text-ink-400">
              <Search className="h-4 w-4" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם" className="min-w-0 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400" />
            </label>
            {picked.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-13 font-bold text-ink-500">נבחרו:</span>
                {picked.map((id) => {
                  const p = roster.find((x) => x.id === id);
                  return (
                    <button key={id} type="button" onClick={() => setPicked((l) => l.filter((x) => x !== id))}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-brand-600/10 px-2.5 text-13 font-bold text-brand-600">
                      {p?.name.split(' ')[0]}<X className="h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            )}
            {[0, 1, 2].map((k) => {
              const list = shown.filter((p) => p.pack === k);
              if (!list.length) return null;
              return (
                <div key={k} className="space-y-1.5">
                  <p className="px-1.5 text-13 font-extrabold" style={{ color: GROUP_HEX[k] }}>● דבוקה {k + 1}</p>
                  <div className={cn(CARD, 'overflow-hidden')}>
                    {list.map((p) => {
                      const on = picked.includes(p.id);
                      return (
                        <button key={p.id} type="button" disabled={!p.hasWatch} onClick={() => setPicked((l) => toggle(l, p.id))} aria-pressed={on}
                          className="flex min-h-[60px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 text-start last:border-0">
                          <Avatar name={p.name} pack={p.pack} dim={!p.hasWatch} />
                          <span className="min-w-0 flex-1">
                            <b className={cn('block truncate text-base font-semibold', p.hasWatch ? 'text-ink-900' : 'text-ink-400')}>{p.name}</b>
                            <small className="block text-13 text-ink-400">{p.hasWatch ? 'גרמין' : 'אין שעון מחובר'}</small>
                          </span>
                          <Tick on={on} disabled={!p.hasWatch} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-[#E6E6EC] bg-page/95 px-4 pb-7 pt-3">
        <button type="button" disabled={!ids.length || busy} onClick={() => onSend(ids)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-[17px] bg-brand-600 text-[17px] font-extrabold text-white shadow-[0_10px_24px_-10px_rgba(21,37,255,0.6)] disabled:opacity-40">
          <span aria-hidden>⌚</span>{busy ? 'שולח…' : label}
        </button>
      </div>
    </div>
  );
}

// ── Tracking ───────────────────────────────────────────────────────────────────────────

export interface TrackRunner { athleteId: string; name: string; pack: 0 | 1 | 2; state: WatchState; error: string | null; at: string | null }
export interface TrackAnswer { sentAt: string | null; runners: TrackRunner[]; noWatch: Array<{ athleteId: string; name: string; pack: 0 | 1 | 2 }> }

const clock = (iso: string | null) => (iso
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  : '');

const STATE_TAG: Record<WatchState, { text: string; cls: string }> = {
  ok: { text: '✓ בשעון', cls: 'bg-[#E3F6EA] text-[#12A150]' },
  waiting: { text: 'ממתין לאייפון', cls: 'bg-[#FFF4DB] text-[#C27803]' },
  failed: { text: '✕ לא הגיע', cls: 'bg-[#FDEBEB] text-[#E5383B]' },
  sending: { text: 'שולח…', cls: 'bg-brand-600/10 text-brand-600' },
  queued: { text: 'בתור', cls: 'bg-[#EFEFF4] text-ink-500' },
};

type Filter = 'all' | 'ok' | 'failed' | 'way';

/** Where the send stands. Polls while anyone is still on the way. */
export function useWatchTrack(date: string | null) {
  const [live, setLive] = useState(true);
  const res = useApi<TrackAnswer>(date ? `/api/day-session/watch?date=${date}` : null, { refreshInterval: live ? 2000 : 0 });
  const way = (res.data?.runners || []).some((r) => r.state === 'queued' || r.state === 'sending');
  useEffect(() => { if (res.data) setLive(way); }, [res.data, way]);
  return { ...res, onTheWay: way, wake: () => setLive(true) };
}

export function WatchTrack({ data, onResend, busy }: { data: TrackAnswer; onResend: (ids: string[]) => void; busy: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const c = countsOf(data.runners);
  const way = c.onTheWay > 0;
  const failed = data.runners.filter((r) => r.state === 'failed');
  const rows = data.runners.filter((r) => filter === 'all' || (filter === 'ok' ? r.state === 'ok' : filter === 'failed' ? r.state === 'failed' : r.state === 'queued' || r.state === 'sending' || r.state === 'waiting'));
  const pct = (n: number) => `${c.total ? (n / c.total) * 100 : 0}%`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <div className={cn(CARD, 'px-4 py-3.5')}>
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[19px] text-ink-900">בשעון אצל <bdi dir="ltr">{c.ok}</bdi> מתוך <bdi dir="ltr">{c.total}</bdi></b>
            <span className="text-13 text-ink-400">{way ? 'שולח…' : data.sentAt ? `נשלח ${clock(data.sentAt)}` : ''}</span>
          </div>
          <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-[#E7E7EE]" aria-hidden>
            <span style={{ width: pct(c.ok), background: '#12A150' }} />
            <span style={{ width: pct(c.failed), background: '#E5383B' }} />
            <span style={{ width: pct(c.waiting), background: '#C27803' }} />
          </div>
          {!way && (
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[[c.ok, 'בשעון', '#12A150'], [c.waiting, 'ממתין', '#C27803'], [c.failed, 'נכשל', '#E5383B'], [data.noWatch.length, 'בלי שעון', '#8A8B96']].map(([n, t, col]) => (
                <div key={t as string} className="rounded-2xl bg-page py-2">
                  <b className="block text-[22px] font-extrabold" style={{ color: col as string }}><bdi dir="ltr">{n}</bdi></b>
                  <small className="text-xs font-bold text-ink-500">{t}</small>
                </div>
              ))}
            </div>
          )}
        </div>

        {!way && failed.length > 0 && (
          <div className={cn(CARD, 'overflow-hidden')}>
            <p className="px-4 pt-3 text-13 font-extrabold text-[#E5383B]">צריך טיפול</p>
            {failed.map((r) => (
              <div key={r.athleteId} className="flex items-center gap-3 border-b border-[#EFEFF4] px-4 py-3 last:border-0">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FDEBEB] text-lg">⚠️</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px] text-ink-900">{r.name} · דבוקה {r.pack + 1}</b>
                  <small className="block text-13 leading-snug text-ink-500">{reasonText(r.error)}</small>
                </span>
                <button type="button" disabled={busy} onClick={() => onResend([r.athleteId])} className="min-h-[44px] px-1 text-[15px] font-bold text-brand-600">שוב</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto" role="tablist">
          {([['all', 'הכל', c.total], ['ok', '✓ הצליחו', c.ok], ['failed', '✕ נכשלו', c.failed], ['way', 'בדרך', c.onTheWay + c.waiting]] as const).map(([f, t, n]) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cn('inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold', filter === f ? 'bg-ink-900 text-white' : 'bg-white text-ink-500')}>
              {t}<span className="text-xs opacity-75"><bdi dir="ltr">{n}</bdi></span>
            </button>
          ))}
        </div>
        <div className={cn(CARD, 'overflow-hidden')}>
          {rows.length === 0 && <p className="px-4 py-4 text-center text-sm text-ink-400">אין כאן אף אחד</p>}
          {rows.map((r) => (
            <div key={r.athleteId} className="flex min-h-[58px] items-center gap-3 border-b border-[#EFEFF4] px-4 last:border-0">
              <Avatar name={r.name} pack={r.pack} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-base font-semibold text-ink-900">{r.name}</b>
                <small className="block text-13 font-bold" style={{ color: GROUP_HEX[r.pack] }}>דבוקה {r.pack + 1}</small>
              </span>
              {r.state === 'ok' && r.at && <span className="text-xs text-ink-400"><bdi dir="ltr">{clock(r.at)}</bdi></span>}
              <span className={cn('whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold', STATE_TAG[r.state].cls)}>{STATE_TAG[r.state].text}</span>
            </div>
          ))}
        </div>
        {!way && data.noWatch.length > 0 && (
          <p className="px-1.5 text-13 leading-normal text-ink-400">בלי שעון מחובר: {data.noWatch.map((p) => p.name).join(', ')}</p>
        )}
      </div>
      {!way && failed.length > 0 && (
        <div className="shrink-0 border-t border-[#E6E6EC] bg-page/95 px-4 pb-7 pt-3">
          <button type="button" disabled={busy} onClick={() => onResend(failed.map((r) => r.athleteId))}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-[17px] bg-white text-[17px] font-extrabold text-ink-900">
            <span aria-hidden>⌚</span>לשלוח שוב רק למי שלא קיבל · <bdi dir="ltr">{failed.length}</bdi>
          </button>
        </div>
      )}
    </div>
  );
}
