// ═════════════════════════════════════════════════════════════════════════════
// FEATURE ENABLEMENT — a gated rollout, OFF unless someone turned it on.
//
// Ofer (2026-11-21), about runner feedback + pain reports: "we won't use it at
// first; we need to see it's right for trainees". So a feature is invisible to an
// athlete until a row in `feature_enablements` (migration 191) says otherwise, and
// the people who may write such a row are scoped by who they are responsible for:
//
//   coach            → an athlete they coach (club coach: any club runner;
//                      academy coach: their own trainees)
//   academy manager  → any academy trainee, one by one, or the whole academy
//   admin / super    → anyone: athlete, squad, role, academy, or the whole club
//
// Precedence is MOST SPECIFIC WINS, and an explicit `enabled: false` is an answer,
// not an absence: a coach can switch one runner off inside a squad an admin turned on.
//
//   athlete > squad > academy > role > club > default (off)
//
// Everything in this file is pure; the DB reads live in ./server.ts.
// ═════════════════════════════════════════════════════════════════════════════

export const FEATURES = {
  /** Post-workout feedback prompts + pain reports (design/feedback-prototype). */
  feedback_pain: { label: 'משוב ודיווח כאב', defaultEnabled: false },
  /** שיאים tab: weekly board, champions, squad comparison (design/records-prototype). */
  records_tab: { label: 'לשונית שיאים', defaultEnabled: false },
  /** Native השבוע in the בריאות grammar: structure bar, squad switch, week chart (design/week-health). */
  week_health: { label: 'השבוע — עיצוב בריאות', defaultEnabled: false },
  /** Race-day live tracking + milestone pushes (lib/race-live, migration 196). */
  race_live: { label: 'מעקב חי במרוץ', defaultEnabled: false },
  /** Native היסטוריית אימונים: every own run, paged, month/type/plan filters (ios Features/History). */
  history: { label: 'היסטוריית אימונים', defaultEnabled: false },
  /** Native app: staff get the coach shell (CoachTabView) instead of the runner tabs. iOS build 15+. */
  native_coach: { label: 'מסכי מאמן באפליקציה', defaultEnabled: false },
  // ── Native build 16: build-15 surfaces no Release user could reach (review-2026-11-20 gap audit).
  /** אירועים: the entry row on השבוע → events list / RSVP. */
  events: { label: 'אירועים', defaultEnabled: false },
  /** ריצות משותפות: the השבוע chip and the feed strip. */
  run_together: { label: 'ריצות משותפות', defaultEnabled: false },
  /** "קובץ התוכנית" opens the list of every week's files (off: this week's files only). */
  program_files: { label: 'רשימת קבצי התוכנית', defaultEnabled: false },
  /** Academy registration submitted from the app against the live club server. */
  academy_register: { label: 'הרשמה לאקדמיה מהאפליקציה', defaultEnabled: false },
  /** U21 personal coach: the entry on the registration screen + POST /api/u21/register (club scope, signed-out readable). */
  u21_entry: { label: 'הרשמה ל-U21 (מאמן אישי)', defaultEnabled: false },
  /** תגים card on Profile (read-only GET /api/athletes/badges). */
  profile_badges: { label: 'כרטיס תגים בפרופיל', defaultEnabled: false },
  /** לוח המועדון: native club calendar (practices + events) with practice RSVP via POST /api/attendance. */
  calendar: { label: 'לוח המועדון', defaultEnabled: false },
  /** Training attendance for staff (native coach shell), from GET /api/attendance/real. */
  native_mgmt_attendance: { label: 'נוכחות באימונים (אפליקציה)', defaultEnabled: false },
  /** Native academy coach tab (trainees, plans, hub) in the coach shell. */
  academy_coach: { label: 'לשונית מאמן אקדמיה (אפליקציה)', defaultEnabled: false },
  /** Native academy trainee home + coach chat send. */
  academy_trainee: { label: 'בית מתאמן אקדמיה (אפליקציה)', defaultEnabled: false },
  // ── Native admin ops (coach shell).
  native_mgmt_entry_queue: { label: 'תור כניסה (אפליקציה)', defaultEnabled: false },
  native_mgmt_onboarding_funnel: { label: 'משפך הצטרפות (אפליקציה)', defaultEnabled: false },
  /** Includes the maintenance toggle (PUT /api/maintenance, canApprove): changes the app for everyone. */
  native_mgmt_control_room: { label: 'חדר בקרה (אפליקציה)', defaultEnabled: false },
  native_mgmt_push_health: { label: 'בריאות התראות (אפליקציה)', defaultEnabled: false },
  native_mgmt_data_check: { label: 'בדיקת נתונים (אפליקציה)', defaultEnabled: false },
  /** Staff numbers: מדרגות במספרים + נפח הצוות (club-numbers, coach/volume). */
  native_mgmt_numbers: { label: 'מדרגות במספרים (אפליקציה)', defaultEnabled: false },
  /** Native coach insights screen (staff). */
  native_mgmt_coach_insights: { label: 'תובנות מאמן (אפליקציה)', defaultEnabled: false },
  /** Native plan history screen (staff). */
  native_mgmt_plan_history: { label: 'היסטוריית תוכניות (אפליקציה)', defaultEnabled: false },
  /** Native new-record celebration sheet. */
  new_record_sheet: { label: 'מסך שיא חדש (אפליקציה)', defaultEnabled: false },
  /** Native wellness strip on home. */
  wellness_strip: { label: 'פס בריאות (אפליקציה)', defaultEnabled: false },
  /** Native birthday year-in-review card. */
  birthday_year_card: { label: 'כרטיס שנה ביום הולדת (אפליקציה)', defaultEnabled: false },
  /** Native Apple Health data-source row. */
  apple_health: { label: 'Apple Health (אפליקציה)', defaultEnabled: false },
  /** Native academy pack (trainee home, self-report, coach-thread send). */
  academy_pack: { label: 'חבילת אקדמיה (אפליקציה)', defaultEnabled: false },
  /** Native academy coach–trainee chat SEND (POST /api/academy/threads/messages). */
  academy_chat_send: { label: 'שליחה בצ׳אט אקדמיה (אפליקציה)', defaultEnabled: false },
  /** Native weekly moments: trainee week card + coach queue/compose/receipts + manager on-time board (academy doc p.2–3). */
  academy_week_moments: { label: 'רגעי השבוע באקדמיה (אפליקציה)', defaultEnabled: false },
  /** Native notification preferences screen (own categories). */
  notif_prefs: { label: 'העדפות התראות (אפליקציה)', defaultEnabled: false },
  /** Native packs management (staff): group edit + move runners, PUT /api/athletes, /api/groups. */
  native_mgmt_packs: { label: 'ניהול דבוקות (אפליקציה)', defaultEnabled: false },
  /** Native watch connections (Garmin/Strava connect from the app, /api/me/data-sources/**). */
  data_sources: { label: 'חיבור שעון באפליקציה', defaultEnabled: false },
  /** Native season program (read-only, member routes). */
  season_program: { label: 'תוכנית העונה (אפליקציה)', defaultEnabled: false },
  /** Native profile editing (own profile). */
  profile_edit: { label: 'עריכת פרופיל (אפליקציה)', defaultEnabled: false },
  /** Native club updates: publish from the phone (club-updates routes, resolveVerifiedCaller). */
  native_club_updates: { label: 'עדכוני מועדון (אפליקציה)', defaultEnabled: false },
  /** Native day / quality session for coaches. */
  native_mgmt_day_session: { label: 'אימון איכות ויום אימון (אפליקציה)', defaultEnabled: false },
  // ── Native management screens (coach shell, read-only), iOS native-mgmt-readonly.
  native_mgmt_registrations: { label: 'אישורי הרשמה (אפליקציה)', defaultEnabled: false },
  native_mgmt_groups: { label: 'קבוצות וחברים (אפליקציה)', defaultEnabled: false },
  native_mgmt_roles: { label: 'תפקידים וניתוב התראות (אפליקציה)', defaultEnabled: false },
  native_mgmt_scheduled: { label: 'התראות מתוזמנות (אפליקציה)', defaultEnabled: false },
  // Gates the native PlanEdit, which writes PUT /api/plans and bypasses weekly_plan_versions.
  // Keep OFF until PlanEdit moves onto /api/plan-builder/* (the single writer) or is removed.
  native_mgmt_staff_week: { label: 'תוכנית שבוע לצוות (אפליקציה) — לא להפעיל עדיין', defaultEnabled: false },
  // ── iOS: screens that replace hand-offs to the PWA (native-no-pwa).
  /** עזרה ואודות: native bug report (POST /api/feedback) + What's New (GET /api/whats-new). */
  native_help: { label: 'עזרה ומה חדש (אפליקציה)', defaultEnabled: false },
  /** Viewer accounts see the club feed inside the app instead of a link to the website. */
  native_viewer_feed: { label: 'פיד לחשבון צפייה (אפליקציה)', defaultEnabled: false },
  // ── Native build 21.
  /** Coach-tools hub in the coach shell. */
  native_mgmt_coach_tools: { label: 'כלי מאמן (אפליקציה)', defaultEnabled: false },
  /** Athletes directory for staff. */
  native_mgmt_athletes: { label: 'רשימת הרצים (אפליקציה)', defaultEnabled: false },
  /** Photos gallery (read-only, Drive-sourced). */
  native_photos: { label: 'גלריית תמונות (אפליקציה)', defaultEnabled: false },
  /** Native cache-first paint: main tabs show the saved copy instantly, refresh in the background. */
  perf_cache_first: { label: 'פתיחה מיידית מהעותק השמור (אפליקציה)', defaultEnabled: false },
  /** Native opts in to the lighter server shapes (#72): group on athletes/me, activities?shape=list. */
  perf_server_shapes: { label: 'נתונים קלים יותר מהשרת (אפליקציה)', defaultEnabled: false },
  // build 21 — every key the native app reads; all off until someone turns them on.
  club_tab: { label: 'לשונית מועדון (אפליקציה)', defaultEnabled: false },
  native_benefits: { label: 'הטבות (אפליקציה)', defaultEnabled: false },
  native_club_stories: { label: 'סטוריז מועדון (אפליקציה)', defaultEnabled: false },
  native_core_perks: { label: 'הטבות ליבה (אפליקציה)', defaultEnabled: false },
  native_mgmt_access: { label: 'ניהול גישה (אפליקציה)', defaultEnabled: false },
  native_mgmt_birthdays: { label: 'ימי הולדת (אפליקציה)', defaultEnabled: false },
  // כספים (b22, native Features/Finance): manager-only finance screen — GET /api/admin/finance, POST /api/admin/finance/remind.
  native_mgmt_finance: { label: 'כספים (אפליקציה)', defaultEnabled: false },
  native_mgmt_content: { label: 'ניהול תוכן (אפליקציה)', defaultEnabled: false },
  native_mgmt_pack_moves: { label: 'העברות בין דבוקות (אפליקציה)', defaultEnabled: false },
  native_mgmt_pain: { label: 'דיווחי כאב (אפליקציה)', defaultEnabled: false },
  native_mgmt_people: { label: 'אנשים (אפליקציה)', defaultEnabled: false },
  native_mgmt_plan_builder: { label: 'בונה תוכניות (אפליקציה)', defaultEnabled: false },
  native_mgmt_review: { label: 'סקירה (אפליקציה)', defaultEnabled: false },
  native_mgmt_signup_tests: { label: 'מבחני הרשמה (אפליקציה)', defaultEnabled: false },
  native_mgmt_team_volume: { label: 'נפח קבוצתי (אפליקציה)', defaultEnabled: false },
  native_mgmt_training: { label: 'ניהול אימונים (אפליקציה)', defaultEnabled: false },
  native_practice: { label: 'אימונים (אפליקציה)', defaultEnabled: false },
  native_run_share: { label: 'שיתוף ריצה (אפליקציה)', defaultEnabled: false },
  native_store: { label: 'חנות (אפליקציה)', defaultEnabled: false },
  native_surveys: { label: 'סקרים (אפליקציה)', defaultEnabled: false },
  perf_get_memo: { label: 'זיכרון בקשות (אפליקציה)', defaultEnabled: false },
  profile_trend: { label: 'מגמה בפרופיל (אפליקציה)', defaultEnabled: false },
  run_chat: { label: 'צ׳אט ריצה (אפליקציה)', defaultEnabled: false },
  search: { label: 'חיפוש (אפליקציה)', defaultEnabled: false },
  teammate_full: { label: 'פרופיל חבר מלא (אפליקציה)', defaultEnabled: false },
  native_mgmt_pack_stories: { label: 'סטוריז דבוקה (אפליקציה)', defaultEnabled: false },
  native_review: { label: 'סקירה (אפליקציה, מתאמן)', defaultEnabled: false },
  /** "שלח שוב לשעון": a runner re-sends their own day's workout (POST /api/me/watch/resend). */
  native_resend_workout: { label: 'שליחה חוזרת לשעון (אפליקציה)', defaultEnabled: false },
  /** b22 run detail v2: short overview + charts/laps/more tabs, full plan-vs-actual, similar-workouts comparison (ios Features/RunDetail/V2). */
  run_detail_v2: { label: 'פרטי ריצה — עיצוב חדש (אפליקציה)', defaultEnabled: false },
  /** b22 native onboarding after approval: welcome, setup checklist, resume card, paused / viewer gates (ios Onboarding). */
  native_onboarding_setup: { label: 'הצטרפות — צ׳קליסט הגדרה (אפליקציה)', defaultEnabled: false },
  /** אימוני כוח: קליטה מ-Garmin/Strava, כרטיס פיד, פירוט סטים, "בוצע" (review-2026-11-20/strength/plan.md). */
  strength_training: { label: 'אימוני כוח', defaultEnabled: false },
  /** Drive photos v2 (night queue #101): mirror status for staff, each folder tied to its day's session,
   *  album imports deduped. Source = the session-photos folder only. Face tagging stays off regardless. */
  photos_drive_v2: { label: 'תמונות מ-Drive v2: סטטוס, קישור לאימון, בלי כפילויות', defaultEnabled: false },
  // ── Native build 22: surfaces the app reads that had no key here, so no admin could turn them on.
  /** A runner moves themselves to another pack from the app (onboarding/group-change). */
  native_self_group_change: { label: 'שינוי דבוקה עצמי (אפליקציה)', defaultEnabled: false },
  /** Club numbers month vs month (native club tab). */
  club_stats_monthly: { label: 'המועדון חודש מול חודש (אפליקציה)', defaultEnabled: false },
  /** Leads list in the native management menu. */
  native_mgmt_leads: { label: 'לידים (אפליקציה)', defaultEnabled: false },
  /** The redesigned manager home in the native coach shell. */
  native_mgmt_manager_home_v2: { label: 'בית מנהל חדש (אפליקציה)', defaultEnabled: false },
  /** Manual photo tags ("התמונות שלי") and likes ("אהבתי"), migration 214. Members only; the tagged person approves or removes.
   *  No face recognition. Off → /api/photos/tags* and /api/photos/likes* answer 404. */
  photos_social: { label: 'תמונות: תיוג ידני (התמונות שלי) ולייקים (אהבתי)', defaultEnabled: false },
} as const;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(v: unknown): v is FeatureKey {
  return typeof v === 'string' && (FEATURE_KEYS as string[]).includes(v);
}

