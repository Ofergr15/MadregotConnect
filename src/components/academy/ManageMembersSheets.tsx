'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet, Spinner, Switch } from '@/components/ui';
import { sortBands } from '@/lib/academy/bands';
import { waShareUrl, type AddableMember, type BulkAction } from '@/lib/academy/manage';
import { memberCoachIds, memberCoachNames, joinHebrewList } from '@/lib/academy/members';
import { coachCapacityOf } from '@/lib/academy/coach-board';
import { initialsOf, type AcademyBand, type AcademyCoachSummary, type AcademyMember } from './types';
import { apiHeaders, useApi } from '@/lib/api';

// The manager's sheets on the members tab: move to a coach (one trainee or many),
// set the band for many, and add somebody — a club member, or someone new. Every
// write goes through POST /api/academy/members/bulk, so one trainee and twenty
// take the same path and leave the same history.

export async function postBulk(body: {
  athleteIds: string[];
  action: BulkAction;
  coachId?: string | null;
  /** 'coach': the whole new set of coaches (migration 135). */
  coachIds?: string[];
  bandId?: string | null;
  notify?: boolean;
}): Promise<{ ok: boolean; failed: number; error?: string }> {
  try {
    const res = await fetch('/api/academy/members/bulk', {
      method: 'POST',
      headers: await bearerHeaders(),
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, failed: body.athleteIds.length, error: json.error || 'השמירה נכשלה' };
    // Several coaches for one trainee need migration 135; until it is pasted the
    // server refuses a set of more than one, and says so per trainee.
    const noSchema = Array.isArray(json.results) && json.results.some((r: { error?: string }) => r?.error === 'no_schema');
    if (noSchema) return { ok: false, failed: json.failed ?? 0, error: 'כמה מאמנים למתאמן יעבדו אחרי עדכון מסד הנתונים. בינתיים אפשר מאמן אחד.' };
    return { ok: (json.failed ?? 0) === 0, failed: json.failed ?? 0, error: json.failed ? `${json.failed} לא עודכנו` : undefined };
  } catch {
    return { ok: false, failed: body.athleteIds.length, error: 'השמירה נכשלה' };
  }
}

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';

export function traineesLabel(n: number): string {
  return n === 0 ? 'אין מתאמנים' : n === 1 ? 'מתאמן אחד' : `${n} מתאמנים`;
}

function Checkbox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-[7px] border-2 transition-colors',
        on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300',
      )}
    >
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-[22px] w-[22px] shrink-0 rounded-full border-2 transition-all',
        on ? 'border-[7px] border-brand-600' : 'border-ink-300',
      )}
    />
  );
}

