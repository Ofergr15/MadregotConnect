'use client';

import Link from 'next/link';
import { ChevronLeft, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { placeCandidate, STAGES, type CandidateEvent, type CandidateRow, type StageOwner } from '@/lib/academy/funnel';

// "בתהליך האקדמיה" — the academy applicants that used to sit in the approvals list.
//
// They were there because the academy form writes an unapproved athletes row, and
// the list is "everyone unapproved". But nobody here is waiting for an approve tap:
// the academy's intro and characterization calls come first, and access opens from
// the academy screen when they are admitted (lib/academy/admit-server.ts). So no
// approve button, only where they are in the intake and the way to it.

export interface AcademyApplicant {
  id: string;
  name: string;
  email: string;
  createdAt?: string | null;
}

type Candidate = CandidateRow & { email?: string | null; invitedAt?: string | null };

const OWNER_LABEL: Record<StageOwner, string> = {
  manager: 'מנהל',
  coach: 'מאמן',
  trainee: 'המתאמן',
};

/** "נרשם דרך" for an academy applicant: always the form, and how they reached it. */
export function academyDoor(c: { source?: string | null; invitedAt?: string | null } | null | undefined): string {
  if (!c) return 'טופס האקדמיה';
  if (c.invitedAt) return 'טופס האקדמיה · הזמנה אישית';
  if (c.source === 'instagram') return 'טופס האקדמיה · מאינסטגרם';
  return 'טופס האקדמיה · קישור לטופס';
}

function daysAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'מילא טופס היום' : days === 1 ? 'מילא טופס אתמול' : `מילא טופס לפני ${days} ימים`;
}

export function AcademyIntakeList({ applicants }: { applicants: AcademyApplicant[] }) {
  // The board's own rows, placed here with the board's own function, so the step a
  // card names is the step the academy board shows. Staff-only, like this screen.
  const { data } = useApi<{ candidates?: Candidate[]; events?: CandidateEvent[] }>(
    applicants.length ? '/api/academy/candidates' : null,
  );
  if (!applicants.length) return null;

  const candidates = data?.candidates || [];
  const events = data?.events || [];
  const now = new Date().toISOString();
  const find = (a: AcademyApplicant) =>
    candidates.find(c => c.athleteId === a.id && !c.archivedAt) ||
    candidates.find(c => !c.archivedAt && !!c.email && c.email.toLowerCase() === a.email.toLowerCase());

  return (
    <div className="rounded-2xl border border-[#F4C6DA] bg-[#FDEBF3]/60 p-4">
      <div className="flex items-center gap-2 min-h-[36px]">
        <GraduationCap className="w-4 h-4 text-[#A3175A]" />
        <h3 className="text-sm font-semibold text-[#A3175A]">בתהליך האקדמיה ({applicants.length})</h3>
      </div>
      <p className="text-xs text-ink-400 mb-3 leading-relaxed">
        לא מחכים לאישור שלך, אלא לשלב הבא. הגישה לאפליקציה נפתחת מתוך האקדמיה, אחרי השיחות.
      </p>
      <div className="space-y-2">
        {applicants.map(a => {
          const c = find(a);
          const placed = c ? placeCandidate(c, events, now) : null;
          const spec = placed?.waitingFor ? STAGES.find(s => s.key === placed.waitingFor) : null;
          return (
            <div key={a.id} className="p-3 rounded-xl bg-card/80">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#FDEBF3] flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-[#A3175A]">
                    {a.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-700 truncate" dir="auto">{a.name}</p>
                  <p className="text-xs text-ink-400 truncate">{daysAgo(c?.createdAt || a.createdAt)}</p>
                  <p className="text-3xs text-ink-400 truncate">נרשם דרך: {academyDoor(c)}</p>
                </div>
                <Link
                  href="/dashboard/academy?tab=funnel"
                  className="flex items-center gap-1 px-3 min-h-[44px] rounded-lg bg-[#FDEBF3] text-xs font-bold text-[#A3175A] shrink-0"
                >
                  לאקדמיה
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Link>
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-3xs font-semibold px-2 py-1 rounded-md bg-[#FDEBF3] text-[#A3175A]">
                  {spec ? spec.waiting : 'בתהליך האקדמיה'}
                </span>
                {placed?.stuck && (
                  <span className="text-3xs font-semibold px-2 py-1 rounded-md bg-accent-red/10 text-accent-red">
                    תקוע {placed.daysWaiting} ימים
                  </span>
                )}
                {placed?.owner && (
                  <span className="text-3xs font-medium px-2 py-1 rounded-md bg-page/60 text-ink-500">
                    אחראי: {OWNER_LABEL[placed.owner]}
                  </span>
                )}
              </div>
              {placed && (
                <div className="flex gap-[3px] mt-2.5" aria-hidden>
                  {STAGES.map(s => (
                    <i
                      key={s.key}
                      className={cn(
                        'h-1 flex-1 rounded-sm',
                        placed.done.includes(s.key) ? 'bg-[#A3175A]' : s.key === placed.waitingFor ? 'bg-[#F4A6C8]' : 'bg-page',
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
