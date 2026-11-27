import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FEATURES } from '@/lib/features/flags';

describe('web_week_today_first', () => {
  it('is a default-off flag', () => {
    expect(FEATURES.web_week_today_first.defaultEnabled).toBe(false);
  });
  it('the dashboard renders today first only behind the flag, and TodayCards keys days by planDayKey', () => {
    const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8');
    expect(page).toContain("useFeature('web_week_today_first')");
    expect(page).toMatch(/\{todayFirst && todayCards\}/);
    const today = readFileSync('src/components/home/TodayHome.tsx', 'utf8');
    expect(today).toContain('planDayKey(');
    expect(today).not.toMatch(/dayOfWeek === new Date\(\)\.getDay\(\)/);
  });
});
