'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search as SearchIcon, Users, Trophy, Tent, BookOpen, PartyPopper, Camera, Gift, Dumbbell, Package, Medal, ClipboardList, CalendarDays, Images, X, ChevronLeft } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { EmptyState, Spinner } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { EventKind } from '@/lib/events';
import { useNavItems, STORE_ITEM, STORE_OPEN, BENEFITS_ITEM, RUN_TOGETHER_ITEM, type NavItem } from '@/lib/nav-items';
import { AthleteLink } from '@/components/AthleteLink';

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
  benefits: ['discounts', 'perks', 'partnerships', 'sponsors', 'coupon', 'הנחות', 'ספונסרים', 'שותפויות', 'הטבות'],
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
interface SearchProduct {
  id: string;
  nameHe: string;
  nameEn: string;
  price: number;
  imageUrl: string | null;
}
interface SearchPerk {
  id: string;
  sponsorName: string;
  titleHe: string;
  titleEn: string;
  imageUrl: string | null;
}
interface SearchAlbum {
  id: string;
  title: string;
  date: string;
  count: number;
  cover: string | null;
}
interface SearchData {
  members: SearchMember[];
  events: SearchEvent[];
  products: SearchProduct[];
  perks: SearchPerk[];
  albums?: SearchAlbum[];
}
/** Before anything is typed (`/api/search?start=1`). */
interface StartData {
  pack: SearchMember[];
  packName: string | null;
  races: SearchEvent[];
  albums: SearchAlbum[];
  today: string;
}

