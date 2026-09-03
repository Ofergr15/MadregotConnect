'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { BackNav, Spinner } from '@/components/ui';
import { useOnboarding } from '@/lib/onboarding/use-onboarding';
import type { SetupTask, SetupInfoItem } from '@/lib/onboarding/setup-tasks';
import { ProgressRing } from './ProgressRing';
import {
  TASK_LABEL_KEY, TASK_HINT_KEY, TASK_CTA_KEY, TASK_DONE_KEY, TASK_ICON, TASK_DESTINATION,
  INFO_LABEL_KEY, INFO_HINT_KEY, INFO_ICON, INFO_DESTINATION,
  type SetupDestination,
} from './task-meta';

// ═════════════════════════════════════════════════════════════════════════════
// The checklist behind the setup card. Three sections, because the rows are not
// all the same kind of thing:
//
//   מה שנשאר       — scored tasks still open
//   כבר סיימת      — scored tasks done, kept visible and struck through so the
//                    list never shrinks under you and "5" always means 5
//   לא נספר באחוזים — דבוקת קצב (the coach's call) and נעל פעילה (nobody in the
//                    club has one). Shown because people ask about them; not
//                    scored, because a percentage you can't reach is a
//                    percentage people learn to ignore.
//
// Every row navigates to a screen that already edits that field. This feature
// adds no forms of its own.
// ═════════════════════════════════════════════════════════════════════════════

export function SetupChecklist({
  onBack,
  onNavigate,
  onPickPhoto,
}: {
  onBack: () => void;
  onNavigate: (tab: 'datasource' | 'personalInfo' | 'notifications' | 'group') => void;
  onPickPhoto: () => void;
}) {
  const t = useTranslations('setup');
  const { data, mutate } = useOnboarding();

  // Re-read every time this screen opens. The key stays mounted app-wide (the
  // tour holds it), so SWR wouldn't otherwise refetch — and you arrive here
  // straight back from the screen where you just filled a field in.
  useEffect(() => { mutate(); }, [mutate]);

  const handler = (dest: SetupDestination): (() => void) | undefined => {
    if (dest.kind === 'tab') return () => onNavigate(dest.tab);
    if (dest.kind === 'photo') return onPickPhoto;
    return undefined;
  };

  if (!data || !data.applicable) {
    return (
      <div className="space-y-5">
        <BackNav label={t('backToProfile')} onBack={onBack} />
        <div className="flex justify-center py-10"><Spinner size={28} /></div>
      </div>
    );
  }

  const open = data.tasks.filter((task) => !task.done);
  const done = data.tasks.filter((task) => task.done);

  const taskRow = (task: SetupTask) => {
    const Icon = TASK_ICON[task.key];
    // The declared source is the sublabel either way. When it's set but there are
    // no credentials it's the single most useful thing the row can say — 11 of 28
    // members are in exactly that state, pointed at Garmin with nothing syncing.
    // Brand names, not the column's lowercase enum value.
    const source = task.meta?.source === 'strava' ? 'Strava' : 'Garmin';
    const sublabel =
      task.key === 'watch' && task.meta?.source && !task.done
        ? t('hintWatchDeclared', { source })
        : task.key === 'watch' && task.meta?.source && task.done
          ? t('hintWatchConnected', { source })
          : task.meta?.total
            ? t('hintFilledOf', { filled: task.meta.filled ?? 0, total: task.meta.total })
            : t(TASK_HINT_KEY[task.key]);

    return (
      <InsetRow
        key={task.key}
        icon={task.done ? Check : Icon}
        iconBg={task.done ? 'bg-accent-600' : 'bg-brand-600'}
        label={t(TASK_LABEL_KEY[task.key])}
        sublabel={sublabel}
        value={task.done ? t(TASK_DONE_KEY[task.key]) : t(TASK_CTA_KEY[task.key])}
        valueSuccess={task.done}
        onClick={handler(TASK_DESTINATION[task.key])}
      />
    );
  };

  const infoRow = (item: SetupInfoItem) => (
    <InsetRow
      key={item.key}
      icon={INFO_ICON[item.key]}
      iconBg={item.done ? 'bg-accent-600' : 'bg-ink-300'}
      label={t(INFO_LABEL_KEY[item.key])}
      sublabel={item.meta?.groupName || t(INFO_HINT_KEY[item.key])}
      value={item.done ? t('stateSet') : item.waiting ? t('stateWaiting') : t('stateOptional')}
      valueSuccess={item.done}
      valueMuted={!item.done}
      onClick={handler(INFO_DESTINATION[item.key])}
    />
  );

  return (
    <div className="space-y-5">
      <BackNav label={t('backToProfile')} onBack={onBack} />

      <div className="flex items-center gap-3.5 rounded-card bg-card p-4">
        <ProgressRing pct={data.pct} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink-700">{t('title')}</h1>
          <p className="mt-0.5 text-sm font-light text-ink-400">
            {t('doneOfTotal', { done: data.doneCount, total: data.totalCount })}
          </p>
        </div>
      </div>

      {/* space-y above handles the gap; InsetSection's own mb-5 would double it. */}
      <div className="[&>div]:mb-0 space-y-5">
        {open.length > 0 && <InsetSection header={t('sectionRemaining')}>{open.map(taskRow)}</InsetSection>}
        {done.length > 0 && <InsetSection header={t('sectionFinished')}>{done.map(taskRow)}</InsetSection>}
        <InsetSection header={t('sectionNotCounted')}>{data.info.map(infoRow)}</InsetSection>
      </div>

      {!data.migrated && (
        // Only reachable on an environment where 078 hasn't been pasted in yet.
        // The percentage is still correct (it's derived), but nothing can be
        // remembered — so say so here rather than letting the card silently
        // refuse to ever go away.
        <p className="px-4 text-center text-2xs font-light text-ink-400">{t('notMigrated')}</p>
      )}
    </div>
  );
}
