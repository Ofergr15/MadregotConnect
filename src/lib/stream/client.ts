'use client';

import { useState, useEffect } from 'react';
import { Streami18n, useCreateChatClient } from 'stream-chat-react';
import type { StreamChat } from 'stream-chat';

export interface StreamTokenData {
  apiKey: string;
  userId: string;
  token: string;
  userName: string;
  /** Optional role label for UI (רץ / מאמן / …) */
  roleLabel?: string;
  /** Club / Google profile photo when available */
  imageUrl?: string | null;
}

/** Fetches a Stream user token. Returns null until ready. */
export function useStreamToken(supabaseToken: string | null): StreamTokenData | null {
  const [tokenData, setTokenData] = useState<StreamTokenData | null>(null);

  useEffect(() => {
    if (!supabaseToken) {
      setTokenData(null);
      return;
    }
    let cancelled = false;
    fetch('/api/run-chat/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.token && d?.apiKey && d?.userId) setTokenData(d);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [supabaseToken]);

  return tokenData;
}

/**
 * Connects a StreamChat client. MUST only be called from a component that
 * mounts after tokenData is available — passing an empty token throws
 * "User token can not be empty" from TokenManager.
 */
export function useConnectedStreamClient(tokenData: StreamTokenData): StreamChat | undefined {
  const displayName = tokenData.roleLabel
    ? `${tokenData.userName} · ${tokenData.roleLabel}`
    : tokenData.userName;

  return useCreateChatClient({
    apiKey: tokenData.apiKey,
    tokenOrProvider: tokenData.token,
    userData: {
      id: tokenData.userId,
      name: displayName,
      ...(tokenData.imageUrl ? { image: tokenData.imageUrl } : {}),
    },
  }) ?? undefined;
}

/** Hebrew UI strings — use translationsForLanguage so we don't wipe Stream defaults
 *  (wiping them broke timestamp formatting → raw ISO strings overlapping reactions). */
export function buildI18n() {
  return new Streami18n({
    language: 'en',
    translationsForLanguage: {
      'Nothing yet...': 'אין הודעות עדיין...',
      'Type a message': 'כתוב הודעה',
      'Send a message': 'כתוב הודעה',
      Send: 'שלח',
      'Message deleted': 'ההודעה נמחקה',
      'This message was deleted...': 'הודעה זו נמחקה...',
      Reply: 'הגב',
      replyCount_one: 'תגובה אחת',
      replyCount_other: '{{ count }} תגובות',
      Thread: 'שרשור',
      'Thread reply': 'תגובה בשרשור',
      'Thread Reply': 'תגובה בשרשור',
      'Reply to a message to start a thread': 'השב להודעה כדי להתחיל שרשור',
      'Quote Reply': 'השב עם ציטוט',
      Pin: 'נעץ',
      Unpin: 'בטל נעיצה',
      'Copy Message': 'העתק הודעה',
      'Edit Message': 'ערוך הודעה',
      Edit: 'ערוך',
      'Delete message': 'מחק הודעה',
      Delete: 'מחק',
      'Mark as unread': 'סמן כלא נקרא',
      Flag: 'דווח',
      Mute: 'השתק',
      'Loading...': 'טוען...',
      'Connection failure, reconnecting now...': 'שגיאת חיבור, מתחבר...',
      'Error connecting to chat, refresh the page to try again.': 'שגיאה בחיבור, נסה לרענן.',
      '{{count}} unread_one': 'לא נקרא {{count}}',
      '{{count}} unread_other': 'לא נקראו {{count}}',
      'timestamp/MessageTimestamp':
        '{{ timestamp | timestampFormatter(calendar: false; format: HH:mm) }}',
      'timestamp/DateSeparator':
        '{{ timestamp | timestampFormatter(calendar: true; calendarFormats: { "sameDay": "[היום]", "nextDay": "[מחר]", "lastDay": "[אתמול]", "nextWeek": "DD/MM", "lastWeek": "DD/MM", "sameElse": "DD/MM/YYYY" }) }}',
      'timestamp/relativeToday': 'היום',
      'timestamp/relativeYesterday': 'אתמול',
    },
  });
}

export function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
