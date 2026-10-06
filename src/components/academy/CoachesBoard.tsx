'use client';

import { useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { ChevronLeft, UserPlus } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AcademyCoachesResponse } from '@/app/api/academy/coaches/route';
import {
  buildCoachCards,
  coachCapacityOf,
  coachSummaryParts,
  suggestedCoachId,
  unpairedTrainees,
  type CoachCard,
  type CoachRef,
} from '@/lib/academy/coach-board';
import { CoachesSheet } from './AcademyAdmin';
import { initialsOf, type AcademyMember } from './types';
import { memberCoachIds, memberCoachNames } from '@/lib/academy/members';

// ── אנשים → מאמנים ────────────────────────────────────────────────────────────
//
// Mockup v5, phone 3. One card per coach: who they hold, how much of the plan those
// trainees ran, who is not running, and a bar of the coach's places — filled, orange
// for the trainees who are behind, empty for what is free. A coach with free places
// while trainees sit unpaired gets "לשבץ אליו". The numbers are `buildCoachCards`
// (lib/academy/coach-board.ts, tested); this file draws.
//
// Adding and removing the role is CoachesSheet's, reused rather than redrawn: one
// place decides that a coach still holding trainees cannot be removed (and the route
// enforces it with a 409 either way).

/** The three coach colours of the mockup, by position — a coach's colour is not data. */
const COACH_TINTS = ['bg-brand-600', 'bg-accent-900', 'bg-[#5B21D6]'];

const FACES = 6;

function Face({ name, url, ring = 'ring-card', size = 26 }: { name: string; url?: string | null; ring?: string; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: size, height: size }} className={cn('shrink-0 rounded-full object-cover ring-2', ring)} />;
  }
  return (
    <span
      style={{ width: size, height: size }}
      className={cn('grid shrink-0 place-items-center rounded-full bg-brand-600/15 text-3xs font-extrabold text-brand-600 ring-2', ring)}
    >
      {initialsOf(name)}
    </span>
  );
}

function SummaryLine({ card }: { card: CoachCard }) {
  const parts = coachSummaryParts(card);
  return (
    <span className="block truncate text-xs text-ink-400">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p.value !== null && <><bdi dir="ltr">{p.value}</bdi> </>}
          {p.label}
        </span>
      ))}
    </span>
  );
}

