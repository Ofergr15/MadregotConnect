// The academy staff screen's map: five AREAS, each with its sub-tabs (mockup
// academy-manager-v5.html). It replaced a switcher of fourteen sections that a
// phone could only show four of at a time.
//
//   בית      the home
//   אנשים    מתאמנים · מועמדים · מאמנים
//   תוכניות  השבוע · ספר אימונים · שעונים
//   מעקב     ביצוע · טסטים · תוצאות
//   שיחות    the threads
//
// Payments and settings belong to no area: they sit behind the ⚙ (manager only).
// Pure, so the deep-link mapping — every old `?tab=` value still lands somewhere
// sensible — is tested rather than trusted.

export type AcademyArea = 'home' | 'people' | 'plans' | 'track' | 'threads';

export type AcademySection =
  | 'overview'
  | 'members' | 'funnel' | 'coaches'
  | 'plans' | 'book' | 'dispatch'
  | 'compliance' | 'tests' | 'results'
  | 'threads'
  | 'payments' | 'settings';

export const AREAS: ReadonlyArray<{ key: AcademyArea; label: string }> = [
  { key: 'home', label: 'בית' },
  { key: 'people', label: 'אנשים' },
  { key: 'plans', label: 'תוכניות' },
  { key: 'track', label: 'מעקב' },
  { key: 'threads', label: 'שיחות' },
];

/** The title row's heading per area. The home keeps the academy's own name. */
export const AREA_TITLE: Record<AcademyArea, string> = {
  home: 'אקדמיה',
  people: 'אנשים',
  plans: 'תוכניות',
  track: 'מעקב',
  threads: 'שיחות',
};

/** Which area a section is drawn under; null = behind the ⚙. */
export const AREA_OF: Record<AcademySection, AcademyArea | null> = {
  overview: 'home',
  members: 'people', funnel: 'people', coaches: 'people',
  plans: 'plans', book: 'plans', dispatch: 'plans',
  compliance: 'track', tests: 'track', results: 'track',
  threads: 'threads',
  payments: null, settings: null,
};

const SUB_TABS: Record<AcademyArea, ReadonlyArray<{ section: AcademySection; label: string; managerOnly?: boolean }>> = {
  home: [{ section: 'overview', label: 'בית' }],
  people: [
    { section: 'members', label: 'מתאמנים' },
    { section: 'funnel', label: 'מועמדים', managerOnly: true },
    { section: 'coaches', label: 'מאמנים', managerOnly: true },
  ],
  plans: [
    { section: 'plans', label: 'השבוע' },
    { section: 'book', label: 'ספר אימונים' },
    { section: 'dispatch', label: 'שעונים' },
  ],
  track: [
    { section: 'compliance', label: 'ביצוע' },
    { section: 'tests', label: 'טסטים' },
    { section: 'results', label: 'תוצאות' },
  ],
  threads: [{ section: 'threads', label: 'שיחות' }],
};

/** The sections that are the academy manager's alone. The routes refuse a coach anyway. */
const MANAGER_ONLY = new Set<AcademySection>(['funnel', 'coaches', 'payments', 'settings']);

export function sectionAllowed(section: AcademySection, isManager: boolean): boolean {
  return isManager || !MANAGER_ONLY.has(section);
}

/** An area's sub-tabs for this viewer. A single entry means "no segmented control". */
export function subTabsOf(area: AcademyArea, isManager: boolean): Array<{ section: AcademySection; label: string }> {
  return SUB_TABS[area].filter((s) => isManager || !s.managerOnly).map(({ section, label }) => ({ section, label }));
}

export function defaultSectionOf(area: AcademyArea): AcademySection {
  return SUB_TABS[area][0].section;
}

/**
 * An old `?tab=` value (or a section name) → the section it now lives in.
 *
 * Links already out in notifications and shared URLs name the fourteen old
 * sections, so every one of them keeps a home: `roster` was the old members
 * directory, `registrations` folded into the candidates, and `stats` — whose
 * numbers the home chart and the compliance tab now carry — lands on compliance.
 * A section the viewer may not see falls back to that area's first sub-tab, and
 * an unknown value to null (stay where you are).
 */
export function sectionForTab(tab: string | null | undefined, isManager: boolean): AcademySection | null {
  if (!tab) return null;
  const aliases: Record<string, AcademySection> = {
    roster: 'members',
    registrations: 'funnel',
    stats: 'compliance',
    home: 'overview',
    people: 'members',
    track: 'compliance',
  };
  const raw = aliases[tab] ?? tab;
  if (!(raw in AREA_OF)) return null;
  const section = raw as AcademySection;
  if (sectionAllowed(section, isManager)) return section;
  const area = AREA_OF[section];
  return area ? defaultSectionOf(area) : 'overview';
}
