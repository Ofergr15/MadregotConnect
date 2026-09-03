'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface RunChatSession {
  chatId: string;
  supabaseToken: string;
}

const RunChatSessionContext = createContext<RunChatSession | null>(null);

/** Lets attachments rendered deep inside Stream's tree call our APIs as the signed-in user. */
export function RunChatSessionProvider({
  chatId,
  supabaseToken,
  children,
}: RunChatSession & { children: ReactNode }) {
  return (
    <RunChatSessionContext.Provider value={{ chatId, supabaseToken }}>
      {children}
    </RunChatSessionContext.Provider>
  );
}

export function useRunChatSession(): RunChatSession | null {
  return useContext(RunChatSessionContext);
}
