'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, ChevronLeft, MessageSquare, Plus, Search, Send, UserPlus, Users, Watch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Sheet, Spinner } from '@/components/ui';
import { freeSeats, recommendCoach, type Suggestion } from '@/lib/academy/suggestions';
import type { CandidateRow } from '@/lib/academy/funnel';
import { postBulk } from './ManageMembersSheets';
import { initialsOf, type AcademyCoachSummary, type AcademyMember } from './types';
import { joinHebrewList, memberCoachIds, memberCoachNames } from '@/lib/academy/members';

// The academy's quick sheets (mockup academy-manager-v5.html, phones 5 and 6):
//
//   QuickActionSheet   "מה לעשות?" — four actions, short steps, the free coach
//                      marked "פנוי · מומלץ"
//   SuggestionSheet    the ⋯ on a smart suggestion: another coach, one by one,
//                      open each person, remind me tomorrow, don't suggest again
//   PeopleSearchSheet  one search over trainees, candidates and coaches, opened
//                      from the title row of every area
//   CoachPicker        the coach list with seats, shared by the first two
//
// Every write is POST /api/academy/members/bulk (postBulk), the same path the
// members tab uses, so a move made here leaves the same history.

const VIOLET = '#5B21D6';
/** Long enough for a closing sheet's slide before the next one opens (see AcademyAdmin). */
export const SHEET_HANDOFF_MS = 350;

const first = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';
/** "Dana ו־Guy" — every coach of the trainee, first names (a shared trainee has several). */
const coachFirstNames = (m: AcademyMember) => joinHebrewList(memberCoachNames(m).filter(Boolean).map((n) => first(n)));
const coachLine = (m: AcademyMember) => (coachFirstNames(m) ? `אצל ${coachFirstNames(m)}` : 'בלי מאמן');

function Radio({ on }: { on: boolean }) {
  return <span aria-hidden className={cn('h-[22px] w-[22px] shrink-0 rounded-full border-2 transition-all', on ? 'border-[7px] border-brand-600' : 'border-ink-300')} />;
}

function Face({ name, coach, size = 30, bg }: { name: string; coach?: boolean; size?: number; bg?: string }) {
  return (
    <span style={{ width: size, height: size, background: bg }}
      className={cn('grid shrink-0 place-items-center rounded-full text-[10px] font-black', coach ? 'bg-brand-600 text-white' : 'bg-brand-600/15 text-brand-600')}>
      {initialsOf(name)}
    </span>
  );
}

function Cta({ children, onClick, disabled, busy }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[15.5px] font-black text-white shadow-[0_8px_18px_rgba(21,37,255,.25)] disabled:opacity-50 disabled:shadow-none">
      {busy && <Spinner size={16} tone="ink" />}
      {children}
    </button>
  );
}

function Crumbs({ items }: { items: Array<{ label: string; state: 'done' | 'on' | 'todo' }> }) {
  return (
    <div className="mb-0.5 mt-1.5 flex flex-wrap gap-1.5">
      {items.map((c, i) => (
        <span key={i} className={cn('rounded-pill px-2.5 py-1 text-xs font-extrabold',
          c.state === 'done' ? 'bg-accent-600/15 text-accent-900' : c.state === 'on' ? 'bg-brand-600 text-white' : 'bg-card text-ink-400')}
          dir="auto">
          {c.state === 'done' ? '✓ ' : ''}{c.label}
        </span>
      ))}
    </div>
  );
}

// ── Coach picker ────────────────────────────────────────────────────────────

