'use client';

import { useMemo, useState } from 'react';
import { Banknote, ChevronLeft, Eye, KeyRound, Link2, ListChecks, Search, Settings2, UsersRound } from 'lucide-react';
import { openViewAsChooser } from '@/lib/view-as-person';
import { useIsSuperUser } from '@/lib/impersonation';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, InsetRow, InsetSection, Sheet, Switch } from '@/components/ui';
import type { AcademyCoachesResponse } from '@/app/api/academy/coaches/route';
import { fmtRate, initialsOf, type AcademyMember } from './types';
import { coachNameAmong, memberCoachIds, memberHasCoach } from '@/lib/academy/members';

/**
 * The academy manager's controls, behind the ⚙ on the academy home so the home
 * itself stays one screen of trainees. The hierarchy (2026-10-06):
 *
 *   admin            names academy managers — the roles screen, admin only
 *   academy manager  everything here: registration, coaches, settings
 *   academy coach    never sees this; their academy is their own trainees
 *
 * The green dot on the gear says registration is open, so the one setting that
 * faces the public is visible without opening anything.
 */
/** Long enough for the closing sheet's slide (vaul's is ~0.5s, cut short by the overlay fade). */
const SHEET_HANDOFF_MS = 350;

export function AcademyAdminButton({
  onOpenCoaches,
  onOpenSettings,
  onOpenPayments,
  canEditRoles,
  members = [],
  onGoTab = () => {},
}: {
  onOpenCoaches: () => void;
  onOpenSettings: () => void;
  /** Payments is parked (2026-09-20) but stays reachable, here, for the manager only. */
  onOpenPayments?: () => void;
  canEditRoles: boolean;
  /** For "view as": the trainees to pick from. */
  members?: AcademyMember[];
  /** The test script's buttons open these tabs. */
  onGoTab?: (tab: 'funnel' | 'plans' | 'members') => void;
}) {
  const [open, setOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const isSuper = useIsSuperUser();
  // "View as" is the app's one mechanism now (lib/view-as-person.ts): this opens
  // the eye button's chooser on its person tab, and it is any admin's.
  const canViewAs = isSuper || canEditRoles;
  // One sheet at a time: the next one opens once this one has slid away. Opened in
  // the same tick, the drawer library drops the second open while the first is
  // still closing, and the tap appears to do nothing.
  const handOff = (next: () => void) => {
    setOpen(false);
    setTimeout(next, SHEET_HANDOFF_MS);
  };
  const { data: reg } = useApi<{ open: boolean }>('/api/academy/registration');

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="ניהול האקדמיה"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink-700 active:bg-page"
      >
        <Settings2 className="h-5 w-5" />
        {reg && (
          <span
            className={cn('absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-page', reg.open ? 'bg-accent-600' : 'bg-ink-300')}
            aria-hidden
          />
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="ניהול האקדמיה">
        <div className="space-y-4">
          <RegistrationSwitch />
          <InsetSection className="mb-0">
            <InsetRow
              icon={UsersRound}
              iconBg="bg-brand-600"
              label="מאמני האקדמיה"
              sublabel="להוסיף, להסיר, לראות מתאמנים"
              onClick={() => handOff(onOpenCoaches)}
            />
            <InsetRow
              icon={Settings2}
              iconBg="bg-ink-500"
              label="הגדרות האקדמיה"
              onClick={() => { setOpen(false); onOpenSettings(); }}
            />
            {onOpenPayments && (
              <InsetRow
                icon={Banknote}
                iconBg="bg-accent-700"
                label="תשלומים"
                sublabel="הוראות קבע ושכר מאמנים · רק אתה"
                onClick={() => { setOpen(false); onOpenPayments(); }}
              />
            )}
            {canEditRoles && (
              <InsetRow icon={KeyRound} iconBg="bg-ink-700" label="תפקידים" sublabel="מנהלי אקדמיה · לאדמין בלבד" href="/dashboard/roles" />
            )}
          </InsetSection>
          <InsetSection className="mb-0">
            <InsetRow icon={ListChecks} iconBg="bg-accent-600" label="בדיקת האקדמיה" sublabel="שלב אחרי שלב, עם מתאמנים אמיתיים"
              onClick={() => handOff(() => setTestOpen(true))} />
            {canViewAs && (
              <InsetRow icon={Eye} iconBg="bg-[#B45309]" label="להתחבר בתור מאמן או מתאמן" sublabel="כל האפליקציה, בדיוק מה שהם רואים"
                onClick={() => handOff(() => openViewAsChooser('person'))} />
            )}
          </InsetSection>
        </div>
      </Sheet>
      <AcademyTestScript
        open={testOpen}
        onOpenChange={setTestOpen}
        members={members}
        onGoTab={onGoTab}
        onViewAs={canViewAs ? () => openViewAsChooser('person') : undefined}
      />
    </>
  );
}

/**
 * The academy's coaches: who they are, how many each holds, a coach's caseload on
 * a tap, and adding or removing the role (PUT /api/academy/coaches — that route
 * touches `academy_coach` only). A coach who still holds trainees can't be removed
 * until they've been moved, which the button says rather than failing.
 */
export function CoachesSheet({
  open,
  onOpenChange,
  members,
  onSelectMember,
  focusCoach = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: AcademyMember[];
  onSelectMember: (member: AcademyMember) => void;
  /** Open straight on this coach's caseload (a tap on the home's coaches row). */
  focusCoach?: string | null;
}) {
  const { data, mutate } = useApi<AcademyCoachesResponse>(open ? '/api/academy/coaches' : null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [caseloadOf, setCaseloadOf] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // A new focus opens on that coach; closing the caseload returns to the list.
  if (open && focusCoach && focused !== focusCoach) { setFocused(focusCoach); setCaseloadOf(focusCoach); }
  if (!open && focused) setFocused(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    return data.candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, data]);

  const setCoach = async (athleteId: string, coach: boolean) => {
    setBusy(athleteId);
    setFailed(null);
    try {
      const res = await fetch('/api/academy/coaches', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId, coach }),
      });
      if (!res.ok) throw new Error();
      setQuery('');
      await mutate();
    } catch {
      setFailed(athleteId);
    } finally {
      setBusy(null);
    }
  };

  const caseload = caseloadOf ? members.filter((m) => memberHasCoach(m, caseloadOf)) : [];
  const caseloadName = data?.coaches.find((c) => c.id === caseloadOf)?.name
    ?? coachNameAmong(members, caseloadOf);

  return (
    <>
      <Sheet open={open && !caseloadOf} onOpenChange={(o) => { if (!o) { onOpenChange(false); setQuery(''); } }} title="מאמני האקדמיה">
        <p className="-mt-1 mb-3 text-center text-xs text-ink-400">מי שמופיע כאן יכול לקבל מתאמנים</p>
        {!data ? (
          <div className="h-32 animate-pulse rounded-card bg-card/60" />
        ) : (
          <>
            {data.coaches.length === 0 ? (
              <Card className="p-4 text-center text-sm text-ink-500">עוד אין מאמני אקדמיה. מוסיפים מהחיפוש למטה.</Card>
            ) : (
              <Card className="divide-y divide-page py-1">
                {data.coaches.map((c) => (
                  <div key={c.id} className="flex min-h-[56px] items-center gap-3 py-2">
                    <button onClick={() => c.trainees > 0 && setCaseloadOf(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{initialsOf(c.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-700" dir="auto">{c.name}</span>
                        <span className="block text-xs text-ink-400">
                          {c.trainees === 0 ? 'אין מתאמנים' : c.trainees === 1 ? 'מתאמן אחד ›' : `${c.trainees} מתאמנים ›`}
                        </span>
                      </span>
                    </button>
                    {c.trainees > 0 ? (
                      <span className="max-w-[96px] shrink-0 text-end text-3xs leading-tight text-ink-400">להסרה צריך להעביר קודם את המתאמנים</span>
                    ) : (
                      <button
                        onClick={() => setCoach(c.id, false)}
                        disabled={busy === c.id}
                        className="min-h-[44px] shrink-0 px-2 text-xs font-bold text-accent-red disabled:opacity-40"
                      >
                        {failed === c.id ? 'נכשל, שוב' : busy === c.id ? '…' : 'הסרה'}
                      </button>
                    )}
                  </div>
                ))}
              </Card>
            )}

            <p className="mb-1.5 mt-4 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400">להוסיף מאמן</p>
            <label className="flex min-h-[44px] items-center gap-2 rounded-xl bg-card px-3">
              <Search className="h-4 w-4 shrink-0 text-ink-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש חבר מועדון"
                className="min-w-0 flex-1 bg-transparent text-base text-ink-700 outline-none placeholder:text-ink-400"
                dir="auto"
              />
            </label>
            {matches.length > 0 && (
              <Card className="mt-2 divide-y divide-page py-1">
                {matches.map((c) => (
                  <div key={c.id} className="flex min-h-[52px] items-center gap-3 py-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-xs font-bold text-brand-600">{initialsOf(c.name)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-700" dir="auto">{c.name}</span>
                    <button
                      onClick={() => setCoach(c.id, true)}
                      disabled={busy === c.id}
                      className="min-h-[44px] shrink-0 px-2 text-xs font-bold text-brand-600 disabled:opacity-40"
                    >
                      {failed === c.id ? 'נכשל, שוב' : busy === c.id ? '…' : '+ להוסיף'}
                    </button>
                  </div>
                ))}
              </Card>
            )}
            {query.trim() && data && matches.length === 0 && (
              <p className="mt-2 px-1 text-xs text-ink-400">לא נמצא חבר מועדון בשם הזה</p>
            )}
            <p className="mt-3 px-1 text-xs text-ink-400">מנהלי אקדמיה ממנה רק אדמין, במסך התפקידים.</p>
          </>
        )}
      </Sheet>

      <Sheet open={open && !!caseloadOf} onOpenChange={(o) => { if (!o) { setCaseloadOf(null); if (focusCoach) onOpenChange(false); } }} title={caseloadName}>
        <Card className="divide-y divide-page py-1">
          {[...caseload].sort((x, y) => x.name.localeCompare(y.name)).map((m) => (
            <button
              key={m.athleteId}
              onClick={() => { setCaseloadOf(null); onOpenChange(false); setTimeout(() => onSelectMember(m), SHEET_HANDOFF_MS); }}
              className="flex w-full min-h-[52px] items-center gap-3 py-2.5 text-start active:bg-page/60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-xs font-bold text-brand-600">{initialsOf(m.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-700" dir="auto">{m.name}</span>
                <span className="block text-xs text-ink-400">{m.band?.name ?? 'בלי דבוקה'} · {m.weekRuns} ריצות השבוע</span>
              </span>
              <span className="shrink-0 text-end">
                <span className={cn('block text-sm font-bold tabular-nums', m.completionRate === null ? 'text-ink-400' : 'text-ink-700')}>{fmtRate(m.completionRate)}</span>
                <span className="block text-3xs text-ink-400">בתוכנית</span>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
            </button>
          ))}
        </Card>
        <p className="mt-3 px-1 text-xs text-ink-400">להעביר מתאמן למאמן אחר: פותחים את הכרטיס שלו ובוחרים מאמן.</p>
      </Sheet>
    </>
  );
}

/** The open/closed switch for the academy's public doors, with the link to share. */
function RegistrationSwitch() {
  const { data, mutate } = useApi<{ open: boolean }>('/api/academy/registration');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const open = data?.open ?? true;

  const flip = async (next: boolean) => {
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch('/api/academy/registration', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ open: next }),
      });
      if (!res.ok) throw new Error();
      await mutate({ open: next }, { revalidate: false });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('https://www.madregot.app/academy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refused: the address is on screen to copy by hand */ }
  };

  return (
    <InsetSection className="mb-0">
      <InsetRow
        label={open ? 'ההרשמה לאקדמיה פתוחה' : 'ההרשמה לאקדמיה סגורה'}
        sublabel={failed ? 'לא נשמר, נסה שוב' : open ? 'הדף מאינסטגרם והטופס מקבלים פניות' : 'הדף מאינסטגרם אומר שההרשמה סגורה. מי שקיבל קישור אישי עדיין יכול להירשם'}
        sublabelClamp
        trailing={<Switch checked={open} onChange={flip} loading={saving} disabled={!data || saving} ariaLabel="ההרשמה לאקדמיה" activeColor="bg-accent-600" />}
      />
      <InsetRow
        icon={Link2}
        iconBg="bg-brand-600"
        label="הקישור לאינסטגרם"
        sublabel="madregot.app/academy"
        onClick={copy}
        trailing={<span className="shrink-0 text-xs font-bold text-brand-600">{copied ? 'הועתק' : 'העתקה'}</span>}
      />
    </InsetSection>
  );
}

// ── The test script ─────────────────────────────────────────────────────────
// Opening the academy with real trainees, step by step (mockup
// academy-test-script.html). Each step ticks itself from what has actually
// happened in the academy; the last two can only be judged by looking, so they
// are ticked by hand (kept on this device) and each opens "view as" to do it.

type StepKey = 'coach' | 'open' | 'signup' | 'paired' | 'watch' | 'plan' | 'coachSees' | 'traineeSees';
const MANUAL_KEY = 'mc_academy_test_manual';

export function AcademyTestScript({ open, onOpenChange, members, onGoTab, onViewAs }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: AcademyMember[];
  onGoTab: (tab: 'funnel' | 'plans' | 'members') => void;
  /** "View as" is the super user's; without it the two looking steps have no button. */
  onViewAs?: () => void;
}) {
  const { data: coaches } = useApi<AcademyCoachesResponse>(open ? '/api/academy/coaches' : null);
  const { data: reg } = useApi<{ open: boolean }>(open ? '/api/academy/registration' : null);
  const { data: summary } = useApi<{ inFunnel: number }>(open ? '/api/academy/summary' : null);
  const [manual, setManual] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}'); } catch { return {}; }
  });
  const tick = (key: StepKey) => {
    const next = { ...manual, [key]: !manual[key] };
    setManual(next);
    try { localStorage.setItem(MANUAL_KEY, JSON.stringify(next)); } catch { /* memory only */ }
  };

  const paired = members.filter((m) => m.approved && memberCoachIds(m).length > 0);
  const done: Record<StepKey, boolean> = {
    coach: (coaches?.coaches.length ?? 0) > 0,
    open: !!reg?.open,
    signup: (summary?.inFunnel ?? 0) > 0 || members.length > 0,
    paired: paired.length > 0,
    watch: paired.some((m) => m.hasWatch),
    plan: paired.some((m) => m.plannedCount > 0),
    coachSees: !!manual.coachSees,
    traineeSees: !!manual.traineeSees,
  };
  const go = (fn: () => void) => { onOpenChange(false); setTimeout(fn, SHEET_HANDOFF_MS); };

  const groups: Array<{ title: string; steps: Array<{ key: StepKey; title: string; how: string; action?: { label: string; run: () => void }; manual?: boolean }> }> = [
    { title: 'הכנה', steps: [
      { key: 'coach', title: 'יש מאמן אקדמיה', how: 'בניהול: מאמני האקדמיה ← להוסיף מאמן.' },
      { key: 'open', title: 'ההרשמה פתוחה', how: 'בניהול: מתג ההרשמה.' },
    ] },
    { title: 'הצטרפות של מתאמן', steps: [
      { key: 'signup', title: 'נרשם בטופס', how: 'שולחים לו את הקישור לאינסטגרם, או מוסיפים חבר מועדון מרשימת החברים.', action: { label: 'לחברים', run: () => go(() => onGoTab('members')) } },
      { key: 'paired', title: 'לקבל אותו ולשבץ מאמן', how: 'במשפך: שיחה ראשונה, שיחה שנייה, "לקבל", ובוחרים מאמן.', action: { label: 'למשפך', run: () => go(() => onGoTab('funnel')) } },
      { key: 'watch', title: 'הוא מחבר שעון', how: 'הוא פותח את הקישור מהמייל ומחבר Garmin או Strava.', action: { label: 'למשפך', run: () => go(() => onGoTab('funnel')) } },
    ] },
    { title: 'אימון', steps: [
      { key: 'plan', title: 'שבוע ראשון נשלח', how: 'בתוכניות: בונים שבוע ושולחים לו.', action: { label: 'לתוכניות', run: () => go(() => onGoTab('plans')) } },
      { key: 'coachSees', title: 'המאמן רואה רק אותו', how: 'צופים כמאמן ובודקים שרק המתאמנים שלו מופיעים.', action: onViewAs ? { label: 'לצפות', run: () => go(onViewAs) } : undefined, manual: true },
      { key: 'traineeSees', title: 'המתאמן רואה את השבוע', how: 'צופים כמתאמן ובודקים את השבוע, השיחה והמבחן.', action: onViewAs ? { label: 'לצפות', run: () => go(onViewAs) } : undefined, manual: true },
    ] },
  ];
  const all = groups.flatMap((g) => g.steps);
  const count = all.filter((s) => done[s.key]).length;
  const current = all.find((s) => !done[s.key])?.key ?? null;
  const loading = !coaches || !reg || !summary;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="בדיקת האקדמיה">
      <div className="mb-4 flex items-center gap-3 px-1">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-page">
          <div className="h-full rounded-full bg-accent-600 transition-[width]" style={{ width: `${(100 * count) / all.length}%` }} />
        </div>
        <span className="shrink-0 text-xs font-bold tabular-nums text-ink-500"><bdi dir="ltr">{count}</bdi> מתוך <bdi dir="ltr">{all.length}</bdi></span>
      </div>
      {loading ? (
        <div className="h-64 animate-pulse rounded-card bg-card/60" />
      ) : groups.map((g) => (
        <div key={g.title} className="mb-4">
          <p className="mb-1.5 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400">{g.title}</p>
          <Card className="divide-y divide-page overflow-hidden p-0">
            {g.steps.map((st) => {
              const isDone = done[st.key];
              const isNow = st.key === current;
              return (
                <div key={st.key} className={cn('px-3.5', isNow ? 'bg-brand-600/[0.06] py-3' : 'flex min-h-[52px] items-center')}>
                  <div className="flex min-h-[28px] w-full items-center gap-3">
                    <button
                      onClick={st.manual ? () => tick(st.key) : undefined}
                      disabled={!st.manual}
                      aria-label={st.manual ? (isDone ? 'לבטל סימון' : 'לסמן שבוצע') : undefined}
                      className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-black text-white',
                        isDone ? 'border-accent-600 bg-accent-600' : isNow ? 'border-brand-600' : 'border-ink-300')}
                    >
                      {isDone ? '✓' : ''}
                    </button>
                    <span className={cn('flex-1 text-[15px]', isDone ? 'font-medium text-ink-400' : 'font-bold text-ink-700')}>{st.title}</span>
                    {!isNow && !isDone && st.action && (
                      <button onClick={st.action.run} className="min-h-[44px] shrink-0 px-1 text-xs font-bold text-brand-600">{st.action.label}</button>
                    )}
                  </div>
                  {isNow && (
                    <div className="ps-10">
                      <p className="mt-1 text-sm leading-relaxed text-ink-500">{st.how}</p>
                      {st.action && (
                        <button onClick={st.action.run} className="mt-2 min-h-[40px] rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">{st.action.label}</button>
                      )}
                      {st.manual && <p className="mt-2 text-xs text-ink-400">אחרי שבדקת, לוחצים על העיגול לסמן.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      ))}
      <p className="px-1 text-xs text-ink-400">הסימונים מתעדכנים לבד לפי מה שקרה באקדמיה. שני האחרונים מסמנים ביד.</p>
    </Sheet>
  );
}
