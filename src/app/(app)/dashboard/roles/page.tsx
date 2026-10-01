'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Bell, Lock, MoreHorizontal, Pencil, Plus, Search, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { BackNav, Card, EmptyState, Sheet, SkeletonList, Switch } from '@/components/ui';
import { ViewChipFace } from '@/components/RoleSwitcher';
import { rolesToColumns, type GrantableRole, type RolePerson } from '@/lib/auth/roles';
import { defaultViewFor, newlyGranted, rolePreview } from '@/lib/role-views';

// "תפקידים" — who holds which role, and switching them on (migration 127).
//
// One switch per role, several at once: that is the whole point of the screen,
// because the single dropdown in Settings → Users could only ever say ONE role, so
// nobody could be a club coach and an academy coach, and the academy manager was
// just "admin". What is switched on here is exactly what the person's top-bar view
// switcher will offer them. The server decides who may save (admins), and who may
// touch admin itself (the club account and the super user).
//
// "רץ אקדמיה" sits beside them but is not a role column: it is the academy
// membership flag (`is_academy`), the same one "accept" on the applicants board
// turns on. See the route.

const ROLE_LABEL: Record<GrantableRole, string> = {
  coach: 'מאמן',
  academy_coach: 'מאמן אקדמיה',
  academy_manager: 'מנהל אקדמיה',
  admin: 'אדמין',
};

const ROLE_ROWS: Array<{ role: GrantableRole; title: string; description: string }> = [
  { role: 'coach', title: 'מאמן מועדון', description: 'נוכחות, קבוצות וכלי מאמן' },
  { role: 'academy_coach', title: 'מאמן אקדמיה', description: 'רק המתאמנים שמשויכים אליו' },
  { role: 'academy_manager', title: 'מנהל אקדמיה', description: 'כל האקדמיה, מצטרפים ומאמנים' },
  { role: 'admin', title: 'אדמין', description: 'הכול, כולל קביעת תפקידים' },
];

const BADGE_TONE: Record<GrantableRole, string> = {
  coach: 'bg-[#FFF1E0] text-[#A34A00]',
  academy_coach: 'bg-[#FDEBF3] text-[#A3175A]',
  academy_manager: 'bg-[#DDE1FF] text-brand-600',
  admin: 'bg-ink-700 text-white',
};

type Filter = 'any' | 'academyRunners' | 'storyEditors' | 'coaches' | 'academy' | 'admin';

const FILTERS: Array<{ key: Filter; label: string; test: (p: RolePerson) => boolean }> = [
  { key: 'any', label: 'עם תפקיד', test: p => p.roles.length > 0 || !!p.academy || !!p.storyEditor },
  { key: 'academyRunners', label: 'רצי אקדמיה', test: p => !!p.academy },
  { key: 'storyEditors', label: 'אינסטגרם', test: p => !!p.storyEditor },
  { key: 'coaches', label: 'מאמנים', test: p => p.roles.includes('coach') || p.roles.includes('academy_coach') },
  { key: 'academy', label: 'צוות אקדמיה', test: p => p.roles.includes('academy_coach') || p.roles.includes('academy_manager') },
  { key: 'admin', label: 'אדמין', test: p => p.roles.includes('admin') },
];

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[0][0] + parts[1][0];
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (email[0] || '?').toUpperCase();
}

function PersonAvatar({ person, size = 40 }: { person: RolePerson; size?: number }) {
  if (person.avatarUrl) {
    return <img src={person.avatarUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white"
      style={{ width: size, height: size }}
    >
      {initials(person.name, person.email)}
    </span>
  );
}

/** "לפני 5 דק׳" style, for the sheet's last-sent line. */
function sentAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

/** POST action=notify — the role push again. Resolves to the error text, or null. */
async function resendRolePush(athleteId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/admin/roles', {
      method: 'POST',
      headers: await apiHeaders(true),
      body: JSON.stringify({ athleteId, action: 'notify' }),
    });
    return res.ok ? null : 'השליחה נכשלה. נסה שוב.';
  } catch {
    return 'השליחה נכשלה. נסה שוב.';
  }
}

