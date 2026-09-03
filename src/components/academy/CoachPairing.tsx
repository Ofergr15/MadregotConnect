'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Gauge, Layers, Target, UserMinus, UserRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { InsetRow, InsetSection, Spinner } from '@/components/ui';
import {
  MAX_PACE_OFFSET_SEC, MIN_PACE_OFFSET_SEC, effectiveOffsetSec, fmtOffsetSec, offsetSource,
  sortBands, type AcademyBand,
} from '@/lib/academy/bands';
import type { AcademyCoachSummary, AcademyMember } from './types';

// Who coaches this trainee, what they're training for, and what paces they run —
// the three facts a 1:1 online academy is made of, edited where they're read.
//
// All three live inside MemberSheet rather than on a screen of their own, because
// "who coaches Maya, and can she hold 4:30?" always arrives while looking at
// Maya. The pickers expand inline instead of opening a second sheet: a drawer on
// top of a drawer fights the parent's drag-to-dismiss, and nothing here needs
// more room than the sheet already has.
//
// Permissions are split, and the split is the point:
//   • the coach — a management decision, manager only.
//   • the goal band (דבוקה) — an enrolment decision, manager only. It's what the
//     trainee asked for at registration.
//   • the pace override — a coaching decision about what this person can run
//     today, so their own dedicated coach may set it too.
// The API enforces the same rule; this only decides what's worth showing.

type Mode = 'idle' | 'coach' | 'band' | 'pace';

/**
 * Quick offsets, in sec/km. Not a scale of anything — just the values a coach
 * reaches for, so the common case is one tap and the box is there for the rest.
 */
const OFFSET_PRESETS = [0, 15, 30, 45, 60, 90];