function Avatar({ name, url, coach, size = 36 }: { name: string; url?: string | null; coach?: boolean; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-xs font-extrabold',
        coach ? 'bg-brand-600 text-white' : 'bg-brand-600/15 text-brand-600',
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export { Avatar as MemberAvatar };

function PrimaryButton({ children, onClick, disabled, busy }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="mt-3 flex w-full min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-brand-600 text-base font-extrabold text-white transition-all active:scale-[0.99] disabled:opacity-50"
    >
      {busy && <Spinner size={16} tone="ink" />}
      {children}
    </button>
  );
}

// ── Change coach ────────────────────────────────────────────────────────────
//
// Migration 135: a trainee can have several coaches, all equal. For ONE trainee
// the sheet is a multi-select (mockup academy-multi-coach.html, phone 2): tick
// one or more, each with their load — a shared trainee takes a place on each.
// For MANY, two modes: "להעביר" replaces everyone's coaches with one, and
// "להוסיף מאמן" adds one coach and keeps the coaches they already have.

/** "לשמור · 2 מאמנים" — the count the save button carries. */
export function saveCoachesLabel(n: number): string {
  return n === 0 ? 'לשמור · בלי מאמן' : n === 1 ? 'לשמור · מאמן אחד' : `לשמור · ${n} מאמנים`;
}

/** Same set, same first coach — nothing to save. */
export function sameCoachSet(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((c) => after.includes(c)) && before[0] === after[0];
}

export function ChangeCoachSheet({
  open, onOpenChange, members, coaches, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One trainee, or the multi-selection. */
  members: AcademyMember[];
  coaches: AcademyCoachSummary[];
  onDone: () => void | Promise<void>;
}) {
  const single = members.length === 1 ? members[0] : null;
  const currentIds = useMemo(() => (single ? memberCoachIds(single) : []), [single]);
  const currentKey = currentIds.join(',');
  // Coaches made right here (below) show at once, before the parent's payload
  // catches up — otherwise the one just added could not be ticked.
  const [madeHere, setMadeHere] = useState<AcademyCoachSummary[]>([]);
  const assignable = useMemo(() => {
    const listed = coaches.filter((c) => c.coachId);
    return [...listed, ...madeHere.filter((m) => !listed.some((c) => c.coachId === m.coachId))];
  }, [coaches, madeHere]);
  // "+ מאמן נוסף": a club member becomes an academy coach without leaving the
  // sheet. With one coach in the academy there is nobody second to tick, which
  // is exactly where "choose several coaches" stopped working (2026-10-06).
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [making, setMaking] = useState<string | null>(null);
  const { data: pool } = useApi<{ candidates: Array<{ id: string; name: string }> }>(open && adding ? '/api/academy/coaches' : null);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set(assignable.map((c) => c.coachId));
    const exclude = new Set(members.map((m) => m.athleteId));
    return (pool?.candidates ?? [])
      .filter((c) => !taken.has(c.id) && !exclude.has(c.id) && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [pool, query, assignable, members]);
  const makeCoach = async (person: { id: string; name: string }) => {
    setMaking(person.id);
    setError(null);
    try {
      const res = await fetch('/api/academy/coaches', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: person.id, coach: true }),
      });
      if (!res.ok) throw new Error();
      setMadeHere((m) => [...m, { coachId: person.id, coachName: person.name, trainees: 0, unpaced: 0, weekKm: 0, completionRate: null } as AcademyCoachSummary]);
      if (single) setSet((s) => (s.includes(person.id) ? s : [...s, person.id]));
      else setPick(person.id);
      setAdding(false);
      setQuery('');
      void onDone();
    } catch {
      setError('לא הצלחתי להוסיף את המאמן');
    } finally {
      setMaking(null);
    }
  };
  const { data: settingsData } = useApi<{ settings?: unknown }>(open ? '/api/academy/settings' : null);
  const capacity = coachCapacityOf(settingsData?.settings);
  // Single: the ticked set, in the order ticked (the first stays the legacy coach).
  const [set, setSet] = useState<string[]>([]);
  // Many: `undefined` = nothing picked yet; `null` = "no coach", a real choice.
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<'move' | 'add'>('move');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSet(currentKey ? currentKey.split(',') : []);
    setPick(undefined);
    setMode('move');
    setNotify(true);
    setError(null);
    setAdding(false);
    setQuery('');
  }, [open, currentKey]);

  const toggle = (id: string) => setSet((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // What the load will be after the save, so the bar answers "can he take them?".
  const loadAfter = (c: AcademyCoachSummary) => {
    if (!single || !c.coachId) return c.trainees;
    const was = currentIds.includes(c.coachId);
    const now = set.includes(c.coachId);
    return c.trainees + (now && !was ? 1 : 0) - (was && !now ? 1 : 0);
  };
  const maxLoad = Math.max(capacity, ...assignable.map((c) => c.trainees));
  const picked = assignable.find((c) => c.coachId === pick) ?? null;
  const unchanged = single ? sameCoachSet(currentIds, set) : pick === undefined || (mode === 'add' && pick === null);
  const changes = single
    ? set.filter((c) => !currentIds.includes(c)).length + currentIds.filter((c) => !set.includes(c)).length
    : 1;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const athleteIds = members.map((m) => m.athleteId);
    const r = single
      ? await postBulk({ athleteIds, action: 'coach', coachIds: set, notify: notify && changes > 0 })
      : mode === 'add'
        ? await postBulk({ athleteIds, action: 'addCoach', coachId: pick ?? null, notify })
        : await postBulk({ athleteIds, action: 'coach', coachId: pick ?? null, notify: notify && pick !== null });
    setBusy(false);
    if (!r.ok) { setError(r.error || 'השמירה נכשלה'); if (r.failed < members.length) await onDone(); return; }
    await onDone();
    onOpenChange(false);
  };

  const cta = single
    ? saveCoachesLabel(set.length)
    : mode === 'add'
      ? `להוסיף את ${firstName(picked?.coachName) || '…'} ל־${members.length} מתאמנים`
      : pick === null
        ? `${members.length} מתאמנים בלי מאמן`
        : `להעביר ${members.length} מתאמנים ל־${firstName(picked?.coachName) || '…'}`;

  const coachRow = (c: AcademyCoachSummary, on: boolean, onClick: () => void, control: React.ReactNode) => {
    const load = loadAfter(c);
    const isCurrent = !!single && currentIds.includes(c.coachId!);
    const free = Math.max(0, capacity - load);
    return (
      <button
        key={c.coachId}
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60"
      >
        {control}
        <Avatar name={c.coachName || ''} coach size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink-700" dir="auto">{c.coachName}</span>
          <span className="block text-xs text-ink-400">
            <bdi dir="ltr">{load}</bdi> מתוך <bdi dir="ltr">{capacity}</bdi>
            {load === 0 ? ' · פנוי' : free === 0 ? ' · מלא' : ''}
            {isCurrent && !single ? ' · המאמן היום' : ''}
          </span>
        </span>
        <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-page" aria-hidden>
          <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (load / maxLoad) * 100)}%` }} />
        </span>
      </button>
    );
  };

  const title = single ? `מאמנים ל־${single.name}` : mode === 'add' ? `מאמן נוסף ל־${members.length} מתאמנים` : `להעביר ${members.length} מתאמנים`;
  const todayNames = single ? joinHebrewList(memberCoachNames(single).filter(Boolean)) : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" title={title}>
      <div className="pb-2" dir="rtl">
        <p className="-mt-1 mb-3 px-1 text-xs text-ink-400">
          {single
            ? `אפשר לבחור אחד או יותר. כולם שווים.${todayNames ? ` היום: ${todayNames}` : ' היום: בלי מאמן'}`
            : members.map((m) => firstName(m.name)).slice(0, 6).join(', ') + (members.length > 6 ? '…' : '')}
        </p>
        {!single && (
          <div className="mb-2.5 grid grid-cols-2 gap-1 rounded-2xl bg-card p-1" role="tablist">
            {([['move', 'להעביר'], ['add', 'להוסיף מאמן']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => { setMode(key); if (key === 'add' && pick === null) setPick(undefined); }}
                className={cn(
                  'min-h-[44px] rounded-xl text-sm font-extrabold transition-colors',
                  mode === key ? 'bg-brand-600 text-white' : 'text-ink-500',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
          {assignable.length === 0 && (
            <p className="px-4 py-4 text-sm text-ink-500">אין עדיין מאמנים באקדמיה. מוסיפים כאן למטה.</p>
          )}
          {assignable.map((c) => (single
            ? coachRow(c, set.includes(c.coachId!), () => toggle(c.coachId!), <Checkbox on={set.includes(c.coachId!)} />)
            : coachRow(c, pick === c.coachId, () => setPick(c.coachId), <Radio on={pick === c.coachId} />)))}
          {!single && mode === 'move' && (
            <button
              type="button"
              onClick={() => setPick(null)}
              aria-pressed={pick === null}
              className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60"
            >
              <Radio on={pick === null} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink-700">בלי מאמן</span>
                <span className="block text-xs text-ink-400">יופיע ב״בלי מאמן״</span>
              </span>
            </button>
          )}
        </div>

        {single && assignable.length === 1 && !adding && (
          <p className="mt-2 px-1 text-xs text-ink-400">יש באקדמיה מאמן אחד. כדי לבחור כמה, מוסיפים מאמן:</p>
        )}
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 flex w-full min-h-[48px] items-center justify-center gap-2 rounded-card border-2 border-dashed border-ink-300 text-sm font-extrabold text-brand-600"
          >
            + מאמן נוסף מהמועדון
          </button>
        ) : (
          <div className="mt-2 rounded-card bg-card p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש חבר מועדון"
              className="w-full min-h-[44px] rounded-xl bg-page px-3 text-base text-ink-700 outline-none placeholder:text-ink-400"
              dir="auto"
            />
            <div className="mt-1 divide-y divide-page">
              {!pool && <p className="px-2 py-3 text-sm text-ink-400">טוען…</p>}
              {pool && matches.length === 0 && <p className="px-2 py-3 text-sm text-ink-400">לא נמצא</p>}
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => makeCoach(c)}
                  disabled={!!making}
                  className="flex w-full min-h-[48px] items-center gap-3 px-2 text-start disabled:opacity-50"
                >
                  <Avatar name={c.name} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-700" dir="auto">{c.name}</span>
                  <span className="shrink-0 text-xs font-extrabold text-brand-600">{making === c.id ? '…' : 'להוסיף כמאמן'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2.5 flex min-h-[56px] items-center gap-3 rounded-card bg-card px-4">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink-700">להודיע</span>
            <span className="block text-xs text-ink-400">
              {single ? 'למתאמן ולמאמנים שנוספו או הוסרו' : mode === 'add' ? 'לכל מתאמן, ולמאמן בהודעה אחת' : 'לכל מתאמן, ולמאמן החדש בהודעה אחת'}
            </span>
          </span>
          <Switch
            checked={notify && (single ? changes > 0 : pick !== null)}
            onChange={setNotify}
            disabled={single ? changes === 0 : pick === null}
            activeColor="bg-accent-600"
            ariaLabel="להודיע"
          />
        </div>
        <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">
          {single
            ? 'שיחה אחת למתאמן ולכל המאמנים שלו. מאמן שנוסף רואה את כל ההיסטוריה, והדבוקה והקצב לא משתנים.'
            : mode === 'add'
              ? 'המאמנים שכבר יש להם נשארים. מתאמן משותף נספר במקומות של כל מאמן שלו.'
              : 'השיחה הקודמת והמשובים נשארים אצל המתאמן. המאמן החדש רואה את כל ההיסטוריה, והדבוקה והקצב לא משתנים.'}
        </p>
        {error && <p className="mt-2 px-1 text-sm text-accent-red-ink">{error}</p>}
        <PrimaryButton onClick={() => void submit()} disabled={unchanged || (assignable.length === 0 && (single ? set.length > 0 : pick !== null))} busy={busy}>
          {cta}
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

// ── Band, for many ──────────────────────────────────────────────────────────

export function BandSheet({
  open, onOpenChange, members, bands, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: AcademyMember[];
  bands: AcademyBand[];
  onDone: () => void | Promise<void>;
}) {
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setPick(undefined); setError(null); } }, [open]);
  const ordered = sortBands(bands);
  const picked = ordered.find((b) => b.id === pick);

  const submit = async () => {
    if (pick === undefined) return;
    setBusy(true);
    setError(null);
    const r = await postBulk({ athleteIds: members.map((m) => m.athleteId), action: 'band', bandId: pick });
    setBusy(false);
    if (!r.ok) { setError(r.error || 'השמירה נכשלה'); return; }
    await onDone();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" title={members.length === 1 ? `דבוקה ל־${members[0].name}` : `דבוקה ל־${members.length} מתאמנים`}>
      <div className="pb-2" dir="rtl">
        <div className="max-h-[52vh] overflow-y-auto overflow-hidden rounded-card bg-card divide-y divide-page">
          {ordered.map((b) => (
            <button key={b.id} type="button" onClick={() => setPick(b.id)} aria-pressed={pick === b.id}
              className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60">
              <Radio on={pick === b.id} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink-700">{b.name}</span>
                {b.goal && <span className="block truncate text-xs text-ink-400">{b.goal}</span>}
              </span>
              <span className="text-xs tabular-nums text-ink-400">{traineesLabel(b.trainees ?? 0)}</span>
            </button>
          ))}
          <button type="button" onClick={() => setPick(null)} aria-pressed={pick === null}
            className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60">
            <Radio on={pick === null} />
            <span className="block text-[15px] font-semibold text-ink-700">בלי דבוקה</span>
          </button>
        </div>
        <p className="mt-1.5 px-1 text-xs text-ink-400">התאמת קצב אישית, למי שיש, נשארת כמו שהיא.</p>
        {error && <p className="mt-2 px-1 text-sm text-accent-red-ink">{error}</p>}
        <PrimaryButton onClick={() => void submit()} disabled={pick === undefined} busy={busy}>
          {pick === null ? 'להוריד את הדבוקה' : `לשבץ ב${picked ? `־${picked.name}` : 'דבוקה'}`}
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

// ── Add ─────────────────────────────────────────────────────────────────────

type StartMode = 'direct' | 'candidate';
type Picker = 'coach' | 'band' | 'mode' | null;

async function candidates(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const res = await fetch('/api/academy/candidates', { method, headers: await bearerHeaders(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

function yearOf(iso: string | null): string | null {
  if (!iso) return null;
  const y = new Date(iso).getFullYear();
  return Number.isFinite(y) ? String(y) : null;
}

export function AddMemberSheet({
  open, onOpenChange, addable, coaches, bands, onDone, onOpenFunnel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Approved club members not in the academy. Undefined while loading. */
  addable: AddableMember[] | undefined;
  coaches: AcademyCoachSummary[];
  bands: AcademyBand[];
  onDone: () => void | Promise<void>;
  onOpenFunnel?: (candidateId: string) => void;
}) {
  const [segment, setSegment] = useState<'club' | 'new'>('club');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const assignable = useMemo(() => coaches.filter((c) => c.coachId).sort((a, b) => a.trainees - b.trainees), [coaches]);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [bandId, setBandId] = useState<string | null>(null);
  const [mode, setMode] = useState<StartMode>('direct');
  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; candidateId?: string } | null>(null);

  // "Someone new"
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<{ candidateId: string; url: string; name: string; phone: string; email: string } | null>(null);
  const [mailState, setMailState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSegment('club'); setQuery(''); setChosen(null); setMode('direct'); setPicker(null); setMessage(null);
    setBandId(null);
    setCoachId(assignable[0]?.coachId ?? null);
    setName(''); setPhone(''); setEmail(''); setInvite(null); setMailState('idle'); setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (addable ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 30);
  }, [addable, query]);
  const person = (addable ?? []).find((a) => a.athleteId === chosen) ?? null;
  const coach = assignable.find((c) => c.coachId === coachId) ?? null;
  const band = bands.find((b) => b.id === bandId) ?? null;

  const addClubMember = async () => {
    if (!person) return;
    setBusy(true);
    setMessage(null);
    if (mode === 'direct') {
      const r = await postBulk({ athleteIds: [person.athleteId], action: 'add', coachId, bandId, notify: true });
      setBusy(false);
      if (!r.ok) { setMessage({ ok: false, text: r.error || 'ההוספה נכשלה' }); return; }
      await onDone();
      setMessage({ ok: true, text: `${person.name} באקדמיה${coach ? `, אצל ${coach.coachName}` : ''}` });
      setChosen(null);
      return;
    }
    // As a candidate: a card on the funnel, linked to their account, so the calls
    // and the test are recorded against them.
    const created = await candidates('POST', { name: person.name, source: 'club' });
    if (!created.ok || !created.json?.candidate?.id) {
      setBusy(false);
      setMessage({ ok: false, text: created.json?.error || 'לא הצלחנו לפתוח כרטיס' });
      return;
    }
    const id = String(created.json.candidate.id);
    const linked = await candidates('PATCH', { id, action: 'link', athleteId: person.athleteId });
    setBusy(false);
    if (!linked.ok) {
      setMessage({ ok: false, text: linked.json?.error || 'הכרטיס נפתח, אבל לא חובר לחשבון', candidateId: id });
      return;
    }
    setMessage({ ok: true, text: `נפתח כרטיס במשפך ל־${person.name}`, candidateId: id });
    setChosen(null);
  };

  const createInvite = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setMessage(null);
    const created = await candidates('POST', { name: n, phone: phone.trim(), email: email.trim(), source: 'manager' });
    if (!created.ok || !created.json?.candidate?.id) {
      setBusy(false);
      setMessage({ ok: false, text: created.json?.error || 'לא הצלחנו לפתוח כרטיס' });
      return;
    }
    const id = String(created.json.candidate.id);
    // `send: false` mints the personal link and stamps the card, without a mail.
    const inv = await candidates('PATCH', { id, action: 'invite', send: false });
    setBusy(false);
    if (!inv.ok || !inv.json?.url) {
      setMessage({ ok: false, text: inv.json?.error || 'הכרטיס נפתח, אבל הקישור לא נוצר', candidateId: id });
      return;
    }
    setInvite({ candidateId: id, url: String(inv.json.url), name: n, phone: phone.trim(), email: email.trim() });
    await onDone();
  };

  const sendMail = async () => {
    if (!invite) return;
    setMailState('sending');
    const r = await candidates('PATCH', { id: invite.candidateId, action: 'invite', send: true });
    setMailState(r.ok && r.json?.email?.ok !== false ? 'sent' : 'failed');
  };

  const copy = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.url); setCopied(true); } catch { setCopied(false); }
  };

  const shareText = invite
    ? `היי ${firstName(invite.name)}, זה הקישור האישי שלך לטופס ההצטרפות לאקדמיה של מדרגות: ${invite.url}`
    : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" title="הוספה לאקדמיה">
      <div className="pb-2" dir="rtl">
        <div className="mb-3 flex rounded-xl bg-page p-0.5" role="tablist">
          {(['club', 'new'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={segment === s}
              onClick={() => { setSegment(s); setMessage(null); setPicker(null); }}
              className={cn('min-h-[40px] flex-1 rounded-[10px] text-[13px] font-extrabold transition-colors',
                segment === s ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400')}>
              {s === 'club' ? 'חבר מועדון' : 'מישהו חדש'}
            </button>
          ))}
        </div>

        {segment === 'club' ? (
          <>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש במועדון"
                className="w-full min-h-[44px] rounded-xl bg-card ps-9 pe-3 text-[16px] text-ink-700 placeholder:text-ink-400 focus:outline-none" />
            </div>
            <div className="max-h-[188px] overflow-y-auto rounded-card bg-card divide-y divide-page">
              {addable === undefined ? (
                <div className="flex justify-center py-6"><Spinner size={18} /></div>
              ) : list.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-ink-400">{query ? 'אין התאמה במועדון' : 'כל חברי המועדון כבר באקדמיה'}</p>
              ) : list.map((a) => (
                <button key={a.athleteId} type="button" onClick={() => { setChosen(a.athleteId); setMessage(null); }} aria-pressed={chosen === a.athleteId}
                  className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60">
                  <Radio on={chosen === a.athleteId} />
                  <Avatar name={a.name} url={a.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink-700" dir="auto">{a.name}</span>
                    <span className="block truncate text-xs text-ink-400">
                      {[yearOf(a.createdAt) && <>במועדון מאז <bdi dir="ltr">{yearOf(a.createdAt)}</bdi></>, a.groupName]
                        .filter(Boolean)
                        .map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <p className="mb-1.5 mt-3 px-1 text-2xs font-bold text-ink-400">איך מתחילים</p>
            {picker ? (
              <div className="max-h-[220px] overflow-y-auto rounded-card bg-card divide-y divide-page">
                {picker === 'coach' && [...assignable.map((c) => ({ id: c.coachId as string | null, label: c.coachName || '', sub: traineesLabel(c.trainees) })), { id: null, label: 'בלי מאמן', sub: 'לשבץ אחר כך' }]
                  .map((o) => (
                    <button key={o.id ?? 'none'} type="button" onClick={() => { setCoachId(o.id); setPicker(null); }}
                      className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
                      <Radio on={coachId === o.id} />
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-700">{o.label}</span><span className="block text-xs text-ink-400">{o.sub}</span></span>
                    </button>
                  ))}
                {picker === 'band' && [...sortBands(bands).map((b) => ({ id: b.id as string | null, label: b.name, sub: b.goal || '' })), { id: null, label: 'בלי דבוקה', sub: 'לקבוע אחרי הטסט' }]
                  .map((o) => (
                    <button key={o.id ?? 'none'} type="button" onClick={() => { setBandId(o.id); setPicker(null); }}
                      className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
                      <Radio on={bandId === o.id} />
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-700">{o.label}</span>{o.sub && <span className="block truncate text-xs text-ink-400">{o.sub}</span>}</span>
                    </button>
                  ))}
                {picker === 'mode' && ([
                  { id: 'direct' as const, label: 'ישר כמתאמן', sub: 'נכנס לאקדמיה עכשיו, עם המאמן והדבוקה' },
                  { id: 'candidate' as const, label: 'כמועמד', sub: 'כרטיס במשפך: שיחה, טסט, ואז קבלה' },
                ]).map((o) => (
                  <button key={o.id} type="button" onClick={() => { setMode(o.id); setPicker(null); }}
                    className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
                    <Radio on={mode === o.id} />
                    <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-700">{o.label}</span><span className="block text-xs text-ink-400">{o.sub}</span></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
                {mode === 'direct' && (
                  <>
                    <SettingRow label="מאמן" value={coach?.coachName || 'בלי מאמן'} onChange={() => setPicker('coach')} />
                    <SettingRow label="דבוקה" value={band?.name || 'בלי דבוקה'} onChange={() => setPicker('band')} />
                  </>
                )}
                <SettingRow label="שלב" value={mode === 'direct' ? 'ישר כמתאמן' : 'כמועמד'} onChange={() => setPicker('mode')} />
              </div>
            )}
            <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">
              {mode === 'direct'
                ? '״ישר כמתאמן״ מדלג על המשפך, ושולח לו ולמאמן הודעה. או ״כמועמד״ כדי לעבור שיחה וטסט קודם.'
                : 'נפתח לו כרטיס במשפך, מחובר לחשבון שלו. נכנס לאקדמיה רק כשמקבלים אותו משם.'}
            </p>
            <AddResult message={message} onOpenFunnel={onOpenFunnel} />
            <PrimaryButton onClick={() => void addClubMember()} disabled={!person} busy={busy}>
              {!person ? 'לבחור מהרשימה' : mode === 'direct' ? `להוסיף את ${firstName(person.name)}` : `לפתוח כרטיס ל־${firstName(person.name)}`}
            </PrimaryButton>
          </>
        ) : invite ? (
          <>
            <div className="rounded-card bg-card p-4">
              <p className="text-[15px] font-bold text-ink-700">הקישור של {firstName(invite.name)} מוכן</p>
              <p className="mt-0.5 text-xs text-ink-400">קישור אישי לטופס, עם השם והפרטים כבר ממולאים. כשימלא, יופיע ב״ממתינים״.</p>
              <p className="mt-2.5 select-all break-all rounded-xl bg-page px-3 py-2 text-xs text-ink-700"><bdi dir="ltr">{invite.url}</bdi></p>
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <a href={waShareUrl(invite.phone, shareText)} target="_blank" rel="noopener noreferrer"
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-[#1FA55B] text-xs font-extrabold text-white">
                <MessageCircle className="h-5 w-5" /> וואטסאפ
              </a>
              <button type="button" onClick={() => void sendMail()} disabled={!invite.email || mailState === 'sending' || mailState === 'sent'}
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-card text-xs font-extrabold text-ink-700 disabled:opacity-50">
                {mailState === 'sent' ? <Check className="h-5 w-5 text-accent-600" /> : mailState === 'sending' ? <Spinner size={18} /> : <Mail className="h-5 w-5" />}
                {mailState === 'sent' ? 'נשלח' : mailState === 'failed' ? 'לא יצא' : invite.email ? 'במייל' : 'אין מייל'}
              </button>
              <button type="button" onClick={() => void copy()}
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-card text-xs font-extrabold text-ink-700">
                {copied ? <Check className="h-5 w-5 text-accent-600" /> : <Copy className="h-5 w-5" />}
                {copied ? 'הועתק' : 'העתקה'}
              </button>
            </div>
            {onOpenFunnel && (
              <button type="button" onClick={() => onOpenFunnel(invite.candidateId)}
                className="mt-2.5 w-full min-h-[44px] rounded-xl text-sm font-bold text-brand-600">לכרטיס במשפך</button>
            )}
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Field label="שם" value={name} onChange={setName} placeholder="שם מלא" />
              <Field label="טלפון" value={phone} onChange={setPhone} placeholder="050-0000000" type="tel" ltr />
              <Field label="מייל (לא חובה)" value={email} onChange={setEmail} placeholder="name@example.com" type="email" ltr />
            </div>
            <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">
              נפתח לו כרטיס במשפך, ומקבלים קישור אישי לטופס לשלוח בוואטסאפ או במייל. כשימלא, יופיע ב״ממתינים״.
            </p>
            <AddResult message={message} onOpenFunnel={onOpenFunnel} />
            <PrimaryButton onClick={() => void createInvite()} disabled={!name.trim() || (!phone.trim() && !email.trim())} busy={busy}>
              ליצור קישור לטופס
            </PrimaryButton>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SettingRow({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
      <span className="flex-1 text-[15px] font-semibold text-ink-700">{label}</span>
      <span className="truncate text-sm font-bold text-ink-500" dir="auto">{value}</span>
      <span className="shrink-0 text-[13px] font-extrabold text-brand-600">שינוי</span>
    </button>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', ltr }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; ltr?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block px-1 text-2xs font-bold text-ink-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        dir={ltr ? 'ltr' : 'auto'}
        className={cn('w-full min-h-[46px] rounded-xl bg-card px-3 text-[16px] text-ink-700 placeholder:text-ink-400 focus:outline-none', ltr && 'text-end')} />
    </label>
  );
}

function AddResult({ message, onOpenFunnel }: { message: { ok: boolean; text: string; candidateId?: string } | null; onOpenFunnel?: (id: string) => void }) {
  if (!message) return null;
  return (
    <div className={cn('mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm', message.ok ? 'bg-accent-600/10 text-accent-900' : 'bg-accent-red/10 text-accent-red-ink')}>
      {message.ok && <Check className="h-4 w-4 shrink-0" />}
      <span className="flex-1" dir="auto">{message.text}</span>
      {message.candidateId && onOpenFunnel && (
        <button type="button" onClick={() => onOpenFunnel(message.candidateId!)} className="min-h-[36px] shrink-0 text-xs font-extrabold text-brand-600">למשפך</button>
      )}
    </div>
  );
}
