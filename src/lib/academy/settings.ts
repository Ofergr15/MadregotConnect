import { DEFAULT_TOLERANCES } from './adherence';

// Coach-level academy configuration, stored as one JSON blob in academy_settings.
// Every field has a default so the app works before anything is saved.
export interface AcademySettings {
  // Benchmark tests that exist (drives result entry + leaderboards). First is default.
  tests: string[];
  // Adherence tolerances: distance/duration are fractions (0.15 = ±15%); pace is
  // ± SECONDS per km (5 → a 5:00 target is good from 4:55 to 5:05).
  tolerances: { distance: number; duration: number; paceSec: number };
  // Push pace-zone alerting for academy athletes (the "old model"). When false,
  // even academy athletes get info-only pace (no beep).
  paceAlerts: boolean;
  // Weekly report delivery.
  report: { recipients: string[]; day: number }; // day: 0=Sun..6=Sat (default Mon=1)
}

export const DEFAULT_ACADEMY_SETTINGS: AcademySettings = {
  tests: ['2000m'],
  tolerances: { ...DEFAULT_TOLERANCES },
  paceAlerts: true,
  report: { recipients: [], day: 1 },
};

// Merge a stored (possibly partial / legacy) blob onto the defaults.
export function normalizeSettings(raw: any): AcademySettings {
  const d = DEFAULT_ACADEMY_SETTINGS;
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    tests: Array.isArray(r.tests) && r.tests.length
      ? r.tests.map((t: any) => String(t)).filter(Boolean)
      : [...d.tests],
    tolerances: {
      distance: numOr(r.tolerances?.distance, d.tolerances.distance),
      duration: numOr(r.tolerances?.duration, d.tolerances.duration),
      paceSec: numOr(r.tolerances?.paceSec, d.tolerances.paceSec),
    },
    paceAlerts: typeof r.paceAlerts === 'boolean' ? r.paceAlerts : d.paceAlerts,
    report: {
      recipients: Array.isArray(r.report?.recipients)
        ? r.report.recipients.map((s: any) => String(s).trim()).filter(Boolean)
        : [...d.report.recipients],
      day: Number.isInteger(r.report?.day) && r.report.day >= 0 && r.report.day <= 6
        ? r.report.day
        : d.report.day,
    },
  };
}

function numOr(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
