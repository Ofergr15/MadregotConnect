import { composeWhatsNew, EVENING_OPEN } from '@/lib/whats-new/evening';
import { recentEntries } from '@/lib/whats-new/ledger';
import type { WhatsNewEntry, WhatsNewLang } from '@/lib/whats-new/entries';
import type { WhatsNewRelease } from '@/lib/release-notes';

// ═════════════════════════════════════════════════════════════════════════════
// "What's new lately" — the last screen of the first-run tour (FirstRunTour).
//
// Ofer, 2026-10-09, before the launch: the guide has to end on the newest
// features by itself, with nobody maintaining a list. So this is EXACTLY what
// the "What's new" sheet would show — the same composition (hand-written
// entries + the release notes he features, lib/whats-new/evening.ts), the same
// "newest three" rule (lib/whats-new/ledger.ts recentEntries) — minus rule 1:
// the sheet never tells someone new about what was already there when they
// arrived, which is precisely why a newcomer needs it at the end of the tour.
// Featuring a note in /dashboard/whats-new puts it here on the next release.
// ═════════════════════════════════════════════════════════════════════════════

export interface TourLatestItem { slug: string; icon: string; title: string; body: string; href: string }

/** Drawn-art entries have no emoji of their own. */
const ART_ICON = '✨';

export function tourLatest(releases: WhatsNewRelease[], appVersion: string, lang: WhatsNewLang = 'he', evening = EVENING_OPEN): TourLatestItem[] {
  const { entries } = composeWhatsNew(releases, appVersion, evening);
  return recentEntries(entries).map((e: WhatsNewEntry) => {
    const copy = e[lang] ?? e.he;
    return { slug: e.slug, icon: e.icon || ART_ICON, title: copy.title, body: copy.body, href: e.href };
  }).filter((i) => i.title);
}
