/**
 * Create a run's chat row, or take the one a concurrent request just created.
 *
 * `run_chats` is UNIQUE(activity_id) (migration 049). The route reads first and
 * inserts only when nothing is there, so two opens of the same run at once (a double
 * tap, phone + laptop) both saw "no chat" and the second insert hit 23505 → a 500.
 * The constraint already kept exactly one row; this re-reads it instead of failing.
 */
type Result<T> = { data: T | null; error: { code?: string; message?: string } | null };
interface RunChatDb {
  from(table: 'run_chats'): {
    insert(row: Record<string, unknown>): { select(cols: string): { single(): PromiseLike<Result<Record<string, unknown>>> } };
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<Result<Record<string, unknown>>> } };
  };
}

export async function insertRunChatOnce<T = Record<string, unknown>>(
  db: unknown,
  row: { activity_id: string } & Record<string, unknown>,
): Promise<T> {
  const d = db as RunChatDb;
  const { data: created, error } = await d.from('run_chats').insert(row).select('*').single();
  if (!error) return created as T;
  if (error.code !== '23505') throw error;
  const { data: raced, error: reReadErr } = await d.from('run_chats').select('*').eq('activity_id', row.activity_id).maybeSingle();
  if (reReadErr || !raced) throw error;
  return raced as T;
}
