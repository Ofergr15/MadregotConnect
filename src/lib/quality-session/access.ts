// Who may open the quality session: the super user, and anyone with the
// "אינסטגרם" switch on the roles screen (`athletes.is_story_editor`, migration
// 129). It is a person, not a page in the permission matrix, because admins skip
// the matrix and the screen lists every runner's name and laps for the morning.
//
// Server only. Before 129 is pasted the column is missing, and a missing column
// reads as nobody: nothing changes until it is there.

import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

export async function isStoryEditor(supabase: Db, athleteId: string | null | undefined): Promise<boolean> {
  if (!athleteId) return false;
  const { data, error } = await supabase.from('athletes').select('is_story_editor').eq('id', athleteId).maybeSingle();
  return !error && (data as { is_story_editor?: boolean } | null)?.is_story_editor === true;
}

/** Everyone with the switch on; null when the column is not there yet (no 129). */
export async function storyEditorIds(supabase: Db): Promise<string[] | null> {
  const { data, error } = await supabase.from('athletes').select('id').eq('is_story_editor', true);
  if (error) return null;
  return ((data || []) as Array<{ id: string }>).map(a => a.id);
}
