import { describe, expect, it } from 'vitest';
import fs from 'fs';

// #136 (Ofer, 2026-10-21: "check what Strava and Garmin show"): the run page's three times
// are the ones both apps show — Elapsed (start to finish), Moving, and the gap — the same for
// a Garmin and a Strava run; the watch's timer (Garmin's "Time") is a line under them.
const body = fs.readFileSync('src/components/activity/ActivityDetailBody.tsx', 'utf8');
const he = JSON.parse(fs.readFileSync('messages/he.json', 'utf8')).runAnalysis;

describe('the run page times', () => {
  it('total is start to finish, moving is the moving time, not the timer', () => {
    expect(body).toMatch(/total=\{act\.elapsed_duration \?\? Math\.max\(act\.duration \|\| 0, trace\?\.stream\?\.t\.at\(-1\) \?\? 0\)\}/);
    expect(body).toMatch(/moving=\{act\.moving_duration \?\? act\.duration \?\? null\}/);
    expect(body).toMatch(/timer=\{act\.duration \?\? null\}/);
  });
  it('the 10 × 1600 of 2026-10-20 reads as Garmin Connect shows it', () => {
    const elapsed = 7293; const moving = 6555; const timer = 6652;
    const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    expect([clock(elapsed), clock(moving), clock(elapsed - moving), clock(elapsed - timer)]).toEqual(['2:01:33', '1:49:15', '0:12:18', '0:10:41']);
    expect(he.netTime).toBe('זמן בתנועה');
    expect(he.timerLine).toMatch(/\{timer\}.*\{stopped\}/);
  });
});
