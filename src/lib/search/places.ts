import { MANAGE_GROUPS } from '@/lib/admin/manage-groups';

/**
 * EVERY SCREEN AND SETTING SEARCH CAN OPEN (mockup ~/.cache/madregot/search-proposal.html,
 * Ofer 2026-10-20). The menu's own tabs come from useNavItems on the search screen; this is
 * what the menu does not list — the staff screens, the settings inside a screen ("מי רואה את
 * גרף הדופק שלי" is a switch on the personal-info tab) — each with words people type for it
 * and WHO may open it. The gate is the one the app shell uses for the staff screens
 * (lib/auth/staff-pages mayOpenStaffPage), so a runner who types "תפקיד" finds nothing.
 */

export type PlaceGate = 'all' | 'staff' | 'admin' | 'approver' | 'numbers';
export interface Place {
  label: string;
  /** Where it is ("פרופיל ← פרטים אישיים") or what it does. */
  sub: string;
  href: string;
  /** Other words for it, Hebrew and English. */
  also?: string;
  who: PlaceGate;
  icon: string;
  /** A setting inside a screen (shown under "הגדרות"), not a screen. */
  setting?: boolean;
}

export const PLACES: Place[] = [
  // ── a member's own settings ────────────────────────────────────────────────────
  { label: 'מי רואה את גרף הדופק שלי', sub: 'פרופיל ← פרטים אישיים · מתג', href: '/dashboard/profile?tab=personalInfo', also: 'דופק פרטיות hr heart rate privacy', who: 'all', icon: '❤️', setting: true },
  { label: 'מידות ביגוד ונעליים', sub: 'פרופיל ← פרטים אישיים', href: '/dashboard/profile?tab=personalInfo', also: 'מידה חולצה נעל גרביים טייץ size shirt shoe', who: 'all', icon: '👕', setting: true },
  { label: 'פרטים אישיים', sub: 'שם, טלפון, תאריך לידה', href: '/dashboard/profile?tab=personalInfo', also: 'טלפון יום הולדת phone birthday name', who: 'all', icon: '🪪', setting: true },
  { label: 'ההתראות שלי', sub: 'פרופיל ← התראות · מה מגיע אליך', href: '/dashboard/profile?tab=notifications', also: 'התראות פוש push notifications', who: 'all', icon: '🔔', setting: true },
  { label: 'השעון ומקור הנתונים', sub: 'פרופיל ← Garmin / Strava', href: '/dashboard/profile?tab=datasource', also: 'שעון גרמין סטרבה חיבור garmin strava watch sync', who: 'all', icon: '⌚', setting: true },
  { label: 'הדבוקה שלי', sub: 'פרופיל ← דבוקה · בקשת מעבר', href: '/dashboard/profile?tab=group', also: 'דבוקה קבוצה pack group', who: 'all', icon: '🏃', setting: true },
  { label: 'השיאים שלי', sub: '5K · 10K · חצי · מרתון', href: '/dashboard/records', also: 'שיא שיאים pr record 5k 10k', who: 'all', icon: '🏅' },
  { label: 'תגים', sub: 'פרופיל ← תגים', href: '/dashboard/profile?tab=badges', also: 'badges', who: 'all', icon: '🎖️' },
  { label: 'אתגרים', sub: 'פרופיל ← אתגרים', href: '/dashboard/profile?tab=challenges', also: 'challenge', who: 'all', icon: '🎯' },
  { label: 'טבלאות', sub: 'פרופיל ← טבלאות', href: '/dashboard/profile?tab=leaderboards', also: 'דירוג leaderboard', who: 'all', icon: '📊' },
  { label: 'השלמת הפרופיל', sub: 'מה עוד חסר', href: '/dashboard/profile?tab=setup', also: 'הגדרה ראשונית setup', who: 'all', icon: '✅' },
  // ── staff ───────────────────────────────────────────────────────────────────────
  { label: 'תפקידים והרשאות', sub: 'מאמנים · גרעין · מנהלי מדרגות', href: '/dashboard/roles', also: 'תפקיד הרשאה מאמן מנהל roles', who: 'admin', icon: '🛡️' },
  { label: 'רצי גרעין', sub: 'תפקידים ← סינון "גרעין"', href: '/dashboard/roles?filter=core', also: 'גרעין core', who: 'admin', icon: '⭐' },
  { label: 'מנהלי מדרגות', sub: 'תפקידים ← סינון "מנהלים"', href: '/dashboard/roles?filter=managers', also: 'מנהלים managers', who: 'admin', icon: '📊' },
  { label: 'תור הכניסה', sub: 'מי מחכה לאישור', href: '/dashboard/entry-queue', also: 'אישור ממתינים הצטרפות כניסה join', who: 'approver', icon: '🚪' },
  { label: 'יומן ההרשמות', sub: 'כל מי שנרשם', href: '/dashboard/registrations', also: 'הרשמה נרשמים registrations', who: 'staff', icon: '📝' },
  { label: 'תחילת שבוע', sub: 'התוכנית, ההתראות, האחראים', href: '/dashboard/week', also: 'שבוע פתיחה week setup', who: 'staff', icon: '🗓️' },
  { label: 'אימונים', sub: 'השבוע והמעקב', href: '/dashboard/training', also: 'אימון מעקב training', who: 'staff', icon: '🏋️' },
  { label: 'ימי הולדת', sub: 'מי חוגג ומה מתפרסם', href: '/dashboard/birthdays', also: 'יום הולדת birthday', who: 'staff', icon: '🎂' },
  { label: 'סטוריז', sub: 'מה עולה למעגל', href: '/dashboard/stories', also: 'סטורי story', who: 'staff', icon: '⭕' },
  { label: 'סטוריז של הדבוקות', sub: 'לפי דבוקה', href: '/dashboard/pack-stories', also: 'סטורי דבוקה', who: 'staff', icon: '⭕' },
  { label: 'סקרים', sub: 'פתוחים, תוצאות ותזכורות', href: '/dashboard/content/surveys', also: 'סקר הצבעה poll survey', who: 'staff', icon: '📊' },
  { label: 'סקר חדש', sub: 'לפרסם ← סקר', href: '/dashboard/content/publish?type=survey', also: 'סקר poll', who: 'staff', icon: '➕' },
  { label: 'הודעה לחברים', sub: 'לפרסם ← הודעה', href: '/dashboard/content/publish?type=message', also: 'הודעה פרסום message publish', who: 'staff', icon: '📣' },
  { label: 'תוכן', sub: 'תמונות, הודעות, סקרים, ברכות', href: '/dashboard/content', also: 'פרסום תוכן content', who: 'staff', icon: '🗂️' },
  { label: 'עדכוני המועדון', sub: 'עדכונים מהצוות', href: '/dashboard/club-updates', also: 'עדכון חדשות updates', who: 'staff', icon: '📰' },
  { label: 'אנשים', sub: 'כל החברים לפי אזור', href: '/dashboard/people', also: 'חברים רצים people members', who: 'staff', icon: '👥' },
  { label: 'מדרגות במספרים', sub: 'החשבונות, הק״מ, האקדמיה', href: '/dashboard/numbers', also: 'מספרים גרפים נתונים numbers stats', who: 'numbers', icon: '📈' },
  { label: 'אקדמיה', sub: 'מתאמנים, מועמדים, לוח', href: '/dashboard/academy', also: 'אקדמיה מתאמנים academy', who: 'staff', icon: '🎓' },
  { label: 'דיווחים', sub: 'באגים ובקשות', href: '/dashboard/review/all', also: 'באג תקלה דיווח bug report', who: 'staff', icon: '🐞' },
  { label: 'חדר בקרה', sub: 'מה קורה עכשיו', href: '/dashboard/control-room', also: 'בקרה control', who: 'staff', icon: '🎛️' },
  { label: 'בניית התוכנית ופרסום', sub: 'תוכנית שבועית לשעון', href: '/dashboard/plan/new', also: 'תוכנית מתכנן plan garmin', who: 'staff', icon: '🧭' },
  { label: 'אימון מחר', sub: 'הטקסט של מחר · וואטסאפ', href: '/dashboard/day-session', also: 'מחר וואטסאפ day session', who: 'staff', icon: '📆' },
  { label: 'דבוקות', sub: 'הקבוצות והקצבים', href: '/dashboard/groups', also: 'קבוצה דבוקה pace groups', who: 'staff', icon: '🧩' },
  ...MANAGE_GROUPS.flatMap((g) => g.items.map((i): Place => ({
    label: i.label, sub: `${g.title}${i.sub ? ` · ${i.sub}` : ''}`, href: i.href, also: i.also, who: 'admin', icon: '⚙️', setting: true,
  }))),
];

