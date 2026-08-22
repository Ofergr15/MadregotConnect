'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search as SearchIcon, Users, Trophy, Tent, BookOpen, PartyPopper, Camera, Gift, Dumbbell } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { EmptyState, Spinner } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { EventKind } from '@/lib/events';

// Same icon mapping as the Calendar page (kept local — that mapping lives in
// a page file, not a shared lib).
const KIND_ICON: Record<EventKind, React.ComponentType<{ className?: string }>> = {
  race: Trophy,
  camp: Tent,
  lecture: BookOpen,
  social: PartyPopper,
  photo_shoot: Camera,
  sponsor: Gift,
  workout: Dumbbell,
};

interface SearchMember {
  id: string;
  name: string;
  avatarUrl: string | null;
}
interface SearchEvent {
  id: string;
  name: string;
  kind: EventKind;
  date: string;
  location: string;
}
interface SearchData {
  members: SearchMember[];
  events: SearchEvent[];
}

// Roadmap #17 — In-App Global Search. Debounced client-side (300ms) so the
// query string only settles into a fetch once typing pauses, not on every
// keystroke.
export default function SearchPage() {
  const t = useTranslations('search');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading } = useApi<SearchData>(
    debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null,
  );

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const hasResults = (data?.members.length || 0) > 0 || (data?.events.length || 0) > 0;
  const showEmpty = debounced.length >= 2 && !isLoading && !hasResults;
  const showPrompt = debounced.length < 2;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight" dir="rtl">{t('title')}</h1>
      </div>

      <div className="relative">
        <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('placeholder')}
          className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl ps-10 pe-3 h-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-600/50"
        />
      </div>

      {showPrompt && (
        <EmptyState icon={SearchIcon} title={t('prompt')} className="py-10" />
      )}

      {isLoading && debounced.length >= 2 && (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      )}

      {showEmpty && (
        <EmptyState icon={SearchIcon} title={t('noResults')} className="py-10" />
      )}

      {!isLoading && data && data.members.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-slate-500 px-1 mb-1.5">{t('members')}</p>
          <div className="space-y-2">
            {data.members.map((m) => (
              <Link
                key={m.id}
                href={`/dashboard/teammate/${m.id}`}
                className="flex items-center gap-3 bg-slate-800/50 rounded-2xl border border-slate-700/30 px-3 py-2.5"
              >
                <FeedAvatar name={m.name} url={m.avatarUrl} className="w-9 h-9 shrink-0" />
                <span className="text-sm font-semibold text-white truncate" dir="auto">{m.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isLoading && data && data.events.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-slate-500 px-1 mb-1.5">{t('events')}</p>
          <div className="space-y-2">
            {data.events.map((e) => {
              const Icon = KIND_ICON[e.kind] || Users;
              return (
                <Link
                  key={e.id}
                  href={`/dashboard/calendar/${e.id}`}
                  className="flex items-center gap-3 bg-slate-800/50 rounded-2xl border border-slate-700/30 px-3 py-2.5"
                >
                  <span className="w-9 h-9 rounded-full bg-slate-700/60 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-slate-300" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white truncate" dir="auto">{e.name}</span>
                    <span className="block text-2xs text-slate-500 truncate">{fmtDate(e.date)} · {e.location}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