/**
 * Keys a SIGNED-OUT device may read, club scope only (GET /api/features/public): the academy form lives
 * on the signed-out gateway, where there is no caller to resolve. Only a club-wide switch is ever
 * disclosed — never a per-athlete/squad/role row.
 */
export const PUBLIC_FEATURE_KEYS: readonly FeatureKey[] = ['academy_register', 'u21_entry', 'native_onboarding_setup'];

/** The club-wide answer alone: only a `club` row counts; no row = the default (off). */
export function resolveClubScope(feature: FeatureKey, rows: EnablementRow[]): boolean {
  const club = rows.find((r) => r.feature === feature && r.scope_type === 'club' && r.scope_id === CLUB_SCOPE_ID);
  return club ? !!club.enabled : FEATURES[feature].defaultEnabled;
}

export const SCOPE_TYPES = ['athlete', 'squad', 'academy', 'role', 'club'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** Lower = more specific = wins. */
export const SCOPE_RANK: Record<ScopeType, number> = { athlete: 0, squad: 1, academy: 2, role: 3, club: 4 };

/** The fixed `scope_id` of the two scopes that name no row. */
export const ACADEMY_SCOPE_ID = 'academy';
export const CLUB_SCOPE_ID = '*';

export function isScopeType(v: unknown): v is ScopeType {
  return typeof v === 'string' && (SCOPE_TYPES as readonly string[]).includes(v);
}

export interface EnablementRow {
  feature: string;
  scope_type: ScopeType;
  scope_id: string;
  enabled: boolean;
  set_by?: string | null;
  set_at?: string | null;
}

/** What the resolver needs to know about the athlete. */
export interface AthleteFacts {
  id: string;
  groupId?: string | null;
  role?: string | null;
  extraRoles?: string[] | null;
  isAcademy?: boolean;
}

export interface Resolution {
  enabled: boolean;
  /** The row that decided it, or null for the default. */
  source: { scopeType: ScopeType; scopeId: string; setBy: string | null; setAt: string | null } | null;
}

/** Does this row apply to this athlete at all? */
export function rowApplies(row: EnablementRow, a: AthleteFacts): boolean {
  switch (row.scope_type) {
    case 'athlete': return row.scope_id === a.id;
    case 'squad': return !!a.groupId && row.scope_id === String(a.groupId);
    case 'academy': return !!a.isAcademy && row.scope_id === ACADEMY_SCOPE_ID;
    case 'role': return row.scope_id === a.role || !!a.extraRoles?.includes(row.scope_id);
    case 'club': return row.scope_id === CLUB_SCOPE_ID;
    default: return false;
  }
}

/**
 * Most-specific-wins. Two rows at the same rank can only both apply for `role`
 * (an athlete holding two roles): there an explicit OFF beats ON, the cautious
 * reading of a contradiction.
 */
export function resolveFeature(feature: FeatureKey, rows: EnablementRow[], a: AthleteFacts): Resolution {
  let best: EnablementRow | null = null;
  for (const r of rows) {
    if (r.feature !== feature || !isScopeType(r.scope_type) || !rowApplies(r, a)) continue;
    if (!best) { best = r; continue; }
    const d = SCOPE_RANK[r.scope_type] - SCOPE_RANK[best.scope_type];
    if (d < 0 || (d === 0 && best.enabled && !r.enabled)) best = r;
  }
  if (!best) return { enabled: FEATURES[feature].defaultEnabled, source: null };
  return {
    enabled: !!best.enabled,
    source: { scopeType: best.scope_type, scopeId: best.scope_id, setBy: best.set_by ?? null, setAt: best.set_at ?? null },
  };
}

// ── Who may toggle what ──────────────────────────────────────────────────────

export interface ToggleCaller {
  athleteId: string | null;
  role: string | null;
  roles?: string[] | null;
  isSuperUser: boolean;
}

export interface ToggleTarget {
  scopeType: ScopeType;
  scopeId: string;
  /** For an athlete scope: the target's facts plus whether the caller coaches them. */
  athlete?: { isAcademy: boolean; coachedByCaller: boolean } | null;
}

const has = (c: ToggleCaller, role: string) => c.role === role || !!c.roles?.includes(role);

export function isAdminCaller(c: ToggleCaller): boolean {
  return c.isSuperUser || has(c, 'admin');
}

export function isAcademyManagerCaller(c: ToggleCaller): boolean {
  return has(c, 'academy_manager');
}

/** Which scope types this caller may write at all — what the management screen offers. */
export function allowedScopeTypes(c: ToggleCaller): ScopeType[] {
  if (isAdminCaller(c)) return [...SCOPE_TYPES];
  const out: ScopeType[] = [];
  if (isAcademyManagerCaller(c) || has(c, 'coach') || has(c, 'academy_coach')) out.push('athlete');
  if (isAcademyManagerCaller(c)) out.push('academy');
  return out;
}

/**
 * The one decision every write route asks. A body field never widens it: the
 * route derives `coachedByCaller` and `isAcademy` from the DB, not the request.
 */
export function mayToggle(c: ToggleCaller, t: ToggleTarget): boolean {
  if (isAdminCaller(c)) return true;
  if (t.scopeType === 'academy') return isAcademyManagerCaller(c) && t.scopeId === ACADEMY_SCOPE_ID;
  if (t.scopeType !== 'athlete' || !t.athlete) return false;
  if (c.athleteId && t.scopeId === c.athleteId) return false; // nobody gates themselves in
  if (isAcademyManagerCaller(c) && t.athlete.isAcademy) return true;
  if (t.athlete.coachedByCaller && (has(c, 'coach') || has(c, 'academy_coach'))) return true;
  return false;
}

/**
 * Does this coach coach this athlete? Club coach (`coach`): every club runner who is
 * not an academy trainee, plus academy trainees they are linked to. Academy coach:
 * only linked trainees.
 */
export function coachesAthlete(c: ToggleCaller, a: { isAcademy: boolean; academyCoachIds: string[] }): boolean {
  if (!c.athleteId) return false;
  if (a.academyCoachIds.includes(c.athleteId)) return true;
  return !a.isAcademy && has(c, 'coach');
}

/** Which athletes the caller's management screen lists. */
export function visibleToManager(c: ToggleCaller, a: { isAcademy: boolean; academyCoachIds: string[] }): boolean {
  if (isAdminCaller(c)) return true;
  if (isAcademyManagerCaller(c) && a.isAcademy) return true;
  return coachesAthlete(c, a);
}
