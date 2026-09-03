import { Watch, Camera, User, Shirt, BellRing, Users, Footprints } from 'lucide-react';
import type { SetupTaskKey, SetupInfoKey } from '@/lib/onboarding/setup-tasks';

// Presentation for each setup task: which glyph, which strings, and where the
// row goes. Kept beside the components rather than in lib/ because it's all
// render detail — the scoring rules in lib/onboarding/setup-tasks.ts stay free of
// icons and i18n keys so they can be tested on their own.

/**
 * Where a task's row sends you.
 *
 * Every destination is a screen that ALREADY edits that field — the profile's own
 * drill-down tabs. No task opens a new form, which is why this whole feature adds
 * no editing UI: it's navigation plus a score.
 */
export type SetupDestination =
  | { kind: 'tab'; tab: 'datasource' | 'personalInfo' | 'notifications' | 'group' }
  /** The avatar file picker, which lives on the landing rather than on a tab. */
  | { kind: 'photo' }
  /** Nothing to open — the row is advice, not a link. */
  | { kind: 'none' };

export const TASK_LABEL_KEY: Record<SetupTaskKey, string> = {
  watch: 'taskWatch',
  photo: 'taskPhoto',
  personalInfo: 'taskPersonalInfo',
  sizes: 'taskSizes',
  notifications: 'taskNotifications',
};

export const TASK_HINT_KEY: Record<SetupTaskKey, string> = {
  watch: 'hintWatch',
  photo: 'hintPhoto',
  personalInfo: 'hintPersonalInfo',
  sizes: 'hintSizes',
  notifications: 'hintNotifications',
};

/** The trailing call to action while a task is unfinished. */
export const TASK_CTA_KEY: Record<SetupTaskKey, string> = {
  watch: 'ctaConnect',
  photo: 'ctaAdd',
  personalInfo: 'ctaFill',
  sizes: 'ctaFill',
  notifications: 'ctaEnable',
};

/** The trailing value once a task is done — what it says, not just "✓". */
export const TASK_DONE_KEY: Record<SetupTaskKey, string> = {
  watch: 'stateConnected',
  photo: 'stateAdded',
  personalInfo: 'stateFilled',
  sizes: 'stateFilled',
  notifications: 'stateEnabled',
};

export const TASK_ICON: Record<SetupTaskKey, React.ComponentType<{ className?: string }>> = {
  watch: Watch,
  photo: Camera,
  personalInfo: User,
  // Sizes are for club kit and the store, so a shirt rather than a second person
  // glyph — the row sits directly under Personal info and needs to look distinct.
  sizes: Shirt,
  notifications: BellRing,
};

export const TASK_DESTINATION: Record<SetupTaskKey, SetupDestination> = {
  watch: { kind: 'tab', tab: 'datasource' },
  photo: { kind: 'photo' },
  personalInfo: { kind: 'tab', tab: 'personalInfo' },
  // Shirt/shoe size are fields on the same Personal info screen, so this is the
  // one case where two tasks share a destination. They stay two rows because
  // "fill in your contact details" and "tell us your kit sizes" are different
  // asks, and a member who does one usually can't do the other from memory.
  sizes: { kind: 'tab', tab: 'personalInfo' },
  notifications: { kind: 'tab', tab: 'notifications' },
};

export const INFO_LABEL_KEY: Record<SetupInfoKey, string> = {
  paceGroup: 'infoPaceGroup',
  activeShoe: 'infoActiveShoe',
};

export const INFO_HINT_KEY: Record<SetupInfoKey, string> = {
  paceGroup: 'infoPaceGroupHint',
  activeShoe: 'infoActiveShoeHint',
};

export const INFO_ICON: Record<SetupInfoKey, React.ComponentType<{ className?: string }>> = {
  paceGroup: Users,
  activeShoe: Footprints,
};

export const INFO_DESTINATION: Record<SetupInfoKey, SetupDestination> = {
  // Viewable, but the coach is the one who assigns it — the row exists so an
  // unassigned member can see that somebody else owes them something, rather
  // than reading a blank as their own unfinished task.
  paceGroup: { kind: 'tab', tab: 'group' },
  // Shoes are managed by ShoeManager on the profile landing, not on a tab.
  // Rather than invent a scroll-to-anchor for one row, the hint says where it is.
  activeShoe: { kind: 'none' },
};