export function CoachPairing({
  member,
  coaches,
  bands,
  canAssign,
  onChanged,
}: {
  member: AcademyMember;
  /** The academy's coach roster, idle ones included. Empty for a non-manager. */
  coaches: AcademyCoachSummary[];
  /** The academy's goal bands, with trainee counts. Sent to coaches too, for reading. */
  bands: AcademyBand[];
  canAssign: boolean;
  /** Revalidate the shared academy payload — this component holds no copy of it. */
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('academy');
  const locale = useLocale();

  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pace form. `paceMode` is the real choice — follow the band, or don't — and
  // the number only matters in the second case.
  const [paceMode, setPaceMode] = useState<'band' | 'own'>('band');
  const [offsetInput, setOffsetInput] = useState('');

  const orderedBands = sortBands(bands);
  const assignable = coaches.filter((c) => c.coachId);
  const effective = effectiveOffsetSec(member.paceOffsetSec, member.band);
  const source = offsetSource(member.paceOffsetSec, member.band);

  const reset = () => { setMode('idle'); setError(null); };

  const openPace = () => {
    setError(null);
    if (member.paceOffsetSec !== null) {
      setPaceMode('own');
      setOffsetInput(String(member.paceOffsetSec));
    } else {
      setPaceMode('band');
      // Seeded with the band's own offset so switching to "their own" starts from
      // where they are now rather than from an empty box.
      const bandOffset = member.band?.paceProfile?.offsetSeconds;
      setOffsetInput(typeof bandOffset === 'number' ? String(bandOffset) : '');
    }
    setMode('pace');
  };

  const assignCoach = async (coachId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/coach', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: member.athleteId, coachId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || t('pairingError')); return; }
      reset();
      await onChanged();
    } catch {
      setError(t('pairingError'));
    } finally {
      setBusy(false);
    }
  };

  /** One writer for both halves of the band endpoint — band, override, or both. */
  const saveBandOrPace = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/bands', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: member.athleteId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || t('pairingError')); return false; }
      reset();
      await onChanged();
      return true;
    } catch {
      setError(t('pairingError'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const savePace = async () => {
    if (paceMode === 'band') {
      await saveBandOrPace({ paceOffsetSec: null });
      return;
    }
    // Parsed here rather than trusted from the input: a number field still hands
    // you '', '-', and '12.5'.
    const parsed = Number(offsetInput.trim());
    if (!offsetInput.trim() || !Number.isInteger(parsed)
      || parsed < MIN_PACE_OFFSET_SEC || parsed > MAX_PACE_OFFSET_SEC) {
      setError(t('paceOutOfRange', { min: MIN_PACE_OFFSET_SEC, max: MAX_PACE_OFFSET_SEC }));
      return;
    }
    await saveBandOrPace({ paceOffsetSec: parsed });
  };

  // ── The coach picker, expanded in place ───────────────────────────────────
  if (mode === 'coach') {
    return (
      <Expanded title={t('chooseCoach')} error={error}>
        {assignable.length === 0 ? (
          <div className="px-4 py-4">
            <p className="text-sm text-ink-700">{t('noCoachesYet')}</p>
            <p className="mt-1 text-xs text-ink-400">{t('noCoachesYetDesc')}</p>
          </div>
        ) : (
          assignable.map((c) => {
            const current = c.coachId === member.academyCoachId;
            return (
              <InsetRow
                key={c.coachId}
                icon={UserRound}
                iconBg={current ? 'bg-brand-600' : 'bg-ink-300'}
                label={c.coachName || ''}
                sublabel={t('traineesShort', { count: c.trainees })}
                onClick={busy ? undefined : () => assignCoach(c.coachId)}
                trailing={
                  busy ? <Spinner size={14} />
                    : current ? <Check className="h-4 w-4 text-brand-600 shrink-0" />
                      : undefined
                }
              />
            );
          })
        )}
        {member.academyCoachId && (
          <InsetRow
            icon={UserMinus}
            iconBg="bg-accent-red"
            label={t('unpairCoach')}
            danger
            onClick={busy ? undefined : () => assignCoach(null)}
          />
        )}
        <InsetRow icon={X} iconBg="bg-page" label={t('cancel')} onClick={busy ? undefined : reset} />
      </Expanded>
    );
  }

  // ── The band picker, expanded in place ────────────────────────────────────
  if (mode === 'band') {
    return (
      <Expanded title={t('chooseBand')} error={error}>
        {orderedBands.length === 0 ? (
          <div className="px-4 py-4">
            <p className="text-sm text-ink-700">{t('noBandsYet')}</p>
            <p className="mt-1 text-xs text-ink-400">{t('noBandsYetDesc')}</p>
          </div>
        ) : (
          orderedBands.map((b) => {
            const current = b.id === member.band?.id;
            const offset = b.paceProfile?.offsetSeconds;
            return (
              <InsetRow
                key={b.id}
                icon={Target}
                iconBg={current ? 'bg-accent-600' : 'bg-ink-300'}
                label={b.name}
                // The goal in the academy's own words — the same sentence the
                // trainee picked at registration, which is what makes a band
                // number mean anything.
                sublabel={b.goal || undefined}
                value={typeof offset === 'number'
                  ? t('secPerKmValue', { value: fmtOffsetSec(offset) })
                  : t('bandPacesUnsetShort')}
                valueMuted={typeof offset !== 'number'}
                onClick={busy ? undefined : () => saveBandOrPace({ bandId: b.id })}
                trailing={
                  busy ? <Spinner size={14} />
                    : current ? <Check className="h-4 w-4 text-accent-600 shrink-0" />
                      : undefined
                }
              />
            );
          })
        )}
        {member.band && (
          <InsetRow
            icon={X}
            iconBg="bg-accent-red"
            label={t('clearBand')}
            danger
            onClick={busy ? undefined : () => saveBandOrPace({ bandId: null })}
          />
        )}
        <InsetRow icon={X} iconBg="bg-page" label={t('cancel')} onClick={busy ? undefined : reset} />
      </Expanded>
    );
  }

  // ── The pace editor, expanded in place ───────────────────────────────────
  if (mode === 'pace') {
    const bandOffset = member.band?.paceProfile?.offsetSeconds;
    return (
      <div className="mb-5" dir="auto">
        <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">
          {t('choosePace')}
        </p>
        <div className="rounded-card bg-card/80 border border-page/50 p-4 space-y-4">
          {/* The primary choice, stated as a choice: a trainee either runs their
              band's paces — so one edit to the band moves them — or they have
              their own. Sequencing this before the number keeps "why is she at
              +40?" answerable. */}
          <div className="space-y-2">
            <button
              onClick={() => setPaceMode('band')}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors min-h-[44px]',
                paceMode === 'band'
                  ? 'bg-brand-600/15 border-brand-600/50'
                  : 'bg-page/60 border-page hover:border-ink-300',
              )}
            >
              <Layers className={cn('h-4 w-4 shrink-0', paceMode === 'band' ? 'text-brand-600' : 'text-ink-400')} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink-700">
                  {member.band ? t('followBand', { band: member.band.name }) : t('followBandNone')}
                </span>
                <span className="block text-xs text-ink-400">
                  {!member.band
                    ? t('followBandNoneDesc')
                    : typeof bandOffset === 'number'
                      ? t('secPerKmValue', { value: fmtOffsetSec(bandOffset) })
                      : t('bandPacesUnsetDesc')}
                </span>
              </span>
              {paceMode === 'band' && <Check className="h-4 w-4 text-brand-600 shrink-0" />}
            </button>

            <button
              onClick={() => setPaceMode('own')}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors min-h-[44px]',
                paceMode === 'own'
                  ? 'bg-brand-600/15 border-brand-600/50'
                  : 'bg-page/60 border-page hover:border-ink-300',
              )}
            >
              <Gauge className={cn('h-4 w-4 shrink-0', paceMode === 'own' ? 'text-brand-600' : 'text-ink-400')} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink-700">{t('ownPace')}</span>
                <span className="block text-xs text-ink-400">{t('ownPaceDesc')}</span>
              </span>
              {paceMode === 'own' && <Check className="h-4 w-4 text-brand-600 shrink-0" />}
            </button>
          </div>

          {paceMode === 'own' && (
            <div className="space-y-2.5">
              <div className="flex gap-1">
                {OFFSET_PRESETS.map((o) => (
                  <button
                    key={o}
                    onClick={() => setOffsetInput(String(o))}
                    className={cn(
                      'flex-1 rounded-lg py-2 text-xs font-bold tabular-nums transition-colors min-h-[44px]',
                      offsetInput === String(o)
                        ? 'bg-brand-600 text-white'
                        : 'bg-page/60 text-ink-400 hover:text-ink-900',
                    )}
                  >
                    {fmtOffsetSec(o)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  dir="ltr"
                  step={1}
                  min={MIN_PACE_OFFSET_SEC}
                  max={MAX_PACE_OFFSET_SEC}
                  value={offsetInput}
                  onChange={(e) => setOffsetInput(e.target.value)}
                  className="w-24 rounded-xl bg-page border border-page px-3 min-h-[44px] text-sm text-ink-700 tabular-nums text-center focus:outline-none focus:border-brand-600"
                />
                <span className="text-xs text-ink-400">{t('secPerKmUnit')}</span>
              </div>
              {/* Says which way the number goes, because "+30" is only obvious
                  once you already know the convention. */}
              <p className="text-2xs text-ink-400">{t('paceOffsetHelp')}</p>
            </div>
          )}

          {error && <p className="text-xs text-accent-red">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={savePace}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.99] transition-all min-h-[44px] disabled:opacity-60"
            >
              {busy && <Spinner size={14} />}
              {busy ? t('saving') : t('save')}
            </button>
            <button
              onClick={reset}
              disabled={busy}
              className="rounded-xl bg-page px-4 py-3 text-sm font-semibold text-ink-700 hover:bg-ink-300/40 min-h-[44px] disabled:opacity-60"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Resting state ─────────────────────────────────────────────────────────
  return (
    <>
      <InsetSection header={t('coachAndPaces')}>
        <InsetRow
          icon={UserRound}
          iconBg={member.academyCoachId ? 'bg-band-2' : 'bg-ink-300'}
          label={t('academyCoach')}
          sublabel={member.academyJoinedOn
            ? t('academySince', { date: fmtJoined(member.academyJoinedOn, locale) })
            : undefined}
          value={member.academyCoachName || t('noCoach')}
          valueMuted={!member.academyCoachId}
          onClick={canAssign ? () => { setError(null); setMode('coach'); } : undefined}
        />

        <InsetRow
          icon={Target}
          iconBg={member.band ? 'bg-accent-600' : 'bg-ink-300'}
          label={t('goalBand')}
          sublabel={member.band?.goal || undefined}
          value={member.band?.name || t('noBand')}
          valueMuted={!member.band}
          onClick={canAssign ? () => { setError(null); setMode('band'); } : undefined}
        />

        {/* The number the planner will actually apply, and where it came from —
            spelled out rather than left to be inferred, because a trainee sitting
            on their band's paces and one deliberately overridden to the same
            value behave differently the next time the band moves. */}
        <InsetRow
          icon={Gauge}
          iconBg={effective === null ? 'bg-ink-300' : source === 'athlete' ? 'bg-brand-600' : 'bg-violet-600'}
          label={t('paceOffset')}
          sublabel={
            source === 'athlete' ? t('paceFromAthlete')
              : source === 'band' ? t('paceFromBand', { band: member.band?.name || '' })
                : t('paceUnsetDesc')
          }
          value={effective === null
            ? t('paceUnset')
            : t('secPerKmValue', { value: fmtOffsetSec(effective) })}
          valueMuted={effective === null}
          onClick={busy ? undefined : openPace}
        />
      </InsetSection>

      {error && <p className="px-4 -mt-3 mb-4 text-xs text-accent-red">{error}</p>}
    </>
  );
}

/** The shared chrome for an inline picker — a labelled inset list, in place. */
function Expanded({
  title, error, children,
}: {
  title: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5" dir="auto">
      <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">{title}</p>
      <div className="rounded-card bg-card/80 border border-page/50 overflow-hidden divide-y divide-page/50">
        {children}
      </div>
      {error && <p className="px-4 mt-1.5 text-xs text-accent-red">{error}</p>}
    </div>
  );
}

/** 'March 2026' — a joining month, which is as precise as anyone needs. */
function fmtJoined(date: string, locale: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
