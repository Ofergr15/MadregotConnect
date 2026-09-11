'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bell, BellOff, Calendar, ChevronDown, ClipboardList, Flame, Megaphone,
  MessageSquare, PartyPopper, Search, ShieldCheck, Smartphone, Users, X,
} from 'lucide-react';
import { Card, LoadingBlock, Switch } from '@/components/ui';
import { apiHeaders, useApi } from '@/lib/api';
import { isStaffRole } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { AthleteLink } from '@/components/AthleteLink';

/**
 * Settings → התראות ניהול. Who receives each management alert, and what every
 * member receives at all — on one screen, editable.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * The recipient list for staff alerts (bug report, pain flag, store order,
 * sign-up, the health checks) was compiled into a function. It was narrowed
 * twice in two days, each time by a deploy, and each time the only way to find
 * out it was wrong was to count pushes on a real phone: the club owner was
 * getting every bug report twice, on two of his own accounts, and nothing in the
 * app could tell him why. `notification_routing` (migration 099) makes the rule
 * data; this screen is where it's read and changed.
 *
 * ── THE THREE QUESTIONS IT HAS TO ANSWER ────────────────────────────────────
 * 1. Who gets this alert — as ROLES, which is the rule, and as the PEOPLE that
 *    rule resolves to right now, which is the thing anyone actually wants to
 *    know. Roles are abstract; "יאיר גבאי · ללא מכשיר" is why he didn't hear it.
 * 2. Will it actually arrive. A recipient with no registered device, or one who
 *    turned the management channel off for themselves, is on the list and
 *    receives nothing — so both are marked, and an alert with no reachable
 *    recipient is called out at the top rather than left to be discovered.
 * 3. What each member receives, across all eight channels, with the switches
 *    right there. Same PUT the athlete's own Settings screen uses.
 *
 * Routing is the club's decision; per-person preferences are the person's. This
 * screen shows both because a delivery needs both, but it never silently flips
 * somebody's own preference to "fix" a routing choice.
 */

interface Recipient {
  id: string;
  name: string;
  role: string;
  devices: number;
  /** Routed to them, but they've turned the management channel off. */
  muted: boolean;
}

interface RoutedKind {
  kind: string;
  label: string;
  hint: string;
  source: string;
  roles: Record<string, boolean>;
  recipients: Recipient[];
}

interface Person {
  id: string;
  name: string;
  role: string;
  devices: number;
  /** Effective prefs — saved values merged over this role's defaults. */
  prefs: Record<string, boolean>;
}

interface Payload {
  migrated: boolean;
  roles: { role: string; people: number }[];
  kinds: RoutedKind[];
  categories: string[];
  people: Person[];
}

/** Hebrew role labels, matching the Role Manager's and הגרעין's chips. */
const ROLE_LABEL: Record<string, string> = {
  admin: 'מנהל',
  coach: 'מאמן',
  academy_coach: 'מאמן אקדמיה',
  runner: 'רץ',
  core_runner: 'רץ גרעין',
  academy_user: 'אקדמיה',
  viewer: 'צופה',
};

// The glyph per category, matching NotificationPrefs so the admin's view of
// somebody's channels looks like the screen that person sees. Labels come from
// messages/{he,en}.json under notificationPrefs.categories — the same keys, so
// the two can't drift.
const CATEGORY_META: Record<string, { icon: typeof Calendar; bg: string; staffOnly?: boolean }> = {
  workouts: { icon: Calendar, bg: 'bg-brand-600' },
  coach: { icon: MessageSquare, bg: 'bg-band-2' },
  achievements: { icon: Flame, bg: 'bg-accent-600' },
  program: { icon: ClipboardList, bg: 'bg-band-3' },
  teammates: { icon: Users, bg: 'bg-band-3' },
  news: { icon: Megaphone, bg: 'bg-accent-red' },
  events: { icon: PartyPopper, bg: 'bg-violet-500' },
  management: { icon: ShieldCheck, bg: 'bg-ink-700', staffOnly: true },
};

