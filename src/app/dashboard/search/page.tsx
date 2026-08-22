'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search as SearchIcon, Users, Trophy, Tent, BookOpen, PartyPopper, Camera, Gift, Dumbbell } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { EmptyState, Spinner } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { EventKind } from '@/lib/events';
import { useNavItems, STORE_ITEM, type NavItem } from '@/lib/nav-items';

// English/Hebrew synonym aliases per section — a plain substring match against
// the translated label or tab slug alone misses common everyday words (typing
// "workouts" matches neither "Program" nor "Practice" by substring), so each
// section also carries a short keyword list to search against.
const SECTION_KEYWORDS: Record<string, string[]> = {
  dashboard: ['home', 'בית'],
  feed: ['posts', 'social', 'פוסטים'],
  review: ['feedback', 'app feedback', 'משוב'],
  'plan/new': ['weekly plan', 'plan', 'תוכנית שבועית'],
  athletes: ['members', 'roster', 'חברים'],
  groups: ['pace group', 'דבוקה'],
  activities: ['runs', 'my activities', 'ריצות'],
  program: ['workout', 'workouts', 'plan', 'אימונים'],
  practice: ['workout', 'workouts', 'training', 'אימון'],
  'practice-attendance': ['attendance', 'checkin', 'check-in', 'נוכחות'],
  'workout-feedback': ['feedback', 'workout', 'workouts', 'משוב'],
  'team-volume': ['volume', 'mileage', 'km', 'נפח'],
  calendar: ['events', 'races', 'אירועים', 'תחרויות'],
  history: ['archive', 'past plans', 'ארכיון'],
  settings: ['account', 'management', 'חשבון'],
  profile: ['me', 'account', 'פרופיל שלי'],
  'coach-tools': ['coach', 'admin tools', 'מאמן'],
  store: ['shop', 'merch', 'shirts', 'חנות'],
};

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
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const { navItems } = useNavItems();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading } = useApi<SearchData>(
    debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null,
  );

  // "Smart search" — sections/pages are matched entirely client-side against
  // the same reachable-tabs list the tab bar computes (never gated by a
  // server round-trip; it's a small in-memory list). Store is a role-agnostic
  // static destination (see BottomTabBar's "More" sheet), added the same way.
  const sections = useMemo<NavItem[]>(() => {
    const q = debounced.trim().toLowerCase();
    if (q.length < 2) return [];
    const candidates = [...navItems, STORE_ITEM];
    return candidates.filter((item) => {
      const label = tNav(item.labelKey as any).toLowerCase();
      const keywords = SECTION_KEYWORDS[item.tab] || [];
      return label.includes(q) || item.tab.includes(q) || keywords.some((k) => k.toLowerCase().includes(q));
    });
  }, [navItems, debounced, tNav]);

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const hasResults = sections.length > 0 || (data?.members.length || 0) > 0 || (data?.events.length || 0) > 0;
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

      {sections.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-slate-500 px-1 mb-1.5">{t('sections')}</p>
          <div className="space-y-2">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.tab}
                  href={s.href}
                  className="flex items-center gap-3 bg-slate-800/50 rounded-2xl border border-slate-700/30 px-3 py-2.5"
                >
                  <span className="w-9 h-9 rounded-full bg-slate-700/60 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-slate-300" />
                  </span>
                  <span className="text-sm font-semibold text-white truncate" dir="auto">{tNav(s.labelKey as any)}</span>
                </Link>
              );
            })}
          </div>
        </div>
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
