import { isU21Track, type U21Track } from './intake';

/**
 * Entry link from the registration page's U21 section: /u21?track=<id>.
 *
 * Feasibility demo only (Ofer, Nov 19: "בעמוד הרשמה יהיה למטה סקשן שבו לא
 * נבקש סטראבה או גוגל או משהו ואז יהיה בחירת מסלול וכניסה קדימה... כרגע אני
 * רוצה להראות את ההיתכנות"). No Strava/Google connection, no billing and no
 * eligibility check at this stage; protection mechanisms come later.
 */
export const u21EntryHref = (track: U21Track): string => `/u21?track=${track}`;

/** Accepts only exact track ids; anything else falls back to no preselection. */
export const parseU21TrackParam = (raw: string | null | undefined): U21Track | null =>
  raw != null && isU21Track(raw) ? raw : null;
