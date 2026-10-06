'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, KeyRound, Link2 } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, InsetRow, InsetSection, Sheet, Switch } from '@/components/ui';
import { fmtRate, initialsOf, type AcademyMember, type AcademyMembersResponse } from './types';

/**
 * The manager's block at the top of the academy overview: the things only the
 * person who runs the academy decides. Is it taking sign-ups (the switch for
 * /academy and /academy-register, lib/academy/registration.ts), who coaches, how
 * loaded each coach is, and who has nobody.
 *
 * Shown for the academy scope only (the server's answer, not a role guess), and
 * above the week on purpose: it is also the setup screen, so it must be there
 * while the academy is still empty. A coach opens into their caseload; a trainee
 * anywhere here opens the same member sheet as everywhere else, which is where a
 * coach is assigned or changed.
 */
export function AcademyManagerPanel({
  data,
  onSelectMember,
  canEditRoles,
}: {
  data: AcademyMembersResponse | undefined;
  onSelectMember: (member: AcademyMember) => void;
  /** The roles screen is the admin's; an academy manager who isn't one gets no dead link. */
  canEditRoles: boolean;
}) {
  const members = data?.members ?? [];
  const coaches = (data?.coaches ?? []).filter((c) => c.coachId);
  const unpaired = members.filter((m) => !m.academyCoachId);
  const [openCoach, setOpenCoach] = useState<string | null>(null);
  const caseload = openCoach ? members.filter((m) => m.academyCoachId === openCoach) : [];
  const openCoachName = coaches.find((c) => c.coachId === openCoach)?.coachName ?? '';

  return (
    <div className="space-y-4">
      <RegistrationSwitch />

      <div>
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <h2 className="text-sm font-bold text-ink-700">
            מאמנים
            {coaches.length > 0 && <span className="ms-1.5 font-semibold text-ink-400">{coaches.length}</span>}
          </h2>
        </div>
        {coaches.length === 0 ? (
          <Card className="p-4 text-sm leading-relaxed text-ink-500">
            עוד אין מאמני אקדמיה. נותנים את התפקיד &quot;מאמן אקדמיה&quot; במסך התפקידים, ואז משבצים לו מתאמנים מכרטיס המתאמן.
          </Card>
        ) : (
          <Card className="divide-y divide-page py-1">
            {coaches.map((c) => (
              <button
                key={c.coachId}
                onClick={() => setOpenCoach(c.coachId)}
                className="flex w-full min-h-[56px] items-center gap-3 py-2.5 text-start active:bg-page/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {initialsOf(c.coachName || '?')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-700" dir="auto">{c.coachName}</span>
                  <span className="block text-xs text-ink-400">
                    {c.trainees === 0 ? 'עוד אין מתאמנים' : c.trainees === 1 ? 'מתאמן אחד' : `${c.trainees} מתאמנים`}
                    {c.trainees > 0 && c.completionRate !== null && <> · {fmtRate(c.completionRate)} בתוכנית</>}
                  </span>
                </span>
                {c.unpaced > 0 && (
                  <span className="shrink-0 rounded-pill bg-band-3/15 px-2 py-0.5 text-3xs font-bold text-band-3-ink">
                    {c.unpaced} בלי קצבים
                  </span>
                )}
                <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
              </button>
            ))}
          </Card>
        )}
      </div>

      {unpaired.length > 0 && (
        <div className="rounded-card border border-band-3/30 bg-band-3/10 p-3.5">
          <div className="flex items-center gap-2 text-sm font-bold text-band-3-ink">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {unpaired.length === 1 ? 'מתאמן אחד בלי מאמן' : `${unpaired.length} מתאמנים בלי מאמן`}
          </div>
          <p className="mt-1 text-xs text-ink-500">הקשה על שם פותחת את הכרטיס, ושם בוחרים מאמן.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unpaired.map((m) => (
              <button
                key={m.athleteId}
                onClick={() => onSelectMember(m)}
                className="min-h-[36px] rounded-pill bg-card px-3 text-sm font-semibold text-ink-700 active:bg-page"
                dir="auto"
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {canEditRoles && (
        <InsetSection className="mb-0">
          <InsetRow icon={KeyRound} iconBg="bg-ink-500" label="תפקידים" sublabel="מי מאמן אקדמיה, מי מנהל" href="/dashboard/roles" />
        </InsetSection>
      )}

      <Sheet open={!!openCoach} onOpenChange={(o) => { if (!o) setOpenCoach(null); }} title={openCoachName}>
        {caseload.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-ink-400">עוד אין לו מתאמנים. משבצים מכרטיס המתאמן.</p>
        ) : (
          <Card className="divide-y divide-page py-1">
            {[...caseload].sort((x, y) => x.name.localeCompare(y.name)).map((m) => (
              <button
                key={m.athleteId}
                onClick={() => { setOpenCoach(null); onSelectMember(m); }}
                className="flex w-full min-h-[52px] items-center gap-3 py-2.5 text-start active:bg-page/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-xs font-bold text-brand-600">
                  {initialsOf(m.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-700" dir="auto">{m.name}</span>
                  <span className="block text-xs text-ink-400">
                    {m.band?.name ?? 'בלי דבוקה'} · {m.weekRuns} ריצות השבוע
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className={cn('block text-sm font-bold tabular-nums', m.completionRate === null ? 'text-ink-400' : 'text-ink-700')}>
                    {fmtRate(m.completionRate)}
                  </span>
                  <span className="block text-3xs text-ink-400">בתוכנית</span>
                </span>
              </button>
            ))}
          </Card>
        )}
        <p className="mt-3 px-1 text-xs text-ink-400">להעביר מתאמן למאמן אחר: פותחים את הכרטיס שלו ובוחרים מאמן.</p>
      </Sheet>
    </div>
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
