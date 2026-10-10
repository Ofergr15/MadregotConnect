'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Card } from '@/components/ui';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf } from '@/components/FeedAvatar';
import type { ViewAsPerson, ViewAsTag } from '@/lib/auth/view-as';
import { getViewedPerson, readRecentPeople, startViewingAs, type ViewedPerson } from '@/lib/view-as-person';

// The "אדם" half of the eye button's chooser (ImpersonationBar): search the whole
// club, each person with what they are, and the last few viewed. Picking one
// starts the whole-app view (lib/view-as-person.ts). The list is admin-only on
// the server (GET /api/admin/view-as) and answered as the admin even while a view
// is on, which is what lets you switch from one person straight to the next.

const TAG_TONE: Record<ViewAsTag, string> = {
  admin: 'bg-violet-700/10 text-violet-700',
  academy_manager: 'bg-violet-700/10 text-violet-700',
  academy_coach: 'bg-band-2/15 text-band-2-ink',
  coach: 'bg-band-2/15 text-band-2-ink',
  trainee: 'bg-brand-600/10 text-brand-600',
  runner: 'bg-page text-ink-500',
};

function toViewed(p: ViewAsPerson): ViewedPerson {
  return { id: p.id, name: p.name, tag: p.tag, email: p.email, groupId: p.groupId, avatarUrl: p.avatarUrl };
}

export function ViewAsPersonPicker({ open }: { open: boolean }) {
  const t = useTranslations('viewAs');
  const { data, error } = useApi<{ people: ViewAsPerson[] }>(open ? '/api/admin/view-as' : null);
  const [query, setQuery] = useState('');
  const current = getViewedPerson()?.id ?? null;
  const people = useMemo(() => data?.people ?? [], [data]);
  const q = query.trim().toLowerCase();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  // Recents re-read from the full list, so a renamed or re-roled person shows as
  // they are now; somebody no longer in the club simply drops out.
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const recent = q ? [] : readRecentPeople().map((r) => byId.get(r.id)).filter((p): p is ViewAsPerson => !!p);

  const sub = (p: ViewAsPerson) => {
    const parts = [p.groupName];
    if (p.coachName) parts.push(t('withCoach', { coach: p.coachName.split(' ')[0] }));
    if ((p.tag === 'academy_coach' || p.tag === 'coach') && p.trainees > 0) parts.push(t('trainees', { count: p.trainees }));
    return parts.filter(Boolean).join(' · ');
  };

  const row = (p: ViewAsPerson) => (
    <button
      key={p.id}
      type="button"
      onClick={() => startViewingAs(toViewed(p))}
      className={cn('flex w-full min-h-[52px] items-center gap-3 px-3 py-2 text-start active:bg-page/60', p.id === current && 'bg-[#FEF3C7]/60')}
    >
      <Avatar className="size-9">
        {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" />}
        <AvatarFallback className="bg-brand-600/15 text-xs font-bold text-brand-600">{initialsOf(p.name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-700" dir="auto">{p.name}</span>
        {sub(p) && <span className="block truncate text-xs text-ink-400" dir="auto">{sub(p)}</span>}
      </span>
      <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-3xs font-bold', TAG_TONE[p.tag])}>{t(`tag_${p.tag}`)}</span>
    </button>
  );

  return (
    <div dir="rtl">
      <label className="mb-2 flex min-h-[44px] items-center gap-2 rounded-xl bg-card px-3">
        <Search className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          dir="auto"
          className="min-w-0 flex-1 bg-transparent text-base text-ink-700 outline-none placeholder:text-ink-400"
        />
      </label>

      {error ? (
        <p className="py-6 text-center text-sm text-ink-400">{t('loadFailed')}</p>
      ) : !data ? (
        <div className="h-40 animate-pulse rounded-card bg-card/60" />
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <p className="px-1 pb-1.5 pt-1 text-2xs font-bold uppercase tracking-wider text-ink-400">{t('recent')}</p>
              <Card className="mb-3 divide-y divide-page overflow-hidden py-0">{recent.map(row)}</Card>
            </>
          )}
          <Card className="max-h-[45vh] divide-y divide-page overflow-y-auto py-0">
            {matches.map(row)}
            {matches.length === 0 && <p className="py-6 text-center text-sm text-ink-400">{t('noResults')}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
