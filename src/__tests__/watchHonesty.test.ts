import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

/**
 * "Sent to Garmin" is not "on the watch" (2026-10-19): the 19.10 session was on Ofer's
 * Garmin account at 21:15 and not on his watch at 07:05, while the feed said it was.
 * The app sees the account, never the device — so a check mark only once a run proves it.
 */
describe('watch status says what the app knows', () => {
  it('the feed pill shows a check only once a run used the workout', () => {
    const card = readFileSync('src/components/feed/NextSessionCard.tsx', 'utf8');
    expect(card).toMatch(/watchState === 'ran' \? <Check className="h-3 w-3" \/> : onWatch && <RefreshCw className="h-3 w-3" \/>/);
  });

  it('the week card and the coach say "sent to Garmin", not "on the watch"', () => {
    expect(readFileSync('src/components/feed/WeekWatchCard.tsx', 'utf8')).not.toMatch(/כל אימוני השבוע בשעון שלך/);
    const watch = readFileSync('src/lib/day-session/watch.ts', 'utf8');
    expect(watch).not.toMatch(/`בשעון אצל/);
    expect(readFileSync('src/components/day-session/WatchSend.tsx', 'utf8')).not.toMatch(/>בשעון אצל /);
  });

  it('a send for tomorrow after the 20:00 reminder brings its own "sync your watch" push', () => {
    const watch = readFileSync('src/lib/day-session/watch.ts', 'utf8');
    expect(watch).toMatch(/s\.date === addDaysToDateStr\(israelToday\(\), 1\) && nowParts\.hour >= SYNC_NUDGE_FROM_HOUR/);
    expect(watch).toMatch(/kind: 'watch_sync'/);
  });
});
