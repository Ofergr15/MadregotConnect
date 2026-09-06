'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, Search, X } from 'lucide-react';
import { Card, LoadingBlock } from '@/components/ui';
import CoreRunnerBadge from '@/components/CoreRunnerBadge';
import { apiHeaders, useApi } from '@/lib/api';
import { cn, resolveGroup } from '@/lib/utils';
import { CORE_RUNNER_LABEL_PLURAL, CORE_RUNNER_MARK } from '@/lib/core-runner';

/**
 * Settings → הגרעין. The one place that answers "who is in the core squad?" and
 * the one place that changes it.
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 * הגרעין shipped as a value in `athletes.role`, editable only from the User
 * Manager's role dropdown — a control that also decides whether somebody is a
 * coach. So marking a core runner meant browsing a role list, and marking a
 * COACH as a core runner was impossible. Migration 091 split the two; this
 * screen is the flag's own home.
 *
 * ── THE THREE THINGS IT HAS TO MAKE OBVIOUS ─────────────────────────────────
 * 1. Who is in — a list, with the count, in one place.
 * 2. That being in is orthogonal to their role. Hence the role chip on every row:
 *    seeing "מאמן 🌰" is the fastest way to understand what changed.
 * 3. What being in actually GRANTS. Two links out, because neither is guessable:
 *    the perks are edited in Perks Manager (tier = רצי הגרעין) and the pages they
 *    can reach are the `core_runner` column of Tab Manager, which is now unioned
 *    onto their own role's tabs rather than replacing it (see resolveNavItems).
 *
 * Deliberately NOT a role dropdown and not a bulk action: this is a small,
 * high-value list (a free annual gym membership, a shoe allocation) that changes
 * a few times a season. One switch per person, no multi-select to mis-tap.
 */

interface CoreAthlete {
  id: string;
  name: string;
  email: string;
  role: string;
  groupId: string | null;
  status: string | null;
  isCoreRunner: boolean;
  /** In via the legacy `role = 'core_runner'` only — see core-runner.ts. */
  isLegacy: boolean;
}

/** Hebrew role labels, matching the Role Manager's own chips. */
const ROLE_LABEL: Record<string, string> = {
  admin: 'מנהל',
  coach: 'מאמן',
  academy_coach: 'מאמן אקדמיה',
  runner: 'רץ',
  core_runner: 'רץ גרעין (מדור קודם)',
  academy_user: 'אקדמיה',
  viewer: 'צופה',
};

