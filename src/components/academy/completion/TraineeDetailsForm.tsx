'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn, israelToday } from '@/lib/utils';
import type { CompletionPerson } from '@/lib/academy/completion-server';
import { daysBetween } from '@/lib/academy/tests';
import { OLD_TEST_DAYS } from '@/lib/academy/test-state';
import { measuredText, type EntryProtocol } from '@/lib/academy/test-entry';
import type { Goal } from '@/lib/academy/goal';
import { useViewAsReadOnly } from '@/lib/view-as-person';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, SectionLabel } from '../book/ui';
import { FieldRow, ValueButton, WatchButton, sendJson } from './shared';
import { TestFields, draftBody, draftHasTest, emptyDraft, type TestDraft } from './TestFields';
import { WatchTestSheet } from './WatchTestSheet';
import { GoalSheet, goalSummary } from './GoalSheet';
import { focusMeasured } from './TestEntryCard';
import { InviteToTestSheet } from '../InviteToTestSheet';

// ── להשלים למתאמן אחד (mockup academy-existing-trainees, phone 2) ───────────────────────
//
// The last test (30 minutes: the distance; 2000 m: the time), the threshold while typing,
// "למשוך מהשעון", then the band, the goal and the coach. Staff entry is approved on arrival
// (POST /api/academy/tests stamps it), and the save reprices the trainee's loads.
//
// Each half saves through the door that already guards it: the test through the tests route,
// the band through PUT /api/academy/bands and the coach through PUT /api/academy/coach (both
// manager-only — a coach sees those two rows read-only), the goal through PUT /api/academy/goal.
//
// No usable test (none, 2000 only, old): "לקבוע טסט חדש" opens the test-invitation sheet the test
// board uses (InviteToTestSheet → POST /api/academy/test-invitation), so the reminders and the
// settlement on the result are the ones every invitation already has.

export interface PickBand { id: string; bandNumber: number }
export interface PickCoach { coachId: string; coachName: string }

function initialDraft(person: CompletionPerson, correcting: boolean): TestDraft {
  const from = correcting ? person.pendingTest : person.test === 'ok' ? person.lastTest : null;
  if (!from || (from.protocol !== '30min' && from.protocol !== '2000m')) return emptyDraft();
  const protocol = from.protocol as EntryProtocol;
  return {
    protocol, date: from.date, measured: measuredText({ protocol, durationSec: from.durationSec, distanceM: from.distanceM }),
    avgHr: from.avgHr ? String(from.avgHr) : '', activityId: null, older: [],
  };
}

