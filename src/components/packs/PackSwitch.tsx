'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Watch } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn, israelToday, resolveGroup } from '@/lib/utils';
import { groupChangeDate } from '@/lib/groups/pending-change';

// ═════════════════════════════════════════════════════════════════════════════
// Changing a member's pack in one place (mockup: ~/.cache/madregot/pack-change/
// switch-mockup.html). The same three tiles everywhere — the coach's sheet on the
// people card, the people list and the roster, and the member's own profile —
// with the current pack marked, so nobody has to remember who is where.
// ═════════════════════════════════════════════════════════════════════════════

export interface PackGroup {
  id: string;
  name: string;
  marathonGoal?: string | null;
}

/** "18.10" — the day a Saturday change lands. */
export const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

/** The pack's number (1–3) by the same name rule the rest of the app uses; 0 = not a pack. */
export const laneOf = (name: string | null | undefined) => resolveGroup(name).index + 1;

/** The three packs in order ❶❷❸, then anything the name rule doesn't know. */
export function orderedPacks(groups: PackGroup[]): PackGroup[] {
  const rank = (g: PackGroup) => laneOf(g.name) || 99;
  return [...groups].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The round pack number, in the pack's own chip colours. */
export function PackNumber({ name, size = 'sm' }: { name: string | null | undefined; size?: 'sm' | 'lg' }) {
  const g = resolveGroup(name);
  const n = g.index + 1;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-black tabular-nums',
        g.colors.chip.bg, g.colors.chip.text,
        size === 'lg' ? 'h-9 w-9 text-base' : 'h-6 w-6 text-xs',
      )}
    >
      {n > 0 ? n : '–'}
    </span>
  );
}

/** The tag a coach taps to open the sheet: "③ דבוקה 3 ‹", or just "③ ‹" in a list row. */
export function PackChip({
  name, compact = false, onClick, label,
}: { name: string | null | undefined; compact?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-pill bg-page px-2.5 text-sm font-bold text-ink-700 active:opacity-70"
    >
      <PackNumber name={name} />
      {!compact && <span>{label}</span>}
      <span aria-hidden className="text-ink-400">‹</span>
    </button>
  );
}

/** Three tiles, current marked "now", the picked one outlined. Shared with the profile. */
export function PackTiles({
  groups, currentId, pickedId, onPick, pendingId,
}: {
  groups: PackGroup[];
  currentId: string | null | undefined;
  pickedId: string | null;
  onPick: (id: string) => void;
  /** A move already waiting for Saturday — labelled, so it isn't asked for twice. */
  pendingId?: string | null;
}) {
  const t = useTranslations('packSwitch');
  return (
    <div className="grid grid-cols-3 gap-2 pt-2">
      {orderedPacks(groups).map((g) => {
        const now = g.id === currentId;
        const picked = g.id === pickedId;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g.id)}
            aria-pressed={picked}
            className={cn(
              'relative flex min-h-[104px] flex-col items-center justify-center gap-1 rounded-[18px] border-2 px-1.5 py-3 text-center active:opacity-80',
              now ? 'border-transparent bg-page' : 'border-page bg-card',
              picked && 'border-brand-600 bg-card shadow-[0_0_0_3px_rgba(21,37,255,0.12)]',
            )}
          >
            {now && (
              <span className="absolute -top-2.5 inset-x-0 mx-auto w-max rounded-md bg-ink-900 px-2 py-px text-3xs font-extrabold text-white">
                {t('now')}
              </span>
            )}
            {!now && pendingId === g.id && (
              <span className="absolute -top-2.5 inset-x-0 mx-auto w-max rounded-md bg-band-3 px-2 py-px text-3xs font-extrabold text-white">
                {t('fromSatShort')}
              </span>
            )}
            <PackNumber name={g.name} size="lg" />
            <span className="text-xs font-bold text-ink-700">{t('packN', { n: laneOf(g.name) || '–' })}</span>
            {g.marathonGoal && <bdi dir="ltr" className="text-[11.5px] text-ink-400">{g.marathonGoal}</bdi>}
          </button>
        );
      })}
    </div>
  );
}

export interface PackMove {
  athleteId: string;
  athleteName: string;
  fromGroupId: string | null;
  toGroupId: string;
  /** 'today' moves now; 'saturday' schedules it like the member's own change (#96). */
  when: 'today' | 'saturday';
}

async function sendMove(m: PackMove, keepalive = false): Promise<boolean> {
  const body = m.when === 'today'
    ? { id: m.athleteId, groupId: m.toGroupId }
    : { id: m.athleteId, pendingGroupId: m.toGroupId };
  const res = await fetch('/api/athletes', {
    method: 'PUT',
    headers: await bearerHeaders(),
    body: JSON.stringify(body),
    keepalive,
  });
  return res.ok;
}

const UNDO_MS = 5000;

/**
 * The move waits five seconds behind an Undo before it is sent — so an undone move
 * never reaches the server, the history, or the member's phone. Leaving the page
 * sends it at once (keepalive) rather than dropping it.
 */