const DAY_MS = 86_400_000;
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY_MS);
const albumHref = (id: string) => `/dashboard/photos?folder=${encodeURIComponent(id)}`;
const SHORTCUTS = [
  { href: '/dashboard/records', icon: Medal, key: 'shortcutRecords' },
  { href: '/dashboard/program', icon: ClipboardList, key: 'shortcutPlan' },
  { href: '/dashboard/calendar', icon: CalendarDays, key: 'shortcutCalendar' },
  { href: '/dashboard/photos', icon: Images, key: 'shortcutPhotos' },
] as const;
const rowClass = 'flex min-h-[58px] items-center gap-3 border-t border-page/60 px-3.5 py-2 first:border-t-0 active:bg-page/40';

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

  // athleteId dropped from the query string — the route takes the caller's perk
  // tier from the session now, so sending it decided nothing.
  const { data, isLoading } = useApi<SearchData>(
    debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null,
  );
  // The screen before typing: something to tap straight away (mockup search-mockup.html).
  const { data: start } = useApi<StartData>('/api/search?start=1');

  // "Smart search" — sections/pages are matched entirely client-side against
  // the same reachable-tabs list the tab bar computes (never gated by a
  // server round-trip; it's a small in-memory list). Store is a role-agnostic
  // static destination (see BottomTabBar's "More" sheet), added the same way.
  const sections = useMemo<NavItem[]>(() => {
    const q = debounced.trim().toLowerCase();
    if (q.length < 2) return [];
    const candidates = [...navItems, ...(STORE_OPEN ? [STORE_ITEM] : []), BENEFITS_ITEM, RUN_TOGETHER_ITEM];
    return candidates.filter((item) => {
      const label = tNav(item.labelKey as any).toLowerCase();
      const keywords = SECTION_KEYWORDS[item.tab] || [];
      return label.includes(q) || item.tab.includes(q) || keywords.some((k) => k.toLowerCase().includes(q));
    });
  }, [navItems, debounced, tNav]);

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const hasResults = sections.length > 0 || (data?.members.length || 0) > 0 || (data?.events.length || 0) > 0
    || (data?.products.length || 0) > 0 || (data?.perks.length || 0) > 0 || (data?.albums?.length || 0) > 0;
  const showEmpty = debounced.length >= 2 && !isLoading && !hasResults;
  const showPrompt = debounced.length < 2;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-700 tracking-tight" dir="rtl">{t('title')}</h1>
      </div>

      <div className="relative">
        <SearchIcon className="absolute start-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-ink-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('placeholder')}
          /* The only name this field had was its placeholder, which vanishes as
             soon as anyone types into it. */
          aria-label={t('placeholder')}
          className="h-[50px] w-full rounded-2xl border-2 border-transparent bg-card ps-11 pe-11 text-base text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label={t('clear')}
            className="absolute end-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-300 text-white"><X className="h-3.5 w-3.5" strokeWidth={3} /></span>
          </button>
        )}
      </div>

      {showPrompt && (start ? <StartView start={start} /> : <div className="flex justify-center py-10"><Spinner size={22} /></div>)}

      {isLoading && debounced.length >= 2 && (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      )}

      {showEmpty && (
        <EmptyState icon={SearchIcon} title={t('noResults')} className="py-10" />
      )}

      {sections.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-400 px-1 mb-1.5">{t('sections')}</p>
          <div className="space-y-2">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.tab}
                  href={s.href}
                  className="flex min-h-[58px] items-center gap-3 rounded-card bg-card px-3.5 py-2 active:opacity-85"
                >
                  <span className="w-9 h-9 rounded-[11px] bg-page flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-ink-500" />
                  </span>
                  <span className="text-sm font-semibold text-ink-700 truncate" dir="auto">{tNav(s.labelKey as any)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && data && data.members.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-400 px-1 mb-1.5">{t('members')}</p>
          <div className="space-y-2">
            {/* `<bdi>` around every result name, and not `dir="auto"` on the span.
                The two isolate a foreign-script string identically, but `dir` is a
                property of the ELEMENT: these spans are blockified (`block`, or a
                flex item), so resolving them to LTR for a Latin name also flipped
                their text-align — a perk sponsored by "Nike" printed the sponsor
                line flush against the LEFT edge of an otherwise right-aligned card,
                under a Hebrew title. `<bdi>` isolates the string and leaves the box
                alone, so the line stays where the rest of the card is. */}
            {data.members.map((m) => (
              <AthleteLink
                key={m.id}
                athleteId={m.id}
                name={m.name}
                className="flex min-h-[58px] items-center gap-3 rounded-card bg-card px-3.5 py-2 active:opacity-85"
              >
                <FeedAvatar name={m.name} url={m.avatarUrl} className="w-9 h-9 shrink-0" />
                <span className="text-[15px] font-extrabold text-ink-900 truncate"><bdi>{m.name}</bdi></span>
              </AthleteLink>
            ))}
          </div>
        </div>
      )}

      {!isLoading && data && (data.albums?.length || 0) > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-400 px-1 mb-1.5">{t('albums')}</p>
          <div className="space-y-2">
            {data.albums!.map((a) => (
              <Link key={a.id} href={albumHref(a.id)} className="flex min-h-[58px] items-center gap-3 rounded-card bg-card px-3.5 py-2 active:opacity-85">
                {a.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.cover} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                  : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-page"><Images className="h-4 w-4 text-ink-400" /></span>}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold text-ink-900"><bdi>{a.title}</bdi></span>
                  <span className="block text-xs text-ink-400">{fmtDate(a.date)} · {t('photoCount', { count: a.count })}</span>
                </div>
                <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300 rtl:rotate-0 ltr:rotate-180" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isLoading && data && data.events.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-400 px-1 mb-1.5">{t('events')}</p>
          <div className="space-y-2">
            {data.events.map((e) => {
              const Icon = KIND_ICON[e.kind] || Users;
              return (
                <Link
                  key={e.id}
                  href={`/dashboard/calendar/${e.id}`}
                  className="flex min-h-[58px] items-center gap-3 rounded-card bg-card px-3.5 py-2 active:opacity-85"
                >
                  <span className="w-9 h-9 rounded-[11px] bg-page flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-ink-500" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[15px] font-extrabold text-ink-900 truncate"><bdi>{e.name}</bdi></span>
                    <span className="block text-2xs text-ink-400 truncate">{fmtDate(e.date)} · {e.location}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {STORE_OPEN && !isLoading && data && data.products.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-400 px-1 mb-1.5">{t('products')}</p>
          <div className="space-y-2">
            {data.products.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/store?product=${p.id}`}
                className="flex min-h-[58px] items-center gap-3 rounded-card bg-card px-3.5 py-2 active:opacity-85"
              >
                <span className="w-9 h-9 rounded-lg bg-page/60 flex items-center justify-center overflow-hidden shrink-0">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package className="h-4 w-4 text-ink-400" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[15px] font-extrabold text-ink-900 truncate"><bdi>{locale === 'he' ? p.nameHe : p.nameEn}</bdi></span>
                  <span className="block text-2xs text-ink-400">{p.price} ₪</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isLoading && data && data.perks.length > 0 && (
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-400 px-1 mb-1.5">{t('perks')}</p>
          <div className="space-y-2">
            {data.perks.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/benefits?perk=${p.id}`}
                className="flex min-h-[58px] items-center gap-3 rounded-card bg-card px-3.5 py-2 active:opacity-85"
              >
                <span className="w-9 h-9 rounded-lg bg-page/60 flex items-center justify-center overflow-hidden shrink-0">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Gift className="h-4 w-4 text-ink-400" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[15px] font-extrabold text-ink-900 truncate"><bdi>{locale === 'he' ? p.titleHe : p.titleEn}</bdi></span>
                  <span className="block text-2xs text-ink-400 truncate"><bdi>{p.sponsorName}</bdi></span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Before typing: the pack, the next races, the newest albums, four shortcuts. */
function StartView({ start }: { start: StartData }) {
  const t = useTranslations('search');
  const locale = useLocale();
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'numeric' });
  const left = (iso: string) => {
    const n = daysUntil(iso, start.today);
    return n <= 0 ? t('today') : n === 1 ? t('tomorrow') : t('daysLeft', { count: n });
  };
  const head = 'mb-2 px-1 text-xs font-extrabold text-ink-400';
  return (
    <div className="space-y-5">
      {start.pack.length > 0 && (
        <section>
          <p className={head}>{t('yourPack')}{start.packName ? <> · <bdi>{start.packName}</bdi></> : null}</p>
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
            {start.pack.map((m) => (
              <AthleteLink key={m.id} athleteId={m.id} name={m.name} className="w-[62px] shrink-0 text-center">
                <span className="mx-auto block w-fit rounded-full border-[2.5px] border-card shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
                  <FeedAvatar name={m.name} url={m.avatarUrl} className="h-[54px] w-[54px] text-[15px]" />
                </span>
                <span className="mt-1 block truncate text-xs font-bold text-ink-900"><bdi>{m.name.trim().split(/\s+/)[0]}</bdi></span>
              </AthleteLink>
            ))}
          </div>
        </section>
      )}
      {start.races.length > 0 && (
        <section>
          <p className={head}>{t('nextRaces')}</p>
          <div className="overflow-hidden rounded-card bg-card">
            {start.races.map((e) => (
              <Link key={e.id} href={`/dashboard/calendar/${e.id}`} className={rowClass}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#FFEDE3] text-[#FF5315]"><Trophy className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold text-ink-900"><bdi>{e.name}</bdi></span>
                  <span className="block text-xs text-ink-400"><bdi>{day(e.date)}</bdi> · {left(e.date)}</span>
                </div>
                <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300 ltr:rotate-180" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {start.albums.length > 0 && (
        <section>
          <p className={head}>{t('latestPhotos')}</p>
          <div className="grid grid-cols-3 gap-2">
            {start.albums.map((a) => (
              <Link key={a.id} href={albumHref(a.id)} className="overflow-hidden rounded-2xl bg-card active:opacity-85">
                {a.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.cover} alt="" className="block h-[74px] w-full object-cover" />
                  : <span className="flex h-[74px] items-center justify-center bg-page"><Images className="h-5 w-5 text-ink-300" /></span>}
                <span className="block px-2 pb-2 pt-1.5">
                  <b className="block truncate text-xs font-extrabold text-ink-900"><bdi>{a.title}</bdi></b>
                  <small className="text-[11px] text-ink-400">{t('photoCount', { count: a.count })}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section>
        <p className={head}>{t('shortcuts')}</p>
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map(({ href, icon: Icon, key }) => (
            <Link key={href} href={href} className="inline-flex h-11 items-center gap-1.5 rounded-pill bg-card px-4 text-sm font-extrabold text-ink-900 active:opacity-80">
              <Icon className="h-[18px] w-[18px] text-brand-600" />{t(key)}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

