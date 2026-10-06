'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet, Spinner, Switch } from '@/components/ui';
import { sortBands } from '@/lib/academy/bands';
import { waShareUrl, type AddableMember, type BulkAction } from '@/lib/academy/manage';
import { memberCoachIds, memberCoachNames, joinHebrewList } from '@/lib/academy/members';
import { addToCoachBody, traineesToAdd } from '@/lib/academy/coach-board';
import {
  ASSIGN_COACHES_LABEL, assignBody, bidiNames, bulkCta, sameCoachSet, saveCoachesLabel, type AssignMode,
} from '@/lib/academy/coach-picker';
import { initialsOf, type AcademyBand, type AcademyCoachSummary, type AcademyMember } from './types';
import { CoachesPicker } from './CoachesPicker';

// The manager's sheets on the members tab: move to a coach (one trainee or many),
// set the band for many, and add somebody — a club member, or someone new. Every
// write goes through POST /api/academy/members/bulk, so one trainee and twenty
// take the same path and leave the same history.

const NO_SCHEMA_TEXT = 'כמה מאמנים למתאמן יעבדו אחרי עדכון מסד הנתונים. בינתיים אפשר מאמן אחד.';

export async function postBulk(body: {
  athleteIds: string[];
  action: BulkAction;
  coachId?: string | null;
  /** 'coach': the whole new set; 'addCoach': the coaches to add; 'add': to start with (migration 135). */
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
    if (json?.code === 'no_schema') return { ok: false, failed: body.athleteIds.length, error: NO_SCHEMA_TEXT };
    if (!res.ok) return { ok: false, failed: body.athleteIds.length, error: json.error || 'השמירה נכשלה' };
    // Several coaches for one trainee need migration 135; until it is pasted the
    // server refuses a set of more than one, and says so per trainee.
    const noSchema = Array.isArray(json.results) && json.results.some((r: { error?: string }) => r?.error === 'no_schema');
    if (noSchema) return { ok: false, failed: json.failed ?? 0, error: NO_SCHEMA_TEXT };
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

// ── שיבוץ מאמנים ────────────────────────────────────────────────────────────
//
// Migration 135: a trainee can have several coaches, all equal. CoachAssignPanel
// is the one body every "שיבוץ מאמנים" door draws (the member card through
// ChangeCoachSheet, the quick action, a suggestion's ⋯): the shared CoachesPicker,
// and for MANY trainees two clearly named modes — "להעביר" replaces everyone's
// coaches with the ticked ones, "להוסיף מאמן" adds them and keeps the coaches they
// already have. Every save is one POST /api/academy/members/bulk.

export { saveCoachesLabel, sameCoachSet };

export function CoachAssignPanel({
  members, coaches, multiCoach, preset, recommendedId = null, onDone, onSaved,
}: {
  /** One trainee, or several. Remount (key) to start over. */
  members: AcademyMember[];
  coaches: AcademyCoachSummary[];
  /** `false` before migration 135: one coach per trainee, and the picker says so. */
  multiCoach?: boolean;
  /** Coaches ticked to start with when nobody has one yet (a suggestion, a preset). */
  preset?: string[];
  recommendedId?: string | null;
  /** Revalidate the shared payload — also after a coach is made inside the picker. */
  onDone: () => void | Promise<void>;
  /** The save went through; the caller closes or moves on. */
  onSaved?: (coachIds: string[]) => void;
}) {
  const multi = multiCoach !== false;
  const single = members.length === 1 ? members[0] : null;
  const sets = useMemo(() => members.map((m) => memberCoachIds(m)), [members]);
  const currentIds = single ? sets[0] : [];
  const anyCoached = sets.some((s) => s.length > 0);
  const [picked, setPicked] = useState<string[]>(() => (single && currentIds.length ? currentIds : preset ?? []));
  const [none, setNone] = useState(false);
  // Before 135 "add" cannot be stored for anyone who has a coach, so it is not offered.
  const [mode, setMode] = useState<AssignMode>('replace');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showModes = !single && anyCoached && multi;

  const nameOf = (id: string) => coaches.find((c) => c.coachId === id)?.coachName || '';
  const changes = single
    ? picked.filter((c) => !currentIds.includes(c)).length + currentIds.filter((c) => !picked.includes(c)).length
    : 1;
  const unchanged = single ? sameCoachSet(currentIds, picked) : none ? false : picked.length === 0;
  const notifyOn = notify && (single ? changes > 0 : !none);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const athleteIds = members.map((m) => m.athleteId);
    const body = assignBody(athleteIds, none ? [] : picked, single ? 'replace' : mode, notifyOn);
    const r = await postBulk(body);
    setBusy(false);
    if (!r.ok) { setError(r.error || 'השמירה נכשלה'); if (r.failed < members.length) await onDone(); return; }
    await onDone();
    onSaved?.(none ? [] : picked);
  };

  const cta = single
    ? saveCoachesLabel(picked.length)
    : bulkCta(mode, members.length, picked.map(nameOf), none, !anyCoached);
  const todayNames = single ? bidiNames(memberCoachNames(single)) : '';

  return (
    <div className="pb-2" dir="rtl">
      <p className="-mt-1 mb-3 px-1 text-xs text-ink-400" dir="auto">
        {single
          ? `${multi ? 'אפשר לבחור אחד או יותר. כולם שווים.' : 'בוחרים מאמן.'}${todayNames ? ` היום: ${todayNames}` : ' היום: בלי מאמן'}`
          : bidiNames(members.map((m) => firstName(m.name)).slice(0, 6)) + (members.length > 6 ? ' ועוד' : '')}
      </p>
      {showModes && (
        <>
          <div className="mb-1.5 grid grid-cols-2 gap-1 rounded-2xl bg-card p-1" role="tablist" aria-label="איך לשבץ">
            {([['replace', 'להעביר'], ['add', 'להוסיף מאמן']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => { setMode(key); if (key === 'add') setNone(false); }}
                className={cn(
                  'min-h-[44px] rounded-xl text-sm font-extrabold transition-colors',
                  mode === key ? 'bg-brand-600 text-white' : 'text-ink-500',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mb-2.5 px-1 text-xs leading-relaxed text-ink-500">
            {mode === 'replace'
              ? 'להעביר: המאמנים שיש להם היום יורדים, ונשארים רק אלה שמסמנים.'
              : 'להוסיף מאמן: המאמנים שכבר יש להם נשארים, והמסומנים מצטרפים.'}
          </p>
        </>
      )}

      <CoachesPicker
        coaches={coaches}
        value={none ? [] : picked}
        onChange={(ids) => { setPicked(ids); setNone(false); }}
        sets={sets}
        mode={single ? 'replace' : mode}
        multi={multi}
        exclude={members.map((m) => m.athleteId)}
        recommendedId={recommendedId}
        onCoachMade={onDone}
        none={!single && mode === 'replace' && anyCoached ? { on: none, onPick: () => { setNone(!none); setPicked([]); } } : undefined}
      />

      <div className="mt-2.5 flex min-h-[56px] items-center gap-3 rounded-card bg-card px-4">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink-700">להודיע</span>
          <span className="block text-xs text-ink-400">
            {single ? 'למתאמן ולמאמנים שנוספו או הוסרו' : 'לכל מתאמן, ולכל מאמן בהודעה אחת'}
          </span>
        </span>
        <Switch
          checked={notifyOn}
          onChange={setNotify}
          disabled={single ? changes === 0 : none}
          activeColor="bg-accent-600"
          ariaLabel="להודיע"
        />
      </div>
      <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">
        שיחה אחת למתאמן ולכל המאמנים שלו. מאמן שנוסף רואה את כל ההיסטוריה, והדבוקה והקצב לא משתנים.
      </p>
      {error && <p className="mt-2 px-1 text-sm text-accent-red-ink" role="alert">{error}</p>}
      <PrimaryButton onClick={() => void submit()} disabled={unchanged} busy={busy}>
        {cta}
      </PrimaryButton>
    </div>
  );
}

/** The panel in a sheet — the member card's "שיבוץ מאמנים · לשנות", and the members tab. */
export function ChangeCoachSheet({
  open, onOpenChange, members, coaches, multiCoach, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One trainee, or the multi-selection. */
  members: AcademyMember[];
  coaches: AcademyCoachSummary[];
  multiCoach?: boolean;
  onDone: () => void | Promise<void>;
}) {
  const single = members.length === 1 ? members[0] : null;
  const title = single ? `${ASSIGN_COACHES_LABEL} · ${single.name}` : `${ASSIGN_COACHES_LABEL} · ${members.length} מתאמנים`;
  // A fresh panel per opening and per trainee set, so nothing from the last one leaks in.
  const [opening, setOpening] = useState(0);
  useEffect(() => { if (open) setOpening((n) => n + 1); }, [open]);
  const key = `${opening}:${members.map((m) => `${m.athleteId}=${memberCoachIds(m).join('+')}`).join(',')}`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" title={title}>
      {members.length > 0 && (
        <CoachAssignPanel
          key={key}
          members={members}
          coaches={coaches}
          multiCoach={multiCoach}
          onDone={onDone}
          onSaved={() => onOpenChange(false)}
        />
      )}
    </Sheet>
  );
}

// ── להוסיף מתאמן, to one coach ───────────────────────────────────────────────

/**
 * The coaches board's "להוסיף מתאמן": pick any trainees, and this coach joins
 * their coaches — added, never replacing the coaches they already have.
 */
export function AddTraineesToCoachSheet({
  coach, onOpenChange, members, onDone,
}: {
  coach: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  members: AcademyMember[];
  onDone: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (coach) { setQuery(''); setPicked([]); setError(null); } }, [coach]);
  const list = useMemo(() => {
    if (!coach) return [];
    const q = query.trim().toLowerCase();
    return traineesToAdd(coach.id, members).filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [coach, members, query]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    if (!coach || !picked.length) return;
    setBusy(true);
    setError(null);
    const r = await postBulk(addToCoachBody(coach.id, picked));
    setBusy(false);
    if (!r.ok) { setError(r.error || 'השמירה נכשלה'); if (r.failed < picked.length) await onDone(); return; }
    await onDone();
    onOpenChange(false);
  };

  return (
    <Sheet open={!!coach} onOpenChange={onOpenChange} className="bg-page" title={coach ? `להוסיף מתאמנים ל־${coach.name}` : ''}>
      <div className="pb-2" dir="rtl">
        <p className="-mt-1 mb-3 px-1 text-xs text-ink-400">המאמנים שכבר יש להם נשארים. {coach ? firstName(coach.name) : ''} מצטרף אליהם.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מתאמן" aria-label="חיפוש מתאמן"
            className="w-full min-h-[44px] rounded-xl bg-card ps-9 pe-3 text-[16px] text-ink-700 placeholder:text-ink-400 focus:outline-none" />
        </div>
        <div className="max-h-[46vh] overflow-y-auto rounded-card bg-card divide-y divide-page">
          {list.length === 0 && <p className="px-4 py-5 text-center text-sm text-ink-400">{query ? 'אין התאמה' : 'כל המתאמנים כבר אצלו'}</p>}
          {list.map((m) => {
            const on = picked.includes(m.athleteId);
            const names = bidiNames(memberCoachNames(m).filter(Boolean).map(firstName));
            return (
              <button key={m.athleteId} type="button" onClick={() => toggle(m.athleteId)} aria-pressed={on}
                className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60">
                <Checkbox on={on} />
                <Avatar name={m.name} url={m.avatarUrl} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink-700" dir="auto">{m.name}</span>
                  <span className={cn('block truncate text-xs', names ? 'text-ink-400' : 'font-bold text-band-3-ink')} dir="auto">{names ? `אצל ${names}` : 'בלי מאמן'}</span>
                </span>
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 px-1 text-sm text-accent-red-ink" role="alert">{error}</p>}
        <PrimaryButton onClick={() => void submit()} disabled={!picked.length} busy={busy}>
          {!picked.length ? 'בוחרים מתאמנים' : picked.length === 1 ? `להוסיף מתאמן אחד ל־${firstName(coach?.name)}` : `להוסיף ${picked.length} מתאמנים ל־${firstName(coach?.name)}`}
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
  open, onOpenChange, addable, coaches, bands, multiCoach, onDone, onOpenFunnel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Approved club members not in the academy. Undefined while loading. */
  addable: AddableMember[] | undefined;
  coaches: AcademyCoachSummary[];
  bands: AcademyBand[];
  /** `false` before migration 135: one coach to start with. */
  multiCoach?: boolean;
  onDone: () => void | Promise<void>;
  onOpenFunnel?: (candidateId: string) => void;
}) {
  const [segment, setSegment] = useState<'club' | 'new'>('club');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const assignable = useMemo(() => coaches.filter((c) => c.coachId).sort((a, b) => a.trainees - b.trainees), [coaches]);
  // "ישר כמתאמן" starts with one or more coaches (all equal), or none.
  const [coachIds, setCoachIds] = useState<string[]>([]);
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
    setCoachIds(assignable[0]?.coachId ? [assignable[0].coachId] : []);
    setName(''); setPhone(''); setEmail(''); setInvite(null); setMailState('idle'); setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (addable ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 30);
  }, [addable, query]);
  const person = (addable ?? []).find((a) => a.athleteId === chosen) ?? null;
  const coachNamesPicked = coachIds.map((id) => assignable.find((c) => c.coachId === id)?.coachName || '').filter(Boolean);
  const band = bands.find((b) => b.id === bandId) ?? null;

  const addClubMember = async () => {
    if (!person) return;
    setBusy(true);
    setMessage(null);
    if (mode === 'direct') {
      const r = await postBulk({ athleteIds: [person.athleteId], action: 'add', coachIds, bandId, notify: true });
      setBusy(false);
      if (!r.ok) { setMessage({ ok: false, text: r.error || 'ההוספה נכשלה' }); return; }
      await onDone();
      setMessage({ ok: true, text: `${person.name} באקדמיה${coachNamesPicked.length ? `, אצל ${joinHebrewList(coachNamesPicked)}` : ''}` });
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
            {picker === 'coach' ? (
              <div>
                <p className="mb-1.5 px-1 text-xs text-ink-400">{multiCoach === false ? 'בוחרים מאמן.' : 'אפשר לבחור אחד או יותר, או אף אחד ולשבץ אחר כך.'}</p>
                <CoachesPicker
                  coaches={assignable}
                  value={coachIds}
                  onChange={setCoachIds}
                  sets={[[]]}
                  multi={multiCoach !== false}
                  exclude={chosen ? [chosen] : []}
                  onCoachMade={onDone}
                />
                <button type="button" onClick={() => setPicker(null)}
                  className="mt-2 flex w-full min-h-[48px] items-center justify-center rounded-2xl bg-card text-sm font-extrabold text-brand-600">
                  {coachIds.length === 0 ? 'סיום · בלי מאמן' : coachIds.length === 1 ? 'סיום · מאמן אחד' : `סיום · ${coachIds.length} מאמנים`}
                </button>
              </div>
            ) : picker ? (
              <div className="max-h-[220px] overflow-y-auto rounded-card bg-card divide-y divide-page">
                {picker === 'band' && [...sortBands(bands).map((b) => ({ id: b.id as string | null, label: b.name, sub: b.goal || '' })), { id: null, label: 'בלי דבוקה', sub: 'לקבוע אחרי הטסט' }]
                  .map((o) => (
                    <button key={o.id ?? 'none'} type="button" onClick={() => { setBandId(o.id); setPicker(null); }}
                      className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
                      <Radio on={bandId === o.id} />
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-700">{o.label}</span>{o.sub && <span className="block truncate text-xs text-ink-400">{o.sub}</span>}</span>
                    </button>
                  ))}
                {picker === 'mode' && ([
                  { id: 'direct' as const, label: 'ישר כמתאמן', sub: 'נכנס לאקדמיה עכשיו, עם המאמנים והדבוקה' },
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
                    <SettingRow label="מאמנים" value={coachNamesPicked.length ? bidiNames(coachNamesPicked.map(firstName)) : 'בלי מאמן'} onChange={() => setPicker('coach')} action={ASSIGN_COACHES_LABEL} />
                    <SettingRow label="דבוקה" value={band?.name || 'בלי דבוקה'} onChange={() => setPicker('band')} />
                  </>
                )}
                <SettingRow label="שלב" value={mode === 'direct' ? 'ישר כמתאמן' : 'כמועמד'} onChange={() => setPicker('mode')} />
              </div>
            )}
            <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">
              {mode === 'direct'
                ? '״ישר כמתאמן״ מדלג על המשפך, ושולח לו ולמאמנים הודעה. או ״כמועמד״ כדי לעבור שיחה וטסט קודם.'
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

function SettingRow({ label, value, onChange, action = 'שינוי' }: { label: string; value: string; onChange: () => void; action?: string }) {
  return (
    <button type="button" onClick={onChange} className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
      <span className="flex-1 text-[15px] font-semibold text-ink-700">{label}</span>
      <span className="truncate text-sm font-bold text-ink-500" dir="auto">{value}</span>
      <span className="shrink-0 text-[13px] font-extrabold text-brand-600">{action}</span>
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