export function usePackMove(onSent: () => void) {
  const [pending, setPending] = useState<PackMove | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef<PackMove | null>(null);
  const sentRef = useRef(onSent);
  sentRef.current = onSent;

  const flush = useCallback(async (keepalive = false) => {
    const m = live.current;
    if (!m) return;
    live.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const ok = await sendMove(m, keepalive).catch(() => false);
    setPending(null);
    setFailed(!ok);
    sentRef.current();
  }, []);

  const move = useCallback((m: PackMove) => {
    // A second move while one is waiting: the first goes now, not lost.
    if (live.current) void flush();
    live.current = m;
    setFailed(false);
    setPending(m);
    timer.current = setTimeout(() => { void flush(); }, UNDO_MS);
  }, [flush]);

  const undo = useCallback(() => {
    live.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    const leave = () => { void flush(true); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, [flush]);

  return { pending, failed, move, undo, dismissFailed: () => setFailed(false) };
}

/** "✓ עומר עבר לדבוקה 2 · מהיום · ביטול" while the move waits. */
export function PackMoveToast({
  pending, failed, groups, onUndo, onDismiss,
}: {
  pending: PackMove | null;
  failed: boolean;
  groups: PackGroup[];
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('packSwitch');
  if (!pending && !failed) return null;
  const to = pending ? groups.find((g) => g.id === pending.toGroupId) : null;
  return (
    <div
      role="status"
      className="fixed inset-x-3.5 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[60] mx-auto flex max-w-md items-center gap-2.5 rounded-[18px] bg-ink-900 px-3.5 py-3 text-white shadow-lg"
    >
      {pending ? (
        <>
          <Check className="h-5 w-5 shrink-0" />
          <div className="min-w-0 text-sm">
            <p className="font-bold">{t('movedTitle', { name: pending.athleteName.split(' ')[0], n: laneOf(to?.name) || '–' })}</p>
            <p className="text-white/75">
              {pending.when === 'today'
                ? t('movedToday')
                : t('movedSaturday', { date: dayMonth(groupChangeDate(israelToday())) })}
            </p>
          </div>
          <button type="button" onClick={onUndo} className="ms-auto min-h-[44px] shrink-0 px-2 text-sm font-extrabold text-[#9fb0ff]">
            {t('undo')}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-bold">{t('failed')}</p>
          <button type="button" onClick={onDismiss} className="ms-auto min-h-[44px] shrink-0 px-2 text-sm font-extrabold text-[#9fb0ff]">
            {t('ok')}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The coach's sheet: who, the three tiles, from today / from Saturday, one button.
 */
export function PackSwitchSheet({
  open, onOpenChange, person, groups, onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: { id: string; name: string; groupId: string | null; pendingGroupId?: string | null; pendingFrom?: string | null } | null;
  groups: PackGroup[];
  onMove: (m: PackMove) => void;
}) {
  const t = useTranslations('packSwitch');
  const [picked, setPicked] = useState<string | null>(null);
  const [when, setWhen] = useState<'today' | 'saturday'>('today');
  useEffect(() => { if (open) { setPicked(null); setWhen('today'); } }, [open, person?.id]);

  if (!person) return null;
  const first = person.name.split(' ')[0];
  const current = groups.find((g) => g.id === person.groupId);
  const target = groups.find((g) => g.id === picked);
  const saturday = dayMonth(groupChangeDate(israelToday()));
  const canMove = !!picked && picked !== person.groupId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('sheetTitle', { name: first })}>
      <div className="px-4 pb-6">
        <p className="mb-3 text-center text-xs text-ink-400">
          {current ? t('keepsRuns', { n: laneOf(current.name) || '–' }) : t('noPackYet')}
        </p>
        {person.pendingGroupId && person.pendingFrom && (
          <p className="mb-3 rounded-xl bg-band-3/10 px-3 py-2 text-center text-xs font-medium text-ink-700">
            {t('alreadyPending', {
              n: laneOf(groups.find((g) => g.id === person.pendingGroupId)?.name) || '–',
              date: dayMonth(person.pendingFrom),
            })}
          </p>
        )}
        <PackTiles
          groups={groups}
          currentId={person.groupId}
          pickedId={picked}
          onPick={setPicked}
          pendingId={person.pendingGroupId}
        />
        <div className="mt-3.5 flex rounded-xl bg-page p-[3px]" role="radiogroup">
          {(['today', 'saturday'] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={when === w}
              onClick={() => setWhen(w)}
              className={cn(
                'min-h-[40px] flex-1 rounded-[10px] text-sm font-bold',
                when === w ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-500',
              )}
            >
              {w === 'today' ? t('fromToday') : t('fromSaturday', { date: saturday })}
            </button>
          ))}
        </div>
        <p className="mt-2.5 flex items-start gap-2 rounded-[14px] bg-accent-600/10 px-3 py-2 text-xs text-accent-900">
          <Watch className="mt-px h-4 w-4 shrink-0" />
          {t('watchStays')}
        </p>
        <button
          type="button"
          disabled={!canMove}
          onClick={() => {
            if (!canMove || !picked) return;
            onMove({ athleteId: person.id, athleteName: person.name, fromGroupId: person.groupId, toGroupId: picked, when });
            onOpenChange(false);
          }}
          className="mt-3.5 min-h-[50px] w-full rounded-pill bg-brand-600 text-base font-extrabold text-white disabled:opacity-40"
        >
          {target ? t('moveTo', { n: laneOf(target.name) || '–' }) : t('pickPack')}
        </button>
        <p className="mt-2 text-center text-xs text-ink-400">{t('willBeTold', { name: first })}</p>
      </div>
    </Sheet>
  );
}