export default function NotificationRouting() {
  // Category labels only — everything else on this screen is hardcoded Hebrew,
  // like every other admin manager here.
  const t = useTranslations('notificationPrefs');
  const [query, setQuery] = useState('');
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, isLoading, mutate } = useApi<Payload>('/api/admin/notifications');
  const kinds = useMemo(() => data?.kinds || [], [data]);
  const people = useMemo(() => data?.people || [], [data]);
  const roles = useMemo(() => data?.roles || [], [data]);
  const locked = data?.migrated === false;

  /** Recipients who will actually be reached: on the list, has a device, hasn't muted it. */
  const reachable = (k: RoutedKind) => k.recipients.filter(r => r.devices > 0 && !r.muted);
  const unreachable = kinds.filter(k => reachable(k).length === 0);

  const categories = useMemo(
    () => (data?.categories || []).filter(c => CATEGORY_META[c]),
    [data],
  );

  const failed = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  /** One cell of the routing grid: does this role receive this kind. */
  const toggleRoute = async (k: RoutedKind, role: string, next: boolean) => {
    setBusyCell(`${k.kind}:${role}`);
    setError(null);
    // Optimistic on the switch only. The recipient chips under it are resolved
    // server-side (role → people → devices → their own mute), so they refresh on
    // the revalidate below rather than being re-derived here — two answers to
    // "who gets this" is the exact bug this screen exists to end.
    mutate(
      cur => cur && {
        ...cur,
        kinds: cur.kinds.map(x => (x.kind === k.kind ? { ...x, roles: { ...x.roles, [role]: next } } : x)),
      },
      false,
    );
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ kind: k.kind, role, enabled: next }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          out.error === 'migration-missing'
            ? 'צריך להריץ קודם את המיגרציה 099 ב-Supabase.'
            : out.error || 'הפעולה נכשלה',
        );
      }
    } catch (err) {
      failed(err, 'הפעולה נכשלה');
    } finally {
      await mutate();
      setBusyCell(null);
    }
  };

  /**
   * One person's own channel switch. Deliberately the SAME endpoint their
   * Settings screen calls — the merge logic, the staff defaults and the
   * pre-migration 501 all live there, and a second writer would be a second set
   * of rules about what an untouched preference means.
   */
  const togglePref = async (p: Person, category: string, next: boolean) => {
    setBusyCell(`${p.id}:${category}`);
    setError(null);
    mutate(
      cur => cur && {
        ...cur,
        people: cur.people.map(x => (x.id === p.id ? { ...x, prefs: { ...x.prefs, [category]: next } } : x)),
      },
      false,
    );
    try {
      const res = await fetch('/api/athletes/notification-prefs', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: p.id, category, enabled: next }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(res.status === 501 ? 'העמודה notification_prefs עוד לא נוצרה ב-Supabase.' : body.slice(0, 120) || 'הפעולה נכשלה');
      }
    } catch (err) {
      failed(err, 'הפעולה נכשלה');
    } finally {
      // Refresh both sections: turning the management channel off for an admin
      // has to show up as "כיבה" on every alert routed to them, immediately.
      await mutate();
      setBusyCell(null);
    }
  };

  /** Search covers name and role label — the club has 26 people, half named in Hebrew. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? people.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (ROLE_LABEL[p.role] || p.role).toLowerCase().includes(q))
      : people;
    // Staff first: they're who this screen is about, and they're 3 rows out of 26.
    return [...pool].sort((a, b) => Number(isStaffRole(b.role)) - Number(isStaffRole(a.role)));
  }, [people, query]);

  // The route is admin-only where its neighbours in Coach Tools are staff-gated,
  // so a coach reaching this row is a state that happens — and "empty grid" would
  // read as "the club has no alerts configured", which is the worst possible lie
  // for this particular screen to tell.
  if (loadError && !data) {
    const status = (loadError as { status?: number }).status;
    return (
      <div dir="rtl">
        <Card className="p-4">
          <p className="text-sm font-semibold text-ink-900">
            {status === 403 ? 'המסך הזה למנהלים בלבד' : 'לא הצלחנו לטעון את ההתראות'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            {status === 403
              ? 'כאן נקבע מי מקבל דיווח על באג או על כאב, ולכן רק מנהל רואה ומשנה את זה.'
              : 'כדאי לרענן. אם זה חוזר, זו תקלה בשרת.'}
          </p>
        </Card>
      </div>
    );
  }

  if (isLoading && !data) return <LoadingBlock tone="ink" />;

  return (
    <div dir="rtl">
      <div>
        <h2 className="text-[22px] font-extrabold leading-tight text-ink-900">התראות ניהול</h2>
        <p className="mt-0.5 text-xs">
          <span className="font-semibold text-ink-900">{kinds.length} סוגי התראות</span>
          <span className="text-ink-400"> · {people.length} חברי מועדון</span>
        </p>
      </div>

      {/* Migrations are pasted in by hand, so this is a state a reader hits. The
          grid below is still CORRECT without the table — an unrouted kind falls
          back to the admins, which is exactly what the switches show — so this
          says "cannot edit yet", not "broken". */}
      {locked && (
        <Card className="mt-3 p-4">
          <p className="text-sm font-semibold text-ink-900">הטבלה עוד לא נוצרה</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            צריך להריץ את <code dir="ltr">supabase/migrations/099_notification_routing.sql</code> ב-Supabase SQL editor.
            עד אז כל ההתראות האלה נשלחות למנהלים בלבד — מה שמוצג למטה — ולא ניתן לשנות.
          </p>
        </Card>
      )}

      {error && <p className="mt-3 text-sm leading-relaxed text-accent-red">{error}</p>}

      {/* The one thing worth interrupting for: an alert nobody will actually
          receive. It is silent by nature — the send succeeds, there is just
          nobody at the other end — so it has to be said before the grid. */}
      {!locked && unreachable.length > 0 && (
        <Card className="mt-3 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <BellOff className="h-4 w-4 shrink-0 text-accent-red" />
            {unreachable.length} התראות לא יגיעו לאף אחד
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            {unreachable.map(k => k.label).join(' · ')} — אין להן נמען עם מכשיר רשום, או שהנמען כיבה את ערוץ הניהול אצלו.
          </p>
        </Card>
      )}

      {/* ── WHO GETS WHAT ── */}
      <div className="mt-4 space-y-2.5">
        <SectionCaption>מי מקבל כל התראה</SectionCaption>
        {kinds.map(k => (
          <Card key={k.kind} className="p-3.5">
            <p className="text-sm font-semibold text-ink-900">{k.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{k.hint}</p>

            <div className="mt-2.5 divide-y divide-page overflow-hidden rounded-2xl bg-page/60">
              {roles.map(({ role, people: count }) => {
                const cell = `${k.kind}:${role}`;
                const label = ROLE_LABEL[role] || role;
                return (
                  <div key={role} className="flex min-h-[44px] items-center gap-2 px-3 py-1.5">
                    <span className="flex-1 text-13 font-medium text-ink-900">{label}</span>
                    <span className="shrink-0 text-3xs text-ink-400">{count} במועדון</span>
                    <Switch
                      checked={k.roles[role] === true}
                      onChange={next => toggleRoute(k, role, next)}
                      disabled={locked || busyCell === cell}
                      loading={busyCell === cell}
                      size="sm"
                      activeColor="bg-accent-600"
                      ariaLabel={`${k.label} — ${label}`}
                    />
                  </div>
                );
              })}
            </div>

            {/* The rule above, resolved into people. This is the half nothing in
                the app could show before, and the reason a wrong list survived
                two deploys. */}
            <div className="mt-2.5">
              {k.recipients.length === 0 ? (
                <p className="text-xs font-semibold text-accent-red">אף אחד לא מקבל את ההתראה הזו</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {k.recipients.map(r => (
                    <RecipientChip key={r.id} r={r} />
                  ))}
                </div>
              )}
            </div>

            <p dir="ltr" className="mt-2 text-left text-3xs text-ink-300">{k.source}</p>
          </Card>
        ))}
      </div>

      {/* ── WHAT EACH PERSON RECEIVES ── */}
      <div className="mt-5">
        <SectionCaption>מה כל אחד מקבל</SectionCaption>
        <div className="mb-2 flex h-10 items-center gap-2 rounded-2xl bg-page px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם או תפקיד"
            aria-label="חיפוש לפי שם או תפקיד"
            className="flex-1 border-0 bg-transparent p-0 text-right text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-0"
          />
          {query && (
            <button onClick={() => setQuery('')} className="shrink-0 text-ink-400" aria-label="ניקוי החיפוש">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-card bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          {filtered.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-ink-500">אין תוצאות</p>
          ) : (
            filtered.map((p, i) => (
              <PersonRow
                key={p.id}
                p={p}
                categories={categories}
                label={c => t(`categories.${c}`)}
                last={i === filtered.length - 1}
                open={openPerson === p.id}
                onOpen={() => setOpenPerson(openPerson === p.id ? null : p.id)}
                busyCell={busyCell}
                onToggle={(c, next) => togglePref(p, c, next)}
              />
            ))
          )}
        </div>
        {/* Stated where somebody is about to rely on it: the two halves are
            independent, and only one of them is the club's to decide. */}
        <p className="mt-1.5 px-2 text-3xs leading-relaxed text-ink-400">
          הניתוב שלמעלה קובע למי ההתראה נשלחת. המתגים כאן הם ההעדפות האישיות של כל אחד — אותם מתגים שהוא רואה אצלו בהגדרות —
          ואם הוא כיבה את ערוץ הניהול, הוא לא יקבל גם אם הוא מנותב.
        </p>
      </div>
    </div>
  );
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-2 text-3xs font-semibold uppercase tracking-[0.09em] text-ink-400">{children}</p>
  );
}

