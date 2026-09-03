type AiLockState = {
  seen: Set<string>;
  inflight: Set<string>;
};

const GLOBAL_KEY = '__madregotAiLock';

function lockState(): AiLockState {
  const globalWithLock = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: AiLockState;
  };
  if (!globalWithLock[GLOBAL_KEY]) {
    globalWithLock[GLOBAL_KEY] = { seen: new Set(), inflight: new Set() };
  }
  return globalWithLock[GLOBAL_KEY];
}

/** Claim the next AI turn for this chat. False if this mention is already running. */
export function claimAiTurn(chatId: string, messageId?: string): boolean {
  const state = lockState();
  const seenKey = messageId ? `${chatId}:${messageId}` : null;
  if (seenKey && state.seen.has(seenKey)) return false;
  if (state.inflight.has(chatId)) {
    // Stream often confirms the same send under a second id. Remember it
    // so a late echo cannot start another turn after this one finishes.
    if (seenKey) state.seen.add(seenKey);
    return false;
  }
  if (seenKey) state.seen.add(seenKey);
  state.inflight.add(chatId);
  return true;
}

export function releaseAiTurn(chatId: string) {
  lockState().inflight.delete(chatId);
}

export function resetAiLockForTests() {
  const globalWithLock = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: AiLockState;
  };
  delete globalWithLock[GLOBAL_KEY];
}
