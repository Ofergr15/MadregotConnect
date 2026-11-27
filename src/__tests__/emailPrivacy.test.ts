import { describe, expect, it } from 'vitest';
import { clickedLinkForLog, eventRowFrom, suppressedAddresses } from '@/lib/email/tracking';

describe('clicked links are stored without secrets', () => {
  it('drops query and fragment', () => {
    expect(clickedLinkForLog('https://www.madregot.app/claim?token=abc123&email=a@b.c#x')).toBe('https://www.madregot.app/claim');
  });
  it('handles junk and empty', () => {
    expect(clickedLinkForLog('not a url?token=1')).toBe('not a url');
    expect(clickedLinkForLog(null)).toBeNull();
  });
  it('webhook row uses the stripped link', () => {
    const row = eventRowFrom({ type: 'email.clicked', data: { email_id: 'e1', to: ['A@B.com'], click: { link: 'https://x.app/login?code=123456' } } }, 's1');
    expect(row?.detail).toBe('https://x.app/login');
    expect(row?.recipient).toBe('a@b.com');
  });
});

describe('suppression list', () => {
  it('complaints and hard bounces are suppressed; transient bounces are not', () => {
    const s = suppressedAddresses([
      { type: 'complained', recipient: 'Spam@x.com', detail: null },
      { type: 'bounced', recipient: 'gone@x.com', detail: 'Permanent · General' },
      { type: 'bounced', recipient: 'full@x.com', detail: 'Transient · MailboxFull' },
      { type: 'opened', recipient: 'ok@x.com', detail: null },
    ]);
    expect([...s].sort()).toEqual(['gone@x.com', 'spam@x.com']);
  });
});