export interface PlaceViewer { role?: string; roles?: string[]; isSuper?: boolean; canApprove?: boolean; isClubManager?: boolean }

const STAFF = new Set(['admin', 'coach', 'academy_coach', 'academy_manager']);

/** May this account open the place — the shell's own rule for its staff screens. */
export function mayOpenPlace(me: PlaceViewer | null | undefined, p: Pick<Place, 'who'>): boolean {
  if (p.who === 'all') return true;
  if (!me) return false;
  if (me.isSuper) return true;
  const held = [me.role, ...(me.roles ?? [])].filter(Boolean) as string[];
  if (p.who === 'admin') return held.includes('admin');
  if (p.who === 'numbers') return held.includes('admin') || !!me.isClubManager;
  if (p.who === 'approver') return held.some((r) => STAFF.has(r)) || !!me.canApprove;
  return held.some((r) => STAFF.has(r));
}

/** The places this account may open that answer what was typed. */
export function findPlaces(me: PlaceViewer | null | undefined, query: string, limit = 8): Place[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return PLACES.filter((p) => mayOpenPlace(me, p))
    .filter((p) => `${p.label} ${p.sub} ${p.also ?? ''}`.toLowerCase().includes(q) || q.split(/\s+/).every((w) => w.length >= 2 && `${p.label} ${p.also ?? ''}`.toLowerCase().includes(w)))
    .slice(0, limit);
}

