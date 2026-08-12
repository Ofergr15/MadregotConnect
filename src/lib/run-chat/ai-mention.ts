import { AI_USER_ID } from '@/lib/stream/constants';

/** True if a Stream message is addressing the AI coach. */
export function messageMentionsAi(message: {
  text?: string | null;
  mentioned_users?: Array<{ id?: string } | string> | null;
  user?: { id?: string } | null;
} | null | undefined): boolean {
  if (!message) return false;
  if (message.user?.id === AI_USER_ID) return false;

  const mentioned = message.mentioned_users || [];
  for (const u of mentioned) {
    const id = typeof u === 'string' ? u : u?.id;
    if (id === AI_USER_ID) return true;
  }

  const text = message.text || '';
  // Literal id, Hebrew display name, or common shorthand
  return /@aicoach\b/i.test(text) || /@מאמן\s*AI\b/i.test(text) || /@ai\b/i.test(text);
}