export default function CoreRunnersManager() {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, mutate } = useApi<{ athletes?: CoreAthlete[]; migrated?: boolean }>(
    '/api/admin/core-runners',
  );
  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> }>('/api/groups');

  const athletes = useMemo(() => data?.athletes || [], [data]);
  const members = useMemo(() => athletes.filter(a => a.isCoreRunner), [athletes]);
  const legacyCount = members.filter(a => a.isLegacy).length;

  const groupLabel = (groupId: string | null) => {
    const g = (groupsData?.groups || []).find(x => x.id === groupId);
    if (!g) return null;
    const resolved = resolveGroup(g.name);
    return { name: resolved.displayName, hex: resolved.hex };
  };

  /** The candidate list. Search is the only filter, and it covers name AND email
   *  because half the club's rows have a name and the other half an address. */
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? athletes.filter(a => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
      : athletes.filter(a => !a.isCoreRunner);
    // Members first when searching, so a hit that is already in reads as "already in".
    return [...pool].sort((a, b) => Number(b.isCoreRunner) - Number(a.isCoreRunner));
  }, [athletes, query]);

  const toggle = async (a: CoreAthlete, next: boolean) => {
    setBusyId(a.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/core-runners', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: a.id, isCoreRunner: next }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          out.error === 'migration-missing'
            ? 'צריך להריץ קודם את המיגרציה 091 ב-Supabase.'
            : out.error || 'הפעולה נכשלה',
        );
      }
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הפעולה נכשלה');
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading && athletes.length === 0) return <LoadingBlock tone="ink" />;

  return (
    <div dir="rtl">
      <div>
        <h2 className="text-[22px] font-extrabold text-ink-900 leading-tight">
          {CORE_RUNNER_MARK} {CORE_RUNNER_LABEL_PLURAL}
        </h2>
        <p className="mt-0.5 text-xs">
          <span className="font-semibold text-ink-900">
            {members.length === 0 ? 'אף אחד לא בגרעין' : `${members.length} בגרעין`}
          </span>
          <span className="text-ink-400"> · מתוך {athletes.length} חברי מועדון</span>
        </p>
      </div>

      {/* Migrations are pasted in by hand, so this is a state a reader hits. The
          list above is still correct without the column (the legacy role is
          readable), so this says "cannot edit" and not "broken". */}
      {data?.migrated === false && (
        <Card className="mt-3 p-4">
          <p className="text-sm font-semibold text-ink-900">העמודה עוד לא נוצרה</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            צריך להריץ את <code dir="ltr">supabase/migrations/091_athlete_core_runner_flag.sql</code> ב-Supabase SQL editor.
            עד אז הרשימה למטה נכונה אבל לא ניתן לשנות אותה.
          </p>
        </Card>
      )}

      {error && <p className="mt-3 text-sm leading-relaxed text-accent-red">{error}</p>}

      {/* What membership is WORTH. Two links, because neither destination is
          guessable from this screen and both are already built. */}
      <div className="mt-4">
        <SectionCaption>מה הגרעין מקבל</SectionCaption>
        <div className="overflow-hidden rounded-card bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          <Link
            href="/dashboard/settings?tab=perks"
            className="flex min-h-[52px] items-center gap-2.5 border-b border-page px-4 active:bg-page/40"
          >
            <span className="flex-1 text-13 font-medium text-ink-900">הטבות הספונסרים</span>
            <span className="text-3xs text-ink-400">Perks Manager · דרגה: רצי הגרעין</span>
            <ChevronLeft className="h-4 w-4 shrink-0 text-ink-400" />
          </Link>
          <Link
            href="/dashboard/settings?tab=tabs"
            className="flex min-h-[52px] items-center gap-2.5 px-4 active:bg-page/40"
          >
            <span className="flex-1 text-13 font-medium text-ink-900">הרשאות ומסכים</span>
            <span className="text-3xs text-ink-400">Tab Manager · עמודת core_runner</span>
            <ChevronLeft className="h-4 w-4 shrink-0 text-ink-400" />
          </Link>
        </div>
        {/* The additive rule, stated where somebody is about to rely on it. It is
            the non-obvious half of the design: the גרעין's tabs are added to the
            person's own role, they do not replace it. */}
        <p className="mt-1.5 px-2 text-3xs leading-relaxed text-ink-400">
          המסכים שמסומנים ל-<span dir="ltr">core_runner</span> ב-Tab Manager נוספים למה שהתפקיד של האתלט כבר מרשה — הם לא מחליפים אותו.
          כך מאמן שנמצא בגרעין מקבל את שניהם.
        </p>
      </div>

      {/* Rows still recorded the old way. Surfaced rather than silently migrated:
          converting rewrites `role`, which changes their tab permissions, and that
          is not a change to make behind somebody's back. */}
      {legacyCount > 0 && (
        <Card className="mt-4 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {legacyCount} רשומים בשיטה הישנה
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            אצלם הגרעין שמור בתוך התפקיד (<span dir="ltr">role = core_runner</span>), ולכן הם לא יכולים להיות במקביל מאמנים או מנהלים.
            אפשר לשנות להם תפקיד ל&quot;רץ&quot; ב-User Manager — הסימון של הגרעין יישאר.
          </p>
        </Card>
      )}

      {/* ── WHO IS IN ── */}
      <div className="mt-4">
        <SectionCaption>בגרעין · {members.length}</SectionCaption>
        <div className="overflow-hidden rounded-card bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          {members.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-ink-500">אף אחד עדיין. אפשר להוסיף מהרשימה למטה.</p>
          ) : (
            members.map((a, i) => (
              <AthleteRow
                key={a.id}
                a={a}
                group={groupLabel(a.groupId)}
                last={i === members.length - 1}
                busy={busyId === a.id}
                disabled={data?.migrated === false}
                onToggle={() => toggle(a, false)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── EVERYONE ELSE ── */}
      <div className="mt-4">
        <SectionCaption>{query ? 'תוצאות החיפוש' : 'להוספה'}</SectionCaption>
        <div className="mb-2 flex h-10 items-center gap-2 rounded-2xl bg-page px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם או אימייל"
            aria-label="חיפוש לפי שם או אימייל"
            className="flex-1 border-0 bg-transparent p-0 text-right text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-0"
          />
          {query && (
            <button onClick={() => setQuery('')} className="shrink-0 text-ink-400" aria-label="ניקוי החיפוש">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-card bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          {candidates.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-ink-500">
              {query ? 'אין תוצאות' : 'כל חברי המועדון בגרעין'}
            </p>
          ) : (
            candidates.map((a, i) => (
              <AthleteRow
                key={a.id}
                a={a}
                group={groupLabel(a.groupId)}
                last={i === candidates.length - 1}
                busy={busyId === a.id}
                disabled={data?.migrated === false}
                onToggle={() => toggle(a, !a.isCoreRunner)}
              />
            ))
          )}
        </div>
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
 * One club member. The role chip is not decoration: it is what makes the
 * orthogonality legible ("מאמן" and 🌰 on the same row is the whole feature).
 */
function AthleteRow({
  a, group, last, busy, disabled, onToggle,
}: {
  a: CoreAthlete;
  group: { name: string; hex: string } | null;
  last: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn('flex min-h-[64px] items-center gap-2.5 px-3.5 py-2.5', !last && 'border-b border-page')}>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink-900">{a.name || a.email}</span>
          {a.isCoreRunner && <CoreRunnerBadge />}
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          <span className="shrink-0 rounded border border-ink-300/50 bg-page px-1.5 py-0.5 text-3xs font-bold text-ink-700">
            {ROLE_LABEL[a.role] || a.role}
          </span>
          {group && (
            <span className="flex shrink-0 items-center gap-1 text-3xs text-ink-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: group.hex }} aria-hidden="true" />
              {group.name}
            </span>
          )}
          {a.name && (
            <span dir="ltr" className="truncate text-3xs text-ink-400">{a.email}</span>
          )}
        </span>
      </div>

      {/* An iOS switch, not a checkbox and not an "אשר" button: this is a
          persistent yes/no about a person, which is exactly what a switch means.
          44px tall hit area even though the track is 28. */}
      <button
        onClick={onToggle}
        disabled={busy || disabled}
        role="switch"
        aria-checked={a.isCoreRunner}
        aria-label={`${a.name || a.email} — רץ גרעין`}
        className={cn(
          'relative h-[30px] w-[50px] shrink-0 rounded-pill transition-colors disabled:opacity-40',
          a.isCoreRunner ? 'bg-ink-900' : 'bg-ink-300/50',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] h-6 w-6 rounded-full bg-card shadow-sm transition-all',
            // Logical insets, so this mirrors with the document: in this RTL app
            // "on" lands the knob at the LEFT edge, which is what iOS does in RTL.
            a.isCoreRunner ? 'end-[3px]' : 'start-[3px]',
          )}
        />
      </button>
    </div>
  );
}
