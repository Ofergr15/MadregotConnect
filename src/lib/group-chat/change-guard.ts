// Group chat edit/delete rules (task 181): a 15-minute window for the author, an audit row for
// every change, and no push for either. Kept out of logic.ts and the route body so the route only
// gains one guard call per verb.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { mayDelete, mayEdit, type ChatActor } from './logic';

/** How long the author may change their own message. WhatsApp's edit window is the model. */
export const CHAT_CHANGE_WINDOW_MS = 15 * 60_000;

export type ChatChange = 'edit' | 'delete';

export interface ChangeMessage {
  id?: string;
  text?: string | null;
  created_at?: string | Date | null;
  user?: { id?: string | null } | null;
}

/** True while the message is young enough for its author to change. No timestamp = closed. */
export function withinChangeWindow(createdAt: string | Date | null | undefined, now: number): boolean {
  if (!createdAt) return false;
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return now - t <= CHAT_CHANGE_WINDOW_MS;
}

/**
 * Who may make this change, and under which hat:
 * - 'author' — their own message, inside the window (edit or delete);
 * - 'staff'  — delete only, any age (moderation's "delete for everyone");
 * - null     — refused. `late` says the only reason was the window, so the client can say so.
 */
export function changeRight(
  actor: ChatActor, action: ChatChange, authorId: string | null | undefined, createdAt: ChangeMessage['created_at'], now: number,
): { as: 'author' | 'staff' | null; late: boolean } {
  const own = mayEdit(actor, authorId);
  const fresh = withinChangeWindow(createdAt, now);
  if (own && fresh) return { as: 'author', late: false };
  if (action === 'delete' && mayDelete(actor, authorId) && (actor.isStaff || actor.isSuperUser)) return { as: 'staff', late: false };
  return { as: null, late: own && !fresh };
}

export interface ChatAuditRow {
  group_id: string;
  message_id: string;
  action: ChatChange;
  actor_athlete_id: string | null;
  actor_as: 'author' | 'staff';
  author_athlete_id: string | null;
  old_text: string | null;
  new_text: string | null;
}

/**
 * Checks the right to change, then writes the audit row (migration 346) BEFORE the Stream call,
 * so no change can land unrecorded. Returns a response to send back when refused, else null.
 *
 * Before 346 is applied the table is missing: the change still goes through (with a warning)
 * rather than breaking edit/delete for everyone. Any other audit failure refuses the change.
 */
export async function guardChatChange(
  db: SupabaseClient,
  input: { actor: ChatActor; action: ChatChange; groupId: string; message: ChangeMessage; newText?: string | null; now?: number },
): Promise<NextResponse | null> {
  const { actor, action, groupId, message } = input;
  const authorId = message.user?.id ?? null;
  const right = changeRight(actor, action, authorId, message.created_at, input.now ?? Date.now());
  if (!right.as) {
    return right.late
      ? NextResponse.json({ error: 'edit window closed', code: 'change_window_closed', windowMinutes: CHAT_CHANGE_WINDOW_MS / 60_000 }, { status: 403 })
      : NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const row: ChatAuditRow = {
    group_id: groupId,
    message_id: String(message.id ?? ''),
    action,
    actor_athlete_id: actor.athleteId,
    actor_as: right.as,
    author_athlete_id: authorId,
    old_text: message.text ?? null,
    new_text: action === 'edit' ? (input.newText ?? null) : null,
  };
  const { error } = await db.from('group_chat_message_audit').insert(row);
  if (error) {
    if (isMissingTable(error)) {
      console.warn('group chat audit: migration 346 not applied — change not audited');
      return null;
    }
    console.error('group chat audit insert failed:', error.message);
    return NextResponse.json({ error: 'audit failed' }, { status: 500 });
  }
  return null;
}