/**
 * One resolved recipient. The device count is the point: a name with no device
 * is on every list and hears nothing, and that was unanswerable from the app.
 */
function RecipientChip({ r }: { r: Recipient }) {
  const blocked = r.devices === 0 || r.muted;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-3xs',
        blocked ? 'border-accent-red/40 bg-accent-red/5' : 'border-ink-300/50 bg-page',
      )}
    >
      <span className="font-semibold text-ink-900">{r.name}</span>
      <span className="text-ink-400">{ROLE_LABEL[r.role] || r.role}</span>
      {r.devices === 0 ? (
        <span className="flex items-center gap-0.5 font-semibold text-accent-red">
          <BellOff className="h-3 w-3" />ללא מכשיר
        </span>
      ) : (
        <span className="flex items-center gap-0.5 text-ink-400">
          <Smartphone className="h-3 w-3" />{r.devices}
        </span>
      )}
      {r.muted && <span className="font-semibold text-accent-red">· כיבה אצלו</span>}
    </span>
  );
}

/**
 * One club member, collapsed to a summary and expandable to their eight
 * switches. Collapsed by default: 26 people × 8 rows is not a screen anybody
 * reads, and the summary ("6 מתוך 8 ערוצים · 3 מכשירים") is the overview.
 */
function PersonRow({
  p, categories, label, last, open, onOpen, busyCell, onToggle,
}: {
  p: Person;
  categories: string[];
  label: (category: string) => string;
  last: boolean;
  open: boolean;
  onOpen: () => void;
  busyCell: string | null;
  onToggle: (category: string, next: boolean) => void;
}) {
  const staff = isStaffRole(p.role);
  // The management row is hidden for a runner for the same reason it's hidden on
  // their own Settings screen: nothing sends them a management alert, so the
  // switch would be a control over nothing.
  const rows = categories.filter(c => !CATEGORY_META[c].staffOnly || staff);
  const on = rows.filter(c => p.prefs[c] !== false).length;

  return (
    <div className={cn(!last && 'border-b border-page')}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        className="flex min-h-[60px] w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-start active:bg-page/40"
      >
        <div className="min-w-0 flex-1">
          {/* stopPropagation: the row is a role="button" div that expands the
              switches on click and on Enter/Space, so without it the name would
              navigate AND leave an accordion open behind you. `p.id` is the
              athlete id — it is what the toggle POSTs as `athleteId`. */}
          <AthleteLink athleteId={p.id} name={p.name} className="block min-w-0" stopPropagation>
            <span className="block truncate text-sm font-semibold text-ink-900" dir="auto">{p.name}</span>
          </AthleteLink>
          <span className="mt-1 flex items-center gap-1.5">
            <span className="shrink-0 rounded border border-ink-300/50 bg-page px-1.5 py-0.5 text-3xs font-bold text-ink-700">
              {ROLE_LABEL[p.role] || p.role}
            </span>
            <span className="text-3xs text-ink-400">{on} מתוך {rows.length} ערוצים</span>
            {/* A member with no registered device receives no push at all,
                whatever these switches say — so it's on the collapsed row. */}
            {p.devices === 0 ? (
              <span className="flex items-center gap-0.5 text-3xs font-semibold text-accent-red">
                <BellOff className="h-3 w-3" />ללא מכשיר
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-3xs text-ink-400">
                <Smartphone className="h-3 w-3" />{p.devices}
              </span>
            )}
          </span>
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
      </div>

      {open && (
        <div className="divide-y divide-page border-t border-page bg-page/40">
          {rows.map(c => {
            const meta = CATEGORY_META[c];
            const Icon = meta.icon;
            const cell = `${p.id}:${c}`;
            const text = label(c);
            return (
              <div key={c} className="flex min-h-[44px] items-center gap-2.5 px-3.5 py-1.5">
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', meta.bg)}>
                  <Icon className="h-3.5 w-3.5 text-white" />
                </span>
                <span className="flex-1 text-13 font-medium text-ink-900" dir="auto">{text}</span>
                <Switch
                  checked={p.prefs[c] !== false}
                  onChange={next => onToggle(c, next)}
                  disabled={busyCell === cell}
                  loading={busyCell === cell}
                  size="sm"
                  activeColor="bg-accent-600"
                  ariaLabel={`${p.name} — ${text}`}
                />
              </div>
            );
          })}
          {/* Where the club-wide half of this person's mail is decided. */}
          {staff && (
            <p className="flex items-center gap-1.5 px-3.5 py-2 text-3xs text-ink-400">
              <Bell className="h-3 w-3 shrink-0" />
              אילו התראות ניהול נשלחות אליו נקבע בניתוב שלמעלה, לפי התפקיד.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