export function TraineeDetailsForm({ person, bands, coaches, canAssign, goalsStored, correcting, onClose, onSaved }: {
  person: CompletionPerson;
  bands: PickBand[];
  coaches: PickCoach[];
  canAssign: boolean;
  goalsStored: boolean;
  /** "לתקן" from the approval card: start from the trainee's submission, and replace it. */
  correcting?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('completion.form');
  const tg = useTranslations('completion.goal');
  const readOnly = useViewAsReadOnly();
  const first = person.name.split(' ')[0] || person.name;
  const [draft, setDraft] = useState<TestDraft>(() => initialDraft(person, !!correcting));
  const [testDirty, setTestDirty] = useState(!!correcting);
  const [bandId, setBandId] = useState<string | null>(person.bandId);
  const [coachId, setCoachId] = useState<string | null>(person.coachIds[0] ?? null);
  const [goal, setGoal] = useState<Goal>(person.goal);
  const [goalDirty, setGoalDirty] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  // An old test, a 2000 m only, or none, and nothing waiting: the next test is worth scheduling.
  const canSchedule = (person.test === 'old' || person.test === 'none' || person.test === 'otherProtocol') && !person.pendingTest;

  const band = bands.find(b => b.id === bandId) ?? null;
  const coachName = coaches.find(c => c.coachId === coachId)?.coachName ?? person.coachNames[0] ?? null;
  // Several coaches (migration 135) are the manager's coach picker's business, not this row's.
  const coachEditable = canAssign && person.coachIds.length <= 1;
  const goalText = goalSummary(goal, (g) => tg(`types.${g}`));

  // "לשמור · Shahar מוכן" when the save leaves nothing required missing.
  const readyAfter = useMemo(() => {
    const draftOk = testDirty && draftHasTest(draft) && draft.protocol === '30min' && daysBetween(draft.date, israelToday()) < OLD_TEST_DAYS;
    return (draftOk || (!testDirty && person.test === 'ok')) && !!bandId && !!coachId;
  }, [testDirty, draft, person.test, bandId, coachId]);

  const changeDraft = (d: TestDraft) => { setDraft(d); setTestDirty(true); };

  const save = async () => {
    setBusy(true); setError(null);
    const failed: string[] = [];
    try {
      if (testDirty && draftHasTest(draft)) {
        const body = draftBody(draft, person.athleteId)!;
        try {
          // The older test-like runs ride along as `past`, in the same request: the trainee is
          // repriced once, and the server writes them only into days with nothing on record.
          await sendJson('POST', '/api/academy/tests', {
            ...body,
            ...(correcting && person.pendingTest ? { replacesTestId: person.pendingTest.testId } : {}),
            ...(draft.older.length ? {
              past: draft.older.map(c => ({
                date: c.date, protocol: c.protocol, durationSec: c.durationSec, distanceM: c.distanceM, avgHr: c.avgHr, activityId: c.activityId,
              })),
            } : {}),
          });
        } catch { failed.push(t('failTest')); }
      }
      if (canAssign && bandId !== person.bandId) {
        await sendJson('PUT', '/api/academy/bands', { athleteId: person.athleteId, bandId }).catch(() => failed.push(t('failBand')));
      }
      if (coachEditable && coachId !== (person.coachIds[0] ?? null)) {
        await sendJson('PUT', '/api/academy/coach', { athleteId: person.athleteId, coachIds: coachId ? [coachId] : [] }).catch(() => failed.push(t('failCoach')));
      }
      if (goalDirty) {
        await sendJson('PUT', '/api/academy/goal', { athleteId: person.athleteId, ...goal }).catch(() => failed.push(t('failGoal')));
      }
      if (failed.length) { setError(t('failed', { what: failed.join(', ') })); onSaved(); return; }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const canSave = !readOnly && (testDirty ? draftHasTest(draft) : true) && !busy;

  return (
    <FlowOverlay label={person.name}>
      <FlowScreen
        title={<bdi>{person.name}</bdi>}
        leading={<BarButton onClick={onClose}>{t('cancel')}</BarButton>}
        trailing={<BarButton strong onClick={() => void save()} disabled={!canSave}>{t('save')}</BarButton>}
        footer={(
          <PrimaryButton onClick={() => void save()} busy={busy} disabled={!canSave}>
            {/* One span: the button is a flex row with a gap, and the rich text's pieces would each be an item. */}
            <span>{readyAfter ? t.rich('saveReady', { name: first, bdi: (c) => <bdi>{c}</bdi> }) : t('saveOnly')}</span>
          </PrimaryButton>
        )}
      >
        <SectionLabel>{correcting ? t('correcting') : t('lastTest')}</SectionLabel>
        <TestFields draft={draft} onChange={changeDraft} showHr name={first} gender={person.gender} />
        <WatchButton onClick={() => setWatchOpen(true)}>
          <span aria-hidden>⌚</span> {t('fromWatch')}
        </WatchButton>
        {draft.activityId && (
          <p className="-mt-1 px-1 text-[13px] font-bold text-[#0E7A3C]">
            ✓ {t('fromWatchPicked')}{draft.older.length > 0 && <> · {t.rich('olderToo', { n: draft.older.length, m: (c) => <bdi dir="ltr">{c}</bdi> })}</>}
          </p>
        )}
        {canSchedule && (
          invited
            ? <p className="-mt-1 px-1 text-[13px] font-bold text-[#0E7A3C]" role="status">✓ {t.rich('scheduled', { name: first, bdi: (c) => <bdi>{c}</bdi> })}</p>
            : (
              <button type="button" onClick={() => { setInviteError(null); setInviteOpen(true); }} disabled={readOnly}
                className="-mt-1 flex min-h-[44px] items-center gap-1.5 self-start px-1 text-[15px] font-extrabold text-brand-600 disabled:opacity-50">
                <span aria-hidden>📅</span> {person.test === 'old' ? t('scheduleOld') : t('schedule')}
              </button>
            )
        )}

        <SectionLabel>{t('rest')}</SectionLabel>
        <div className={cn(CARD, 'overflow-hidden')}>
          {/* The invisible select covers the whole row (FieldRow is relative), not just the digit:
              tapping anywhere on "דבוקה … 5" opens it. */}
          <FieldRow label={t('band')}>
            <span className="inline-flex">
              <ValueButton empty={!band} disabled={!canAssign} label={t('band')}>
                {band ? <bdi dir="ltr">{band.bandNumber}</bdi> : t('choose')}
              </ValueButton>
              {canAssign && (
                <select aria-label={t('band')} value={bandId ?? ''} onChange={(e) => setBandId(e.target.value || null)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                  <option value="">{t('none')}</option>
                  {bands.map(b => <option key={b.id} value={b.id}>{t('bandOption', { n: b.bandNumber })}</option>)}
                </select>
              )}
            </span>
          </FieldRow>
          <FieldRow label={t('goal')}>
            <ValueButton empty={!goalText} onClick={() => setGoalOpen(true)} disabled={!goalsStored} label={t('goal')}>
              {goalText ? <bdi>{goalText}</bdi> : t('goalEmpty')}
            </ValueButton>
          </FieldRow>
          <FieldRow label={t('coach')}>
            <span className="inline-flex">
              <ValueButton empty={!coachName} disabled={!coachEditable} label={t('coach')}>
                {person.coachIds.length > 1 ? <bdi>{person.coachNames.filter(Boolean).join(', ')}</bdi> : coachName ? <bdi>{coachName}</bdi> : t('choose')}
              </ValueButton>
              {coachEditable && (
                <select aria-label={t('coach')} value={coachId ?? ''} onChange={(e) => setCoachId(e.target.value || null)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                  <option value="">{t('none')}</option>
                  {coaches.map(c => <option key={c.coachId} value={c.coachId}>{c.coachName}</option>)}
                </select>
              )}
            </span>
          </FieldRow>
        </div>
        {!canAssign && <p className="-mt-1 px-1 text-[13px] text-ink-400">{t('managerOnly')}</p>}
        {!goalsStored && <p className="-mt-1 px-1 text-[13px] text-ink-400">{t('goalsNotSetUp')}</p>}
        {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{error}</p>}
      </FlowScreen>

      <WatchTestSheet
        athleteId={person.athleteId}
        open={watchOpen}
        onOpenChange={setWatchOpen}
        name={first}
        allowOlder
        onType={focusMeasured}
        onPick={(c, older) => {
          setDraft({
            protocol: c.protocol, date: c.date, measured: measuredText(c), avgHr: c.avgHr ? String(c.avgHr) : '',
            activityId: c.activityId, older,
          });
          setTestDirty(true);
        }}
      />
      <InviteToTestSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        target={inviteOpen ? { athleteId: person.athleteId, name: person.name } : null}
        busy={inviting}
        error={inviteError}
        onSend={(offer) => {
          setInviting(true); setInviteError(null);
          sendJson('POST', '/api/academy/test-invitation', { athleteId: person.athleteId, protocol: offer.protocol, slots: offer.slots })
            .then(() => { setInvited(true); setInviteOpen(false); onSaved(); })
            .catch((e: { status?: number }) => setInviteError(e.status === 409 ? t('scheduleExists') : t('scheduleFailed')))
            .finally(() => setInviting(false));
        }}
      />
      <GoalSheet open={goalOpen} onOpenChange={setGoalOpen} goal={goal} athleteId={person.athleteId} onDone={(g) => { setGoal(g); setGoalDirty(true); setGoalOpen(false); }} />
    </FlowOverlay>
  );
}

