import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';

export const dynamic = 'force-dynamic';

// /api/admin/surveys/recurring — CRUD over recurring_survey_templates (migration 073),
// one row per weekday. Same gate as /api/admin/surveys: the verified session's
// canApprove; nothing in the body or query names the actor.
//
// NOTE: nothing sends these rows today — cron/tick stopped making the weekly pack poll
// on 2026-10-20 (oneDayBeforePush.test.ts pins that). This route only edits the table.

const TABLE = 'recurring_survey_templates';
const COLUMNS = 'id, day_of_week, question_he, question_en, options_he, options_en, active, updated_at';

const missingTable = (e: { code?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205');
const MISSING = () =>
  NextResponse.json({ error: 'recurring_survey_templates is missing — apply migration 073' }, { status: 503 });

type Patch = Partial<{
  day_of_week: number;
  question_he: string;
  question_en: string | null;
  options_he: string[];
  options_en: string[] | null;
  active: boolean;
}>;

/** Validates the editable fields present in `body`. `create` requires day + question + options. */
function parseTemplate(body: unknown, create: boolean): { patch: Patch } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const patch: Patch = {};
  if ('day_of_week' in b) {
    const d = b.day_of_week;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) return { error: 'day_of_week must be an integer 0–6' };
    patch.day_of_week = d;
  }
  if ('question_he' in b) {
    if (typeof b.question_he !== 'string' || !b.question_he.trim()) return { error: 'question_he must be a non-empty string' };
    patch.question_he = b.question_he.trim();
  }
  if ('question_en' in b) {
    if (b.question_en !== null && typeof b.question_en !== 'string') return { error: 'question_en must be a string or null' };
    patch.question_en = typeof b.question_en === 'string' && b.question_en.trim() ? b.question_en.trim() : null;
  }
  const opts = (v: unknown) => Array.isArray(v) && v.length >= 2 && v.every((s) => typeof s === 'string' && s.trim());
  if ('options_he' in b) {
    if (!opts(b.options_he)) return { error: 'options_he must be at least 2 non-empty strings' };
    patch.options_he = (b.options_he as string[]).map((s) => s.trim());
  }
  if ('options_en' in b) {
    if (b.options_en !== null && !opts(b.options_en)) return { error: 'options_en must be null or at least 2 non-empty strings' };
    patch.options_en = b.options_en === null ? null : (b.options_en as string[]).map((s) => s.trim());
  }
  if ('active' in b) {
    if (typeof b.active !== 'boolean') return { error: 'active must be a boolean' };
    patch.active = b.active;
  }
  const he = patch.options_he;
  const en = patch.options_en;
  if (he && en && he.length !== en.length) return { error: 'options_en must match options_he in length' };
  if (create) {
    if (patch.day_of_week === undefined) return { error: 'day_of_week is required' };
    if (!patch.question_he) return { error: 'question_he is required' };
    if (!patch.options_he) return { error: 'options_he is required' };
  } else if (Object.keys(patch).length === 0) {
    return { error: 'nothing to update' };
  }
  return { patch };
}

export async function GET(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;
    const { data, error } = await createServerClient().from(TABLE).select(COLUMNS).order('day_of_week', { ascending: true });
    if (missingTable(error)) return MISSING();
    if (error) return NextResponse.json({ error: 'Failed to list templates', details: error.message }, { status: 500 });
    return NextResponse.json({ templates: data ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;
    const parsed = parseTemplate(await request.json().catch(() => null), true);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { data, error } = await createServerClient()
      .from(TABLE)
      .insert({ active: true, ...parsed.patch })
      .select(COLUMNS)
      .single();
    if (missingTable(error)) return MISSING();
    if (error?.code === '23505') return NextResponse.json({ error: 'a template for that day already exists' }, { status: 409 });
    if (error) return NextResponse.json({ error: 'Failed to create template', details: error.message }, { status: 500 });
    return NextResponse.json({ template: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    const id = body && typeof body === 'object' ? (body as Record<string, unknown>).id : undefined;
    if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const rest = { ...(body as Record<string, unknown>) };
    delete rest.id;
    const parsed = parseTemplate(rest, false);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { data, error } = await createServerClient()
      .from(TABLE)
      .update({ ...parsed.patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();
    if (missingTable(error)) return MISSING();
    if (error?.code === '23505') return NextResponse.json({ error: 'a template for that day already exists' }, { status: 409 });
    if (error) return NextResponse.json({ error: 'Failed to update template', details: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ template: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { data, error } = await createServerClient().from(TABLE).delete().eq('id', id).select('id');
    if (missingTable(error)) return MISSING();
    if (error) return NextResponse.json({ error: 'Failed to delete template', details: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