export function CoachesBoard({
  members,
  onSelectMember,
  onOpenCoach,
  canManage,
}: {
  members: AcademyMember[];
  onSelectMember: (m: AcademyMember) => void;
  onOpenCoach?: (coachId: string) => void;
  canManage: boolean;
}) {
  // The coach list is the manager's read (it also lists who could be made a coach). A
  // coach looking at this board sees only the coaches their members name.
  const { data, mutate } = useApi<AcademyCoachesResponse>(canManage ? '/api/academy/coaches' : null);
  const { data: settingsData } = useApi<{ settings?: unknown }>('/api/academy/settings');
  const capacity = coachCapacityOf(settingsData?.settings);
  const { mutate: mutateKeys } = useSWRConfig();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Set<string>>(() => new Set());

  const coaches: CoachRef[] | null = useMemo(() => {
    if (canManage) return data ? data.coaches : null;
    const seen = new Map<string, CoachRef>();
    for (const m of members) {
      // Every coach a member names — a shared trainee names several.
      const names = memberCoachNames(m);
      memberCoachIds(m).forEach((id, i) => {
        if (!seen.has(id)) seen.set(id, { id, name: names[i] || '', avatarUrl: null, trainees: 0 });
      });
    }
    return [...seen.values()];
  }, [canManage, data, members]);

  // Trainees just placed are dropped locally at once, so a second tap on the next
  // coach cannot place the same people while the members refetch is in flight.
  const unpaired = useMemo(
    () => unpairedTrainees(members).filter((m) => !placed.has(m.athleteId)),
    [members, placed],
  );
  const cards = useMemo(
    () => (coaches ? buildCoachCards(coaches, members, capacity) : []),
    [coaches, members, capacity],
  );

  const suggested = canManage ? suggestedCoachId(cards, unpaired.length) : null;

  const openCoach = (card: CoachCard) => {
    if (card.trainees.length > 0 && onOpenCoach) { onOpenCoach(card.id); return; }
    if (!canManage) return;
    // No trainees: the caseload would be empty, so open the coaches list — which is
    // also where a coach with nobody can be removed.
    setFocus(card.trainees.length > 0 ? card.id : null);
    setSheetOpen(true);
  };

  const assign = async (card: CoachCard) => {
    const ids = unpaired.slice(0, card.free).map((m) => m.athleteId);
    if (!ids.length) return;
    setBusy(card.id);
    setFailed(null);
    try {
      const res = await fetch('/api/academy/members/bulk', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteIds: ids, action: 'coach', coachId: card.id, notify: true }),
      });
      if (!res.ok) throw new Error();
      setPlaced((prev) => new Set([...prev, ...ids]));
      // The members payload is the shell's; refresh every members read so the new
      // trainees land on this coach's card and leave the unpaired list.
      await Promise.all([
        mutate(),
        mutateKeys((key) => typeof key === 'string' && key.startsWith('/api/academy/members')),
      ]);
    } catch {
      setFailed(card.id);
    } finally {
      setBusy(null);
    }
  };

  if (!coaches) {
    return (
      <div className="space-y-2.5" aria-busy>
        {[0, 1, 2].map((i) => <div key={i} className="h-[118px] animate-pulse rounded-card bg-card/60" />)}
      </div>
    );
  }

  return (
    <div className="space-y-2.5" dir="rtl">
      {cards.length === 0 && (
        <div className="rounded-card bg-card px-4 py-5 text-center text-sm text-ink-500">
          {canManage ? 'עוד אין מאמני אקדמיה.' : 'אין מאמנים להציג.'}
        </div>
      )}

      {cards.map((card, i) => {
        const taken = card.trainees.length;
        const offer = card.id === suggested;
        const toPlace = Math.min(card.free, unpaired.length);
        return (
          <div key={card.id} className="rounded-card bg-card p-3">
            <button
              type="button"
              onClick={() => openCoach(card)}
              className="flex min-h-[44px] w-full items-center gap-2.5 text-start"
              aria-label={`${card.name}, ${taken} מתאמנים`}
            >
              {card.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-extrabold text-white', COACH_TINTS[i % COACH_TINTS.length])}>
                  {initialsOf(card.name)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-extrabold text-ink-900" dir="auto">{card.name}</span>
                <SummaryLine card={card} />
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
            </button>

            {/* The places. Orange is the trainees behind or not running — the same
                band-3 the members list wears for "behind". */}
            <div className="mb-2 mt-2.5 flex gap-1" aria-hidden>
              {card.slots.map((s, k) => (
                <i
                  key={k}
                  className={cn(
                    'h-2 flex-1 rounded-full',
                    s === 'filled' ? 'bg-brand-600' : s === 'behind' ? 'bg-band-3' : 'bg-page',
                  )}
                />
              ))}
            </div>

            <div className="flex min-h-[32px] items-center justify-between gap-2">
              {taken > 0 ? (
                <div className="flex ps-2">
                  {card.trainees.slice(0, FACES).map((m) => (
                    <button
                      key={m.athleteId}
                      type="button"
                      onClick={() => onSelectMember(m)}
                      aria-label={m.name}
                      className="-ms-2 grid h-11 w-8 place-items-center first:ms-0"
                    >
                      <Face name={m.name} url={m.avatarUrl} />
                    </button>
                  ))}
                  {taken > FACES && (
                    <span className="-ms-1 grid h-11 place-items-center px-1 text-2xs font-bold text-ink-400">
                      +<bdi dir="ltr">{taken - FACES}</bdi>
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-xs font-bold text-accent-900">
                  פנוי לקבל <bdi dir="ltr">{card.capacity}</bdi>
                </span>
              )}

              {offer ? (
                <button
                  type="button"
                  onClick={() => void assign(card)}
                  aria-label={toPlace === 1 ? `לשבץ מתאמן אחד אל ${card.name}` : `לשבץ ${toPlace} מתאמנים אל ${card.name}`}
                  disabled={busy !== null}
                  className="min-h-[44px] shrink-0 rounded-xl bg-brand-600/10 px-3 text-xs font-extrabold text-brand-600 disabled:opacity-50"
                >
                  {failed === card.id
                    ? 'נכשל, שוב'
                    : busy === card.id
                      ? '…'
                      : 'לשבץ אליו'}
                </button>
              ) : taken > 0 ? (
                <span className="shrink-0 text-xs font-bold text-ink-500">
                  <bdi dir="ltr">{taken}</bdi> מתוך <bdi dir="ltr">{card.capacity}</bdi> מקומות
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {canManage && (
        <button
          type="button"
          onClick={() => { setFocus(null); setSheetOpen(true); }}
          className="flex h-[58px] w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-ink-300 text-sm font-extrabold text-brand-600 active:bg-card/60"
        >
          <UserPlus className="h-5 w-5" />
          מאמן חדש
        </button>
      )}

      {canManage && (
        <CoachesSheet
          open={sheetOpen}
          onOpenChange={(o) => { setSheetOpen(o); if (!o) { setFocus(null); void mutate(); } }}
          members={members}
          onSelectMember={onSelectMember}
          focusCoach={focus}
        />
      )}
    </div>
  );
}
