import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: 0, mode: 'missing' as 'missing' | 'down' }));
vi.mock('@/lib/stream/server', () => ({
  getStreamServerClient: () => ({
    getUnreadCount: async () => {
      h.calls++;
      if (h.mode === 'missing') throw Object.assign(new Error('the user x does not exist'), { code: 16, response: { status: 404 } });
      throw Object.assign(new Error('timeout'), { code: 9 });
    },
  }),
}));

import { streamUnreadForAthlete, isMissingChatUser } from '@/lib/stream/unread';

describe('chat unread for an athlete who never opened a chat', () => {
  it('counts 0 without an error log, and asks Stream once, not every poll', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.mode = 'missing'; h.calls = 0;
    expect(await streamUnreadForAthlete('no-chat')).toBe(0);
    expect(await streamUnreadForAthlete('no-chat')).toBe(0);
    expect(h.calls).toBe(1);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('still logs a real Stream failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.mode = 'down';
    expect(await streamUnreadForAthlete('someone')).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('recognises only the missing-user answer', () => {
    expect(isMissingChatUser({ code: 16, response: { status: 404 } })).toBe(true);
    expect(isMissingChatUser({ code: 16, response: { status: 500 } })).toBe(false);
    expect(isMissingChatUser(new Error('x'))).toBe(false);
  });
});
