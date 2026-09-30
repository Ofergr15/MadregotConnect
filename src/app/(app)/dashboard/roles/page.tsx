'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Lock, Search, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { BackNav, Card, EmptyState, Sheet, SkeletonList, Switch } from '@/components/ui';
import { ViewChipFace } from '@/components/RoleSwitcher';
import { rolesToColumns, type GrantableRole, type RolePerson } from '@/lib/auth/roles';
import { defaultViewFor, rolePreview } from '@/lib/role-views';

// "תפקידים" — who holds which role, and switching them on (migration 127).
//
// One switch per role, several at once: that is the whole point of the screen,
// because the single dropdown in Settings → Users could only ever say ONE role, so
// nobody could be a club coach and an academy coach, and the academy manager was
// just "admin". What is switched on here is exactly what the person's top-bar view
// switcher will offer them. The server decides who may save (admins), and who may
// touch admin itself (the club account and the super user).

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

type Filter = 'any' | 'coaches' | 'academy' | 'admin';

const FILTERS: Array<{ key: Filter; label: string; test: (r: GrantableRole[]) => boolean }> = [
  { key: 'any', label: 'עם תפקיד', test: r => r.length > 0 },
  { key: 'coaches', label: 'מאמנים', test: r => r.includes('coach') || r.includes('academy_coach') },
  { key: 'academy', label: 'אקדמיה', test: r => r.includes('academy_coach') || r.includes('academy_manager') },
  { key: 'admin', label: 'אדמין', test: r => r.includes('admin') },
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

function RoleBadges({ roles }: { roles: GrantableRole[] }) {
  if (!roles.length) {
    return <span className="inline-flex h-[22px] items-center rounded-[7px] bg-[#F1F1F3] px-2 text-2xs font-bold text-ink-400">רץ</span>;
  }
  return (
    <span className="flex max-w-[128px] flex-wrap justify-end gap-1">
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
  const { data, error, isLoading, mutate } = useApi<{ people: RolePerson[]; migrated: boolean; canGrantAdmin: boolean }>(
    '/api/admin/roles',
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('any');
  const [editing, setEditing] = useState<RolePerson | null>(null);

  const people = useMemo(() => data?.people ?? [], [data]);
  const withRole = people.filter(p => p.roles.length > 0).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // A search looks through everybody, not just the filter: finding a runner to
    // give a role to is the reason to search.
    if (q) return people.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
    const f = FILTERS.find(x => x.key === filter)!;
    return people.filter(p => f.test(p.roles));
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
            const n = people.filter(p => f.test(p.roles)).length;
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
            <button
              key={p.id}
              type="button"
              onClick={() => setEditing(p)}
              className="flex min-h-16 w-full items-center gap-3 border-b border-[#ECECEF] py-2 text-start last:border-b-0"
            >
              <PersonAvatar person={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink-700">{p.name || p.email}</span>
                <span className="block truncate text-xs text-ink-400" dir="ltr" style={{ textAlign: 'right' }}>{p.email}</span>
              </span>
              <RoleBadges roles={p.roles} />
            </button>
          ))}
        </Card>
      )}

      <EditRolesSheet
        person={editing}
        canGrantAdmin={!!data?.canGrantAdmin}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await mutate(); }}
      />
    </div>
  );
}

function EditRolesSheet({
  person,
  canGrantAdmin,
  onClose,
  onSaved,
}: {
  person: RolePerson | null;
  canGrantAdmin: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<GrantableRole[]>([]);
  const [forId, setForId] = useState<string | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Re-seed the switches whenever a different person is opened.
  if (person && person.id !== forId) {
    setForId(person.id);
    setDraft(person.roles);
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
        body: JSON.stringify({ athleteId: person.id, roles: draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFailed(
          body.error === 'migration_127_required'
            ? 'כמה תפקידים לאותו אדם יעבדו אחרי מיגרציה 127.'
            : res.status === 403
              ? 'רק חשבון המועדון יכול לתת או להסיר אדמין.'
              : 'השמירה נכשלה. נסה שוב.',
        );
        return;
      }
      await onSaved();
    } catch {
      setFailed('השמירה נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  };

  // The chip they will see on opening the app: their new primary role's view.
  const chipView = defaultViewFor(rolesToColumns(draft, 'runner').role);
  const preview = rolePreview(draft, chipView);
  const changed = !!person && (draft.length !== person.roles.length || draft.some(r => !person.roles.includes(r)));

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

            <div className="overflow-hidden rounded-2xl bg-page/60">
              <RoleRow title="רץ" description="כל חשבון הוא קודם כול רץ" locked />
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

            <div className="flex items-center gap-2 rounded-2xl bg-page/60 px-3 py-2.5 text-sm text-ink-500">
              <span className="shrink-0">בראש המסך יראה:</span>
              {preview.chip && <ViewChipFace view={chipView} small />}
              <span className="min-w-0">{preview.text}</span>
            </div>

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
