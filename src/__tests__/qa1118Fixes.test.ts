import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { postLoginPath } from '@/lib/auth/landing';
import { academySetupUrl } from '@/lib/academy/deep-links';
import { academyApprovalCopy } from '@/lib/notifications/copy';

// QA 11-18 (Instinct, 2.41.499, QA Import22 / QA Coach22).
describe('the coach notification and "לקבוע דבוקה" open the טופס התאמה, not the chat', () => {
  it('the setup link is the trainee page (where TraineeSetupBanner lives) with setup=1', () => {
    expect(academySetupUrl('abc')).toBe('/dashboard/academy/week?athleteId=abc&setup=1');
    expect(academySetupUrl('abc')).not.toContain('thread=');
  });
  it('every band/joining entry point uses it', () => {
    for (const f of ['src/lib/academy/loop-notify.ts', 'src/lib/academy/admit-server.ts', 'src/components/academy/AcademyShell.tsx']) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).toContain('academySetupUrl(');
      expect(s, f).not.toMatch(/academyThreadUrl\([^)]*\)\}?&setup=1|\$\{card\}&setup=1/);
    }
  });
  it('the week page mounts the form for a trainee the coach opens', () => {
    const page = readFileSync('src/app/(app)/dashboard/academy/week/page.tsx', 'utf8');
    expect(page).toContain('<TraineeHeader');
    expect(readFileSync('src/components/academy/TraineeHeader.tsx', 'utf8')).toContain('<TraineeSetupBanner');
  });
});

describe('an academy-only trainee lands on their own screen and never sees the club target', () => {
  it('lands on Today; club members and academy members of a group land on the feed', () => {
    expect(postLoginPath({ role: 'academy_user', groupId: null })).toBe('/dashboard');
    expect(postLoginPath({ isAcademy: true, groupId: null })).toBe('/dashboard');
    expect(postLoginPath({ role: 'academy_user', groupId: 'g1' })).toBe('/feed');
    expect(postLoginPath({ role: 'runner', groupId: 'g1' })).toBe('/feed');
    expect(postLoginPath({ role: 'runner', groupId: null })).toBe('/feed');
  });
  it('both sign-in doors use it', () => {
    expect(readFileSync('src/components/auth/EmailCodeSheet.tsx', 'utf8')).toContain('postLoginPath(');
    expect(readFileSync('src/app/auth/resolve/page.tsx', 'utf8')).not.toContain("router.replace('/feed')");
  });
  it('the feed week target does not fall back to the club plan for an academy-only trainee', () => {
    const s = readFileSync('src/app/api/feed/highlight/route.ts', 'utf8');
    expect(s).toMatch(/own \?\? \(isAcademyOnly\([^)]*\) \? null : club\)/);
  });
});

describe('the approval push does not promise a plan', () => {
  it('says the plan appears when the coach publishes it', () => {
    const c = academyApprovalCopy('he', { name: 'רוני גור' });
    expect(c.body).toBe('באפליקציה תוכל/י לראות את התוכנית כשהמאמן יפרסם אותה, לתת משוב על האימונים ולשוחח עם המאמן.');
    expect(c.title).toBe('רוני, ההרשמה אושרה! 🎉');
  });
});
