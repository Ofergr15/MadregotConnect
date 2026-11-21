import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { jobView } from '@/lib/plan-builder/server';
import { fail, staff } from '@/lib/plan-builder/route-helpers';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/** GET → { id, status, stage, elapsedSec, result, error } */
export async function GET(req: NextRequest, { params }: P) {
  const { denied } = await staff(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const { data, error } = await createServerClient().from('plan_parse_jobs').select('*').eq('id', id).maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(jobView(data));
  } catch (e) { return fail(e, 'parse job read failed'); }
}

/** DELETE → cancel. The model call can't be aborted mid-flight; its result is discarded. */
export async function DELETE(req: NextRequest, { params }: P) {
  const { denied } = await staff(req);
  if (denied) return denied;
  const { id } = await params;
  await createServerClient().from('plan_parse_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).in('status', ['queued', 'running']);
  return NextResponse.json({ ok: true });
}
