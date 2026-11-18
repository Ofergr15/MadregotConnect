import { describe, it, expect } from 'vitest';
import { academyExistingFormEmail, academyMoveInEmail } from '@/lib/email';

// Owner 11-18: the move-in mails must not promise a plan that may not exist yet.
const LINE = 'באפליקציה תוכל/י לראות את התוכנית כשהמאמן יפרסם אותה, לתת משוב על האימונים ולשוחח עם המאמן.';
const text = (h: string) => h.replace(/<[^>]+>/g, ' ');

describe('academy move-in mails: no plan promise', () => {
  for (const [name, m] of [
    ['details form', academyExistingFormEmail({ name: 'רוני גור', url: 'https://x/academy-register?i=t' })],
    ['install', academyMoveInEmail({ name: 'רוני גור', token: 't', coachCount: 1 })],
  ] as const) {
    it(`${name}: says the plan appears when the coach publishes it`, () => {
      expect(text(m.html)).toContain(LINE);
      expect(text(m.html)).not.toMatch(/הקצבים לשעון|נמצאים באפליקציה|יגיעו באפליקציה/);
    });
  }
});
