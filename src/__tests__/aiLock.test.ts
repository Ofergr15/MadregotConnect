import { afterEach, describe, expect, it } from 'vitest';
import { claimAiTurn, releaseAiTurn, resetAiLockForTests } from '@/lib/run-chat/ai-lock';

describe('claimAiTurn', () => {
  afterEach(() => {
    resetAiLockForTests();
  });

  it('rejects a second claim for the same chat while a turn is in flight', () => {
    expect(claimAiTurn('chat-1', 'msg-a')).toBe(true);
    expect(claimAiTurn('chat-1', 'msg-b')).toBe(false);
  });

  it('rejects the same mention after it was already claimed', () => {
    expect(claimAiTurn('chat-1', 'msg-a')).toBe(true);
    releaseAiTurn('chat-1');
    expect(claimAiTurn('chat-1', 'msg-a')).toBe(false);
  });

  it('allows a new mention after the previous turn is released', () => {
    expect(claimAiTurn('chat-1', 'msg-a')).toBe(true);
    releaseAiTurn('chat-1');
    expect(claimAiTurn('chat-1', 'msg-b')).toBe(true);
  });

  it('does not start a second turn for a late Stream confirm with a new id', () => {
    expect(claimAiTurn('chat-1', 'local-echo')).toBe(true);
    expect(claimAiTurn('chat-1', 'server-confirm')).toBe(false);
    releaseAiTurn('chat-1');
    expect(claimAiTurn('chat-1', 'server-confirm')).toBe(false);
  });
});
