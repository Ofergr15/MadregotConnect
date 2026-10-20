import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';

// Polls (mockup ~/.cache/madregot/polls-proposal.html, Ofer 2026-10-20): reminders to whoever
// hasn't answered, and one push a day — a poll published shortly before the day-before push
// rides inside it.

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/push', () => ({ sendPushLocalized: vi.fn(), resolveAudience: vi.fn(), subscriptionsForAthletes: vi.fn() }));

const { dayBeforePushSoon } = await import('@/lib/surveys');

/** app_settings with a reminder config and this week's overrides. */
function db(settings: Record<string, unknown>) {
  return {
    from: () => ({
      select: () => ({
        eq: (_: string, key: string) => ({
          maybeSingle: async () => ({ data: key in settings ? { value: JSON.stringify(settings[key]) } : null }),
        }),
      }),
    }),
  } as never;
}
const CFG = { teamDays: [2, 5], dayBefore: { enabled: true, hour: 8 } };

describe('which day-before push a poll joins', () => {
  // Monday 2026-10-19, the day before Tuesday's team run; the push is at 08:00 Israel (05:00Z).
  it('the push later this morning, within three hours', async () => {
    expect(await dayBeforePushSoon(db({ reminder_config: CFG }), new Date('2026-10-19T03:30:00Z'))).toBe('2026-10-19T05:00:00.000Z');
  });
  it('not one that already went, or is hours away', async () => {
    expect(await dayBeforePushSoon(db({ reminder_config: CFG }), new Date('2026-10-19T05:10:00Z'))).toBeNull();
    expect(await dayBeforePushSoon(db({ reminder_config: CFG }), new Date('2026-10-19T00:30:00Z'))).toBeNull();
  });
  it('not on a day before nothing, nor when the push is off', async () => {
    expect(await dayBeforePushSoon(db({ reminder_config: CFG }), new Date('2026-10-20T03:30:00Z'))).toBeNull();
    expect(await dayBeforePushSoon(db({ reminder_config: { ...CFG, dayBefore: { enabled: false, hour: 8 } } }), new Date('2026-10-19T03:30:00Z'))).toBeNull();
    // Off this week on "תחילת שבוע" (the week of the team day, Sunday 2026-10-18).
    expect(await dayBeforePushSoon(db({ reminder_config: CFG, week_notif_overrides: { '2026-10-18': { 'dayBefore:2': { off: true } } } }), new Date('2026-10-19T03:30:00Z'))).toBeNull();
  });
});

const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('a poll reminder', () => {
  const cron = read('src/app/api/cron/notifications/route.ts');
  it('goes only to whoever has not answered, and not after the close', () => {
    expect(cron).toMatch(/if \(reminder\) \{[\s\S]{0,200}surveyReminder\(supabase, n\)/);
    expect(cron).toMatch(/closes && Date\.parse\(closes\) <= Date\.now\(\)\)\) return 0/);
    expect(cron).toMatch(/return notifySurveyNonResponders\(/);
  });
  it('ends silent, out of everybody\'s inbox', () => {
    expect(cron).toMatch(/status: reminder \? 'silent' : 'sent'/);
  });
  it('is scheduled from what the publish screen ticked', () => {
    const api = read('src/app/api/admin/surveys/route.ts');
    expect(api).toMatch(/planReminders\(closes, keys, custom\)/);
    expect(read('src/components/publish/SurveySettings.tsx')).toMatch(/DEFAULT_REMINDERS: RemindersValue = \{ picked: \['week', 'day', 'hour'\]/);
  });
  it('closing the poll early drops the ones still to come', () => {
    expect(read('src/app/api/admin/content/surveys/[id]/route.ts')).toMatch(/closes_at: nowIso[\s\S]{0,80}cancelSurveyReminders\(db, id\)/);
  });
});