export function CoachPicker({ coaches, capacity, need = 1, value, onChange, currentCoachId = null }: {
  coaches: AcademyCoachSummary[];
  capacity: number;
  /** How many trainees are being placed, for the recommendation. */
  need?: number;
  value: string | null;
  onChange: (coachId: string) => void;
  currentCoachId?: string | null;
}) {
  const real = coaches.filter((c) => c.coachId);
  const rec = recommendCoach(real, capacity, need);
  const ordered = [...real].sort((a, b) =>
    Number(b.coachId === rec?.coachId) - Number(a.coachId === rec?.coachId)
    || freeSeats(b, capacity) - freeSeats(a, capacity) || (a.coachName || '').localeCompare(b.coachName || ''));
  if (!real.length) {
    return <p className="mt-2.5 rounded-2xl bg-card px-4 py-4 text-sm text-ink-500">עוד אין מאמנים באקדמיה. מוסיפים מאמן מ״מאמן חדש״.</p>;
  }
  return (
    <div className="mt-2.5 overflow-hidden rounded-2xl bg-card">
      {ordered.map((c) => {
        const free = freeSeats(c, capacity);
        const on = value === c.coachId;
        return (
          <button key={c.coachId} type="button" onClick={() => onChange(c.coachId!)} aria-pressed={on}
            className="flex min-h-[52px] w-full items-center gap-2.5 border-b border-page/70 px-3 text-start last:border-0 active:bg-page/40">
            <Radio on={on} />
            <Face name={c.coachName || ''} coach />
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ink-700" dir="auto">
              {c.coachName}{c.coachId === currentCoachId ? <span className="font-semibold text-ink-400"> · היום</span> : null}
            </span>
            {c.coachId === rec?.coachId ? (
              <span className="shrink-0 rounded-[7px] bg-accent-600/15 px-1.5 py-0.5 text-2xs font-black text-accent-900">פנוי · מומלץ</span>
            ) : (
              <span className={cn('shrink-0 text-xs tabular-nums', free === 0 ? 'font-bold text-accent-red-ink' : 'text-ink-400')}>
                {free === 0 ? 'מלא · ' : ''}<bdi dir="ltr">{c.trainees}/{capacity}</bdi>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Quick action ────────────────────────────────────────────────────────────

export type QuickFlow = 'menu' | 'move';

export function QuickActionSheet({
  open, onOpenChange, start = 'menu', coachPreset = null, members, coaches, capacity, onDone, onAddTrainee, onNewCoach, onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open on the menu, or straight into "change coach". */
  start?: QuickFlow;
  /** "לשבץ אליו" on a coach: that coach is preselected instead of the recommended one. */
  coachPreset?: string | null;
  members: AcademyMember[];
  coaches: AcademyCoachSummary[];
  capacity: number;
  onDone: () => void | Promise<void>;
  /** The three actions that live in existing sheets; the shell opens them after this one closes. */
  onAddTrainee: () => void;
  onNewCoach: () => void;
  onInvite: () => void;
}) {
  const [flow, setFlow] = useState<QuickFlow>('menu');
  const [step, setStep] = useState<'pick' | 'coach'>('pick');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFlow(start); setStep('pick'); setQuery(''); setPicked([]); setCoachId(null); setError(null);
  }, [open, start]);

  const approved = useMemo(() => members.filter((m) => m.approved), [members]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = approved.filter((m) => !q || m.name.toLowerCase().includes(q));
    // The unpaired first: they are who "change coach" is most often for.
    return list.sort((a, b) => Number(memberCoachIds(a).length > 0) - Number(memberCoachIds(b).length > 0) || a.name.localeCompare(b.name));
  }, [approved, q]);
  const pickedMembers = approved.filter((m) => picked.includes(m.athleteId));
  const handOff = (fn: () => void) => { onOpenChange(false); setTimeout(fn, SHEET_HANDOFF_MS); };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const startMove = (ids: string[] = []) => { setFlow('move'); setPicked(ids); setStep(ids.length ? 'coach' : 'pick'); setQuery(''); };
  const coach = coaches.find((c) => c.coachId === coachId) ?? null;
  const rec = recommendCoach(coaches.filter((c) => c.coachId), capacity, Math.max(1, picked.length));
  // The recommended coach is preselected the moment the coach step opens.
  useEffect(() => {
    if (flow === 'move' && step === 'coach' && !coachId && (coachPreset || rec?.coachId)) setCoachId(coachPreset || rec!.coachId);
  }, [flow, step, coachId, rec, coachPreset]);

  const submit = async () => {
    if (!coachId || !picked.length) return;
    setBusy(true); setError(null);
    const r = await postBulk({ athleteIds: picked, action: 'coach', coachId, notify: true });
    setBusy(false);
    if (!r.ok) { setError(r.error || 'השמירה נכשלה'); return; }
    await onDone();
    onOpenChange(false);
  };

  const single = pickedMembers.length === 1 ? pickedMembers[0] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" titleClassName="text-start"
      title={flow === 'menu' ? 'מה לעשות?' : 'להחליף מאמן'}>
      <div className="pb-2" dir="rtl">
        {flow === 'menu' ? (
          <>
            <p className="-mt-1 mb-2.5 text-[12.5px] text-ink-400">אפשר גם לחפש שם ולבחור פעולה</p>
            <SearchField value={query} onChange={setQuery} placeholder="חיפוש אדם…" />
            {q ? (
              <div className="mt-2.5 max-h-[40vh] overflow-y-auto rounded-2xl bg-card">
                {matches.slice(0, 8).map((m) => (
                  <button key={m.athleteId} type="button" onClick={() => startMove([m.athleteId])}
                    className="flex min-h-[52px] w-full items-center gap-2.5 border-b border-page/70 px-3 text-start last:border-0 active:bg-page/40">
                    <Face name={m.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold text-ink-700" dir="auto">{m.name}</span>
                      <span className="block text-2xs text-ink-400">{coachLine(m)}</span>
                    </span>
                    <span className="shrink-0 text-xs font-extrabold text-brand-600">להחליף מאמן</span>
                  </button>
                ))}
                {matches.length === 0 && <p className="px-4 py-4 text-sm text-ink-400">לא נמצא מתאמן בשם הזה</p>}
              </div>
            ) : (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <MenuTile icon={Plus} bg="bg-brand-600" title="להוסיף מתאמן" sub="מהמועדון או חדש" onClick={() => handOff(onAddTrainee)} />
                <MenuTile icon={ArrowLeftRight} bg="bg-accent-700" title="להחליף מאמן" sub="לאחד או לכמה" onClick={() => startMove()} />
                <MenuTile icon={UserPlus} bgStyle={VIOLET} title="מאמן חדש" sub="חבר מועדון כמאמן" onClick={() => handOff(onNewCoach)} />
                <MenuTile icon={Send} bgStyle="#E57A1F" title="להזמין לטופס" sub="קישור בוואטסאפ" onClick={() => handOff(onInvite)} />
              </div>
            )}
          </>
        ) : step === 'pick' ? (
          <>
            <Crumbs items={[{ label: 'מתאמנים', state: 'on' }, { label: 'מאמן', state: 'todo' }]} />
            <div className="mt-2"><SearchField value={query} onChange={setQuery} placeholder="חיפוש מתאמן…" /></div>
            <div className="mt-2.5 max-h-[42vh] overflow-y-auto rounded-2xl bg-card">
              {matches.map((m) => {
                const on = picked.includes(m.athleteId);
                return (
                  <button key={m.athleteId} type="button" onClick={() => toggle(m.athleteId)} aria-pressed={on}
                    className="flex min-h-[52px] w-full items-center gap-2.5 border-b border-page/70 px-3 text-start last:border-0 active:bg-page/40">
                    <span className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border-2', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')}>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <Face name={m.name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ink-700" dir="auto">{m.name}</span>
                    <span className={cn('shrink-0 text-2xs', memberCoachIds(m).length ? 'text-ink-400' : 'font-bold text-band-3-ink')}>
                      {coachFirstNames(m) || 'בלי מאמן'}
                    </span>
                  </button>
                );
              })}
            </div>
            <Cta onClick={() => setStep('coach')} disabled={!picked.length}>
              {picked.length ? `הבא · מאמן ל־${picked.length === 1 ? first(pickedMembers[0]?.name) : `${picked.length} מתאמנים`}` : 'בוחרים מתאמן אחד או יותר'}
            </Cta>
          </>
        ) : (
          <>
            <Crumbs items={[
              { label: single ? single.name : `${picked.length} מתאמנים`, state: 'done' },
              { label: 'מאמן', state: 'on' },
            ]} />
            <CoachPicker coaches={coaches} capacity={capacity} need={picked.length} value={coachId} onChange={setCoachId}
              currentCoachId={single?.academyCoachId ?? null} />
            {coach && freeSeats(coach, capacity) < picked.length && (
              <p className="mt-2 px-1 text-xs text-band-3-ink">
                ל־{first(coach.coachName)} נשארו <bdi dir="ltr">{freeSeats(coach, capacity)}</bdi> מקומות. אפשר לשבץ בכל זאת.
              </p>
            )}
            {error && <p className="mt-2 px-1 text-sm text-accent-red-ink">{error}</p>}
            <Cta onClick={() => void submit()} disabled={!coachId || (!!single && memberCoachIds(single).length === 1 && memberCoachIds(single)[0] === coachId)} busy={busy}>
              {coach ? `להעביר ל־${first(coach.coachName)}` : 'בוחרים מאמן'}
            </Cta>
            <button type="button" onClick={() => setStep('pick')} className="mt-1 min-h-[44px] w-full text-sm font-bold text-brand-600">חזרה לבחירת מתאמנים</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function MenuTile({ icon: Icon, bg, bgStyle, title, sub, onClick }: {
  icon: React.ComponentType<{ className?: string }>; bg?: string; bgStyle?: string; title: string; sub: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[60px] items-center gap-2.5 rounded-2xl bg-card p-3 text-start active:bg-card/70">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white', bg)} style={bgStyle ? { background: bgStyle } : undefined}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-extrabold leading-tight text-ink-700">{title}</span>
        <small className="block text-2xs font-semibold text-ink-400">{sub}</small>
      </span>
    </button>
  );
}

function SearchField({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 rounded-[14px] bg-card px-3">
      <Search className="h-4 w-4 shrink-0 text-ink-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="min-w-0 flex-1 bg-transparent text-base text-ink-700 outline-none placeholder:text-ink-400" dir="auto" aria-label={placeholder} />
    </label>
  );
}

// ── ⋯ on a suggestion ───────────────────────────────────────────────────────

export function SuggestionSheet({
  suggestion, onOpenChange, members, coaches, capacity, onDone, onOpenMember, onOpenThread, onOpenDispatch, onSnooze, onDismiss,
}: {
  suggestion: Suggestion | null;
  onOpenChange: (open: boolean) => void;
  members: AcademyMember[];
  coaches: AcademyCoachSummary[];
  capacity: number;
  onDone: () => void | Promise<void>;
  onOpenMember: (athleteId: string) => void;
  onOpenThread: (athleteId: string) => void;
  onOpenDispatch: () => void;
  onSnooze: (key: string) => void;
  onDismiss: (key: string) => void;
}) {
  const open = !!suggestion;
  // Kept while the sheet slides away, so its content doesn't blank mid-close.
  const [shown, setShown] = useState<Suggestion | null>(suggestion);
  if (suggestion && suggestion !== shown) setShown(suggestion);
  const s = suggestion ?? shown;
  const [mode, setMode] = useState<'menu' | 'other' | 'each'>('menu');
  const [eachFor, setEachFor] = useState<string | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setMode('menu'); setEachFor(null); setCoachId(null); setError(null); setPlaced({}); } }, [open, suggestion?.key]);

  if (!s) return null;
  const byId = new Map(members.map((m) => [m.athleteId, m]));
  const close = () => onOpenChange(false);
  const handOff = (fn: () => void) => { close(); setTimeout(fn, SHEET_HANDOFF_MS); };
  const suggested = coaches.find((c) => c.coachId === s.coachId) ?? null;

  const assign = async (ids: string[], to: string) => {
    setBusy(true); setError(null);
    const r = await postBulk({ athleteIds: ids, action: 'coach', coachId: to, notify: true });
    setBusy(false);
    if (!r.ok) { setError(r.error || 'השמירה נכשלה'); return false; }
    await onDone();
    return true;
  };

  const title = s.kind === 'pair'
    ? `שיבוץ ל־${s.people.map((p) => first(p.name)).join(' ול־')}`
    : s.kind === 'write' ? `שיחה עם ${first(s.people[0]?.name)}` : 'אימונים שלא הגיעו לשעון';
  const sub = s.kind === 'pair' && suggested
    ? <>ההצעה: {suggested.coachName}, הפנוי ביותר (<bdi dir="ltr">{suggested.trainees}</bdi> מתוך <bdi dir="ltr">{capacity}</bdi>)</>
    : s.sub;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" titleClassName="text-start" title={title}>
      <div className="pb-2" dir="rtl">
        <p className="-mt-1 mb-1 text-[12.5px] text-ink-400" dir="auto">{sub}</p>
        {mode === 'menu' && (
          <>
            <div className="mt-2.5 overflow-hidden rounded-2xl bg-card">
              {s.kind === 'pair' && (
                <>
                  <MenuRow icon={ArrowLeftRight} bg="bg-accent-700" title="לבחור מאמן אחר" sub="כל המאמנים עם המקומות הפנויים" onClick={() => setMode('other')} />
                  {s.people.length > 1 && (
                    <MenuRow icon={Users} bg="bg-brand-600" title="לשבץ כל אחד בנפרד" sub="מאמן אחר לכל מתאמן" onClick={() => setMode('each')} />
                  )}
                </>
              )}
              {s.kind === 'write' && (
                <MenuRow icon={MessageSquare} bg="bg-brand-600" title="לפתוח את השיחה" sub="לכתוב לו עכשיו" onClick={() => handOff(() => onOpenThread(s.people[0].id))} />
              )}
              {s.kind === 'resend' && (
                <MenuRow icon={Watch} bg="bg-accent-red" title="לשעונים" sub="מי לא קיבל, ולמה" onClick={() => handOff(onOpenDispatch)} />
              )}
              {s.people.map((p) => {
                const m = byId.get(p.id);
                return (
                  <MenuRow key={p.id} face={p.name} title={`לפתוח את ${p.name}`}
                    sub={m ? [coachFirstNames(m) ? `אצל ${coachFirstNames(m)}` : null, m.band ? m.band.name : 'דבוקה עוד לא נקבעה'].filter(Boolean).join(' · ') : ''}
                    onClick={() => handOff(() => onOpenMember(p.id))} />
                );
              })}
            </div>
            <div className="mt-2.5 overflow-hidden rounded-2xl bg-card">
              <button type="button" onClick={() => { onSnooze(s.key); close(); }} className="flex min-h-[56px] w-full items-center border-b border-page/70 px-3.5 text-start text-[14.5px] font-bold text-ink-700">להזכיר לי מחר</button>
              <button type="button" onClick={() => { onDismiss(s.key); close(); }} className="flex min-h-[56px] w-full items-center px-3.5 text-start text-[14.5px] font-bold text-accent-red-ink">לא להציע את זה שוב</button>
            </div>
          </>
        )}

        {mode === 'other' && (
          <>
            <CoachPicker coaches={coaches} capacity={capacity} need={s.people.length} value={coachId} onChange={setCoachId} />
            {error && <p className="mt-2 px-1 text-sm text-accent-red-ink">{error}</p>}
            <Cta busy={busy} disabled={!coachId}
              onClick={async () => { if (coachId && await assign(s.people.map((p) => p.id), coachId)) close(); }}>
              {coachId ? `לשבץ אצל ${first(coaches.find((c) => c.coachId === coachId)?.coachName)}` : 'בוחרים מאמן'}
            </Cta>
            <button type="button" onClick={() => setMode('menu')} className="mt-1 min-h-[44px] w-full text-sm font-bold text-brand-600">חזרה</button>
          </>
        )}

        {mode === 'each' && (
          eachFor ? (
            <>
              <Crumbs items={[{ label: s.people.find((p) => p.id === eachFor)?.name || '', state: 'done' }, { label: 'מאמן', state: 'on' }]} />
              <CoachPicker coaches={coaches} capacity={capacity} value={coachId} onChange={setCoachId} />
              {error && <p className="mt-2 px-1 text-sm text-accent-red-ink">{error}</p>}
              <Cta busy={busy} disabled={!coachId}
                onClick={async () => {
                  if (!coachId || !(await assign([eachFor], coachId))) return;
                  const next = { ...placed, [eachFor]: coachId };
                  setPlaced(next); setEachFor(null); setCoachId(null);
                  if (s.people.every((p) => next[p.id])) close();
                }}>
                לשבץ
              </Cta>
            </>
          ) : (
            <>
              <div className="mt-2.5 overflow-hidden rounded-2xl bg-card">
                {s.people.map((p) => {
                  const to = placed[p.id] ? coaches.find((c) => c.coachId === placed[p.id]) : null;
                  return (
                    <MenuRow key={p.id} face={p.name} title={p.name}
                      sub={to ? `✓ אצל ${to.coachName}` : 'לבחור מאמן'}
                      onClick={() => { if (!to) { setEachFor(p.id); setCoachId(null); } }} />
                  );
                })}
              </div>
              <button type="button" onClick={() => setMode('menu')} className="mt-1 min-h-[44px] w-full text-sm font-bold text-brand-600">חזרה</button>
            </>
          )
        )}
      </div>
    </Sheet>
  );
}

function MenuRow({ icon: Icon, bg, face, title, sub, onClick }: {
  icon?: React.ComponentType<{ className?: string }>; bg?: string; face?: string; title: string; sub?: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3 border-b border-page/70 px-3.5 text-start last:border-0 active:bg-page/40">
      {Icon ? (
        <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-white', bg)}><Icon className="h-4 w-4" /></span>
      ) : face ? (
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[#8A8B96] text-[10px] font-black text-white">{initialsOf(face)}</span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold text-ink-700" dir="auto">{title}</span>
        {sub && <small className="block truncate text-2xs font-semibold text-ink-400" dir="auto">{sub}</small>}
      </span>
      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
    </button>
  );
}

// ── People search ───────────────────────────────────────────────────────────

export type SearchHit =
  | { kind: 'trainee'; id: string }
  | { kind: 'candidate'; id: string }
  | { kind: 'coach'; id: string };

/**
 * One search, the same on every area: trainees, and — for the manager —
 * candidates and coaches. What a hit opens is the caller's call (`onPick`), so
 * on שיחות a trainee opens their thread and on תוכניות their plan, while the
 * sheet itself stays one component.
 */
export function PeopleSearchSheet({ open, onOpenChange, members, coaches, isManager, onPick, hint }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: AcademyMember[];
  coaches: AcademyCoachSummary[];
  isManager: boolean;
  onPick: (hit: SearchHit) => void;
  /** What a tap on a trainee does here, e.g. "פותח את השיחה". */
  hint?: string;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (open) setQuery(''); }, [open]);
  const { data: funnel } = useApi<{ candidates: CandidateRow[] }>(open && isManager ? '/api/academy/candidates' : null);
  const q = query.trim().toLowerCase();
  const has = (name: string | null | undefined) => !q || (name || '').toLowerCase().includes(q);

  const trainees = members.filter((m) => has(m.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, q ? 12 : 6);
  const candidates = isManager
    ? (funnel?.candidates ?? []).filter((c) => !c.archivedAt && has(c.name)).slice(0, q ? 8 : 3)
    : [];
  const coachHits = isManager ? coaches.filter((c) => c.coachId && has(c.coachName)).slice(0, 6) : [];
  const pick = (hit: SearchHit) => { onOpenChange(false); setTimeout(() => onPick(hit), SHEET_HANDOFF_MS); };
  const none = !trainees.length && !candidates.length && !coachHits.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="bg-page" titleClassName="text-start" title="חיפוש">
      <div className="pb-2" dir="rtl">
        <SearchField value={query} onChange={setQuery} placeholder={isManager ? 'מתאמן, מועמד או מאמן' : 'חיפוש מתאמן'} autoFocus />
        {hint && <p className="mt-1.5 px-1 text-2xs text-ink-400">{hint}</p>}
        <div className="mt-2 max-h-[55vh] space-y-2.5 overflow-y-auto">
          {trainees.length > 0 && (
            <HitGroup title="מתאמנים">
              {trainees.map((m) => (
                <HitRow key={m.athleteId} name={m.name} sub={coachLine(m)} onClick={() => pick({ kind: 'trainee', id: m.athleteId })} />
              ))}
            </HitGroup>
          )}
          {candidates.length > 0 && (
            <HitGroup title="מועמדים">
              {candidates.map((c) => <HitRow key={c.id} name={c.name} sub="בדרך פנימה" onClick={() => pick({ kind: 'candidate', id: c.id })} violet />)}
            </HitGroup>
          )}
          {coachHits.length > 0 && (
            <HitGroup title="מאמנים">
              {coachHits.map((c) => (
                <HitRow key={c.coachId} name={c.coachName || ''} coach sub={c.trainees === 0 ? 'אין מתאמנים' : `${c.trainees} מתאמנים`} onClick={() => pick({ kind: 'coach', id: c.coachId! })} />
              ))}
            </HitGroup>
          )}
          {none && <p className="py-6 text-center text-sm text-ink-400">לא נמצא</p>}
        </div>
      </div>
    </Sheet>
  );
}

function HitGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1 px-1 text-2xs font-bold text-ink-400">{title}</p>
      <div className="overflow-hidden rounded-2xl bg-card">{children}</div>
    </section>
  );
}

function HitRow({ name, sub, coach, violet, onClick }: { name: string; sub: string; coach?: boolean; violet?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-2.5 border-b border-page/70 px-3 text-start last:border-0 active:bg-page/40">
      <Face name={name} coach={coach} size={34} bg={violet ? '#EFE8FF' : undefined} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-ink-700" dir="auto">{name}</span>
        <span className="block truncate text-2xs text-ink-400" dir="auto">{sub}</span>
      </span>
      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
    </button>
  );
}