function RoleBadges({ roles, academy, storyEditor }: { roles: GrantableRole[]; academy?: boolean; storyEditor?: boolean }) {
  if (!roles.length && !academy && !storyEditor) {
    return <span className="inline-flex h-[22px] items-center rounded-[7px] bg-[#F1F1F3] px-2 text-2xs font-bold text-ink-400">רץ</span>;
  }
  return (
    <span className="flex max-w-[128px] flex-wrap justify-end gap-1">
      {academy && (
        <span className="inline-flex h-[22px] items-center rounded-[7px] bg-[#E6F4EC] px-2 text-2xs font-bold text-[#0B6B35]">רץ אקדמיה</span>
      )}
      {storyEditor && (
        <span className="inline-flex h-[22px] items-center rounded-[7px] bg-[#FDE7F3] px-2 text-2xs font-bold text-[#B0186F]">אינסטגרם</span>
      )}
      {roles.map(r => (
        <span key={r} className={cn('inline-flex h-[22px] items-center rounded-[7px] px-2 text-2xs font-bold', BADGE_TONE[r])}>
          {ROLE_LABEL[r]}
        </span>
      ))}
    </span>
  );
}

export default function RolesPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApi<{ people: RolePerson[]; migrated: boolean; storyMigrated?: boolean; canGrantAdmin: boolean }>(
    '/api/admin/roles',
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('any');
  const [editing, setEditing] = useState<RolePerson | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2600);
  };
  const resend = async (p: RolePerson) => {
    setMenuFor(null);
    const failed = await resendRolePush(p.id);
    flash(failed || `נשלחה התראה ל${p.name || p.email}`);
    if (!failed) await mutate();
  };

  const people = useMemo(() => data?.people ?? [], [data]);
  const withRole = people.filter(FILTERS[0].test).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // A search looks through everybody, not just the filter: finding a runner to
    // give a role to is the reason to search.
    if (q) return people.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
    const f = FILTERS.find(x => x.key === filter)!;
    return people.filter(f.test);
  }, [people, query, filter]);

  const forbidden = (error as { status?: number } | undefined)?.status === 403;

  return (
    <div className="space-y-3" dir="rtl">
      <BackNav label="כלי מאמן" onBack={() => router.push('/dashboard/coach-tools')} />
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-700">תפקידים</h1>
        {data && (
          <p className="mt-1 text-sm text-ink-400">
            {people.length} חשבונות · {withRole} עם תפקיד
          </p>
        )}
      </div>

      {data && !data.migrated && (
        <Card className="flex items-start gap-2.5 p-3 text-sm text-ink-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-band-3-ink" />
          <span>מיגרציה 127 עוד לא הורצה, אז אפשר לשמור רק תפקיד אחד לכל אדם.</span>
        </Card>
      )}

      <label className="flex h-11 items-center gap-2 rounded-[14px] bg-card px-3.5 text-ink-300">
        <Search className="h-[18px] w-[18px] shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם או מייל"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink-700 outline-none placeholder:text-ink-300"
        />
      </label>

      {!query.trim() && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {FILTERS.map(f => {
            const n = people.filter(f.test).length;
            const on = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3 text-13 font-semibold',
                  on ? 'bg-ink-700 text-white' : 'bg-card text-ink-500',
                )}
              >
                {f.label}
                <b className={cn('text-xs font-bold', on ? 'text-white/60' : 'text-ink-300')}>{n}</b>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <SkeletonList count={6} />
      ) : forbidden ? (
        <EmptyState icon={Lock} title="המסך הזה לאדמין בלבד" />
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="לא הצלחנו לטעון את הרשימה" />
      ) : !shown.length ? (
        <EmptyState icon={Search} title={query.trim() ? 'לא נמצא אף אחד' : 'אין כאן אף אחד'} />
      ) : (
        <Card className="px-4 py-0">
          {shown.map(p => (
            <div key={p.id} className="relative flex min-h-16 items-center gap-1 border-b border-[#ECECEF] last:border-b-0">
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2 text-start"
              >
                <PersonAvatar person={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-ink-700">{p.name || p.email}</span>
                  <span className="block truncate text-xs text-ink-400" dir="ltr" style={{ textAlign: 'right' }}>{p.email}</span>
                </span>
                <RoleBadges roles={p.roles} academy={p.academy} storyEditor={p.storyEditor} />
              </button>
              <button
                type="button"
                aria-label={`פעולות: ${p.name || p.email}`}
                onClick={() => setMenuFor(m => (m === p.id ? null : p.id))}
                className={cn(
                  '-me-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-400',
                  menuFor === p.id ? 'bg-page text-ink-700' : 'active:bg-page',
                )}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuFor === p.id && (
                <>
                  <button type="button" aria-label="סגירה" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuFor(null)} />
                  <div className="absolute end-0 top-[calc(100%-6px)] z-50 w-56 overflow-hidden rounded-2xl bg-card p-1 shadow-[0_16px_40px_rgba(0,0,0,.2)]" role="menu">
                    <MenuItem icon={Plus} label="הוספת תפקיד…" strong onClick={() => { setMenuFor(null); setEditing(p); }} />
                    <MenuItem icon={Pencil} label="עריכת כל התפקידים" onClick={() => { setMenuFor(null); setEditing(p); }} />
                    {p.roles.length > 0 && <MenuItem icon={Bell} label="שליחת התראה שוב" onClick={() => resend(p)} />}
                  </div>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      <EditRolesSheet
        person={editing}
        canGrantAdmin={!!data?.canGrantAdmin}
        storyMigrated={!!data?.storyMigrated}
        onClose={() => setEditing(null)}
        onSaved={async (notified) => {
          const who = editing?.name || editing?.email || '';
          setEditing(null);
          flash(notified ? `נשמר, ונשלחה התראה ל${who}` : 'נשמר');
          await mutate();
        }}
        onResent={async (failed) => {
          flash(failed || 'ההתראה נשלחה שוב');
          if (!failed) await mutate();
        }}
      />

      {toast && (
        <div role="status" className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center bottom-[calc(env(safe-area-inset-bottom)+96px)]">
          <span className="rounded-pill bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, strong = false, onClick }: { icon: typeof Plus; label: string; strong?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-start text-[15px] active:bg-page',
        strong ? 'font-bold text-brand-600' : 'text-ink-700',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

function EditRolesSheet({
  person,
  canGrantAdmin,
  storyMigrated,
  onClose,
  onSaved,
  onResent,
}: {
  person: RolePerson | null;
  canGrantAdmin: boolean;
  /** Migration 129 is in: the "אינסטגרם" switch can be saved, so it is shown. */
  storyMigrated: boolean;
  onClose: () => void;
  /** `notified` — the save switched a role (or the academy) on and its push went out. */
  onSaved: (notified: boolean) => void | Promise<void>;
  onResent: (failed: string | null) => void | Promise<void>;
}) {
  const [resending, setResending] = useState(false);
  const [draft, setDraft] = useState<GrantableRole[]>([]);
  const [academy, setAcademy] = useState(false);
  const [storyEditor, setStoryEditor] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [forId, setForId] = useState<string | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Re-seed the switches whenever a different person is opened.
  if (person && person.id !== forId) {
    setForId(person.id);
    setDraft(person.roles);
    setAcademy(!!person.academy);
    setStoryEditor(!!person.storyEditor);
    setFailed(null);
  }

  const toggle = (role: GrantableRole, on: boolean) => {
    // Admin is the one role that asks first — it opens everything.
    if (role === 'admin' && on) { setConfirmAdmin(true); return; }
    setDraft(d => (on ? [...d, role] : d.filter(r => r !== role)));
  };

  const save = async () => {
    if (!person) return;
    setSaving(true);
    setFailed(null);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: person.id, roles: draft, academy, ...(storyMigrated ? { storyEditor } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFailed(
          body.error === 'migration_127_required'
            ? 'כמה תפקידים לאותו אדם יעבדו אחרי מיגרציה 127.'
            : body.error === 'migration_129_required'
              ? 'המתג "אינסטגרם" יעבוד אחרי מיגרציה 129.'
            : res.status === 403
              ? 'רק חשבון המועדון יכול לתת או להסיר אדמין.'
              : 'השמירה נכשלה. נסה שוב.',
        );
        return;
      }
      const body = await res.json().catch(() => ({}));
      await onSaved(!!body.notified || !!body.academyNotified || !!body.storyNotified);
    } catch {
      setFailed('השמירה נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  };

  // The chip they will see on opening the app: their new primary role's view.
  const chipView = defaultViewFor(rolesToColumns(draft, 'runner').role);
  const preview = rolePreview(draft, chipView);
  const joining = !!person && academy && !person.academy;
  const changed = !!person && (
    academy !== !!person.academy || storyEditor !== !!person.storyEditor || draft.length !== person.roles.length || draft.some(r => !person.roles.includes(r))
  );
  const first = person?.name?.split(' ')[0] || 'חשבון';
  const grantNote = person
    ? [
        joining ? 'על הכניסה לאקדמיה' : null,
        storyEditor && !person.storyEditor ? 'על שיתוף אימוני הקבוצה' : null,
        newlyGranted(person.roles, draft).length > 0 ? 'על התפקיד החדש' : null,
      ].filter(Boolean)
    : [];

  return (
    <>
      <Sheet open={!!person} onOpenChange={o => { if (!o) onClose(); }} title="תפקידים">
        {person && (
          <div className="space-y-4 pb-2" dir="rtl">
            <div className="flex items-center gap-3">
              <PersonAvatar person={person} size={48} />
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-ink-700">{person.name || person.email}</p>
                <p className="truncate text-xs text-ink-400" dir="ltr" style={{ textAlign: 'right' }}>{person.email}</p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 px-1 text-2xs font-extrabold tracking-wide text-ink-400">רץ</p>
              <div className="overflow-hidden rounded-2xl bg-page/60">
                <RoleRow title="רץ מועדון" description="כל חשבון הוא קודם כול רץ" locked />
                <RoleRow
                  title="רץ אקדמיה"
                  description="לשונית אקדמיה, יעדי קצב בשעון, הפיד של האקדמיה"
                  checked={academy}
                  onChange={on => (on ? setAcademy(true) : person.academy ? setConfirmLeave(true) : setAcademy(false))}
                />
              </div>
            </div>

            {storyMigrated && (
              <div>
                <p className="mb-1.5 px-1 text-2xs font-extrabold tracking-wide text-ink-400">גישה</p>
                <div className="overflow-hidden rounded-2xl bg-page/60">
                  <RoleRow
                    title="אינסטגרם"
                    description="אימון האיכות: בוחרים רץ מכל דבוקה ומשתפים, וההתראה של 7:30"
                    checked={storyEditor}
                    onChange={setStoryEditor}
                  />
                </div>
              </div>
            )}

            <div>
            <p className="mb-1.5 px-1 text-2xs font-extrabold tracking-wide text-ink-400">צוות</p>
            <div className="overflow-hidden rounded-2xl bg-page/60">
              {ROLE_ROWS.map(r => (
                <RoleRow
                  key={r.role}
                  title={r.title}
                  description={r.description}
                  checked={draft.includes(r.role)}
                  disabled={r.role === 'admin' && !canGrantAdmin}
                  onChange={on => toggle(r.role, on)}
                />
              ))}
            </div>
            </div>

            <div className="flex items-center gap-2 rounded-2xl bg-page/60 px-3 py-2.5 text-sm text-ink-500">
              <span className="shrink-0">בראש המסך יראה:</span>
              {preview.chip && <ViewChipFace view={chipView} small />}
              <span className="min-w-0">{preview.text}</span>
            </div>

            {grantNote.length > 0 && (
              <div className="flex items-center gap-2 rounded-2xl bg-[#E6F4EC] px-3 py-2.5 text-sm font-semibold text-[#0B6B35]">
                <Bell className="h-4 w-4 shrink-0" />
                בשמירה תישלח ל{first} התראה {grantNote.join(' ו')}
              </div>
            )}

            {person.roles.length > 0 && (
              <button
                type="button"
                disabled={resending}
                onClick={async () => {
                  setResending(true);
                  const err = await resendRolePush(person.id);
                  setResending(false);
                  await onResent(err);
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-brand-600/[.05] px-3 py-2.5 text-start disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-brand-600">{resending ? 'שולח…' : 'שליחת ההתראה שוב'}</span>
                  <span className="block text-xs text-ink-400">
                    {person.lastNotifiedAt ? `נשלחה ${sentAgo(person.lastNotifiedAt)}` : 'עוד לא נשלחה'}
                  </span>
                </span>
                <Bell className="h-4 w-4 shrink-0 text-brand-600" />
              </button>
            )}

            {failed && <p className="text-center text-sm text-accent-red">{failed}</p>}

            <button
              type="button"
              onClick={save}
              disabled={!changed || saving}
              className="h-12 w-full rounded-pill bg-brand-600 text-base font-bold text-white transition-opacity disabled:opacity-40 active:scale-[0.98]"
            >
              {saving ? 'שומר…' : 'שמירה'}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={confirmLeave} onOpenChange={setConfirmLeave}>
        <div className="space-y-4 pb-2 text-center" dir="rtl">
          <p className="text-lg font-bold text-ink-700">להוציא את {person?.name || 'החשבון הזה'} מהאקדמיה?</p>
          <p className="text-sm leading-relaxed text-ink-500">
            לשונית האקדמיה ויעדי הקצב בשעון ייעלמו לו, והוא ינותק מהמאמן שלו באקדמיה. ההיסטוריה שלו נשמרת.
          </p>
          <button
            type="button"
            onClick={() => { setAcademy(false); setConfirmLeave(false); }}
            className="h-12 w-full rounded-pill bg-accent-red text-base font-bold text-white active:scale-[0.98]"
          >
            כן, להוציא מהאקדמיה
          </button>
          <button
            type="button"
            onClick={() => setConfirmLeave(false)}
            className="h-12 w-full rounded-pill bg-page text-base font-semibold text-ink-700 active:scale-[0.98]"
          >
            ביטול
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmAdmin} onOpenChange={setConfirmAdmin}>
        <div className="space-y-4 pb-2 text-center" dir="rtl">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-red/10 text-accent-red">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <p className="text-lg font-bold text-ink-700">לתת ל{person?.name || 'חשבון הזה'} הרשאת אדמין?</p>
          <div className="space-y-1.5 rounded-2xl bg-page/60 p-3 text-start text-sm text-ink-500">
            <p className="font-semibold text-ink-700">אדמין רואה ומשנה הכול באפליקציה:</p>
            <p>• כל הרצים, המאמנים והאקדמיה</p>
            <p>• הגדרות המועדון וההתראות</p>
            <p>• קביעת תפקידים לאחרים</p>
          </div>
          <button
            type="button"
            onClick={() => { setDraft(d => (d.includes('admin') ? d : [...d, 'admin'])); setConfirmAdmin(false); }}
            className="h-12 w-full rounded-pill bg-accent-red text-base font-bold text-white active:scale-[0.98]"
          >
            כן, לתת הרשאת אדמין
          </button>
          <button
            type="button"
            onClick={() => setConfirmAdmin(false)}
            className="h-12 w-full rounded-pill bg-page text-base font-semibold text-ink-700 active:scale-[0.98]"
          >
            ביטול
          </button>
        </div>
      </Sheet>
    </>
  );
}

function RoleRow({
  title,
  description,
  checked = true,
  locked = false,
  disabled = false,
  onChange,
}: {
  title: string;
  description: string;
  checked?: boolean;
  locked?: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 border-b border-[#ECECEF] px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-ink-700">{title}</p>
        <p className="text-xs text-ink-400">{description}</p>
      </div>
      <Switch
        checked={checked}
        onChange={on => onChange?.(on)}
        disabled={locked || disabled}
        activeColor="bg-[#34C759]"
        ariaLabel={title}
      />
    </div>
  );
}
