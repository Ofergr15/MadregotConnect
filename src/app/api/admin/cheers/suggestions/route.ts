import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { cheerSuggestions } from '@/lib/publish/server';

export const dynamic = 'force-dynamic';

// GET -> { suggestions: [{ athleteId, name, reason, detail, line, at }] }
// Personal records and races from the last three days, for the cheer composer's "למי".
export async function GET(request: Request) {
  const { denied } = await requireApprover(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ suggestions: await cheerSuggestions(createServerClient()) });
  } catch (err) {
    console.error('[cheers/suggestions] failed:', err);
    return NextResponse.json({ suggestions: [] });
  }
}
