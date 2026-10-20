'use client';

import { bearerHeaders } from '@/lib/auth/bearer-headers';

// The week's training PDF from the planner (Ofer, 2026-10-20). A PDF uploaded there
// was only ever READ — parsed into the in-app plan — and never stored, so the week of
// 18.10 had a plan in the app and no PDF for anyone to open. Now the planner hands the
// same file to the program upload (POST /api/program-weeks) when the week has none.

interface WeekRow { week_number: number; week_start_date: string; training_pdf_url: string | null }

/** The week's number: its own row's, else one after the last week before it. */
export function weekNumberFor(rows: WeekRow[], weekStart: string): number {
  const own = rows.find((r) => r.week_start_date === weekStart);
  if (own?.week_number) return own.week_number;
  const before = rows.filter((r) => r.week_start_date < weekStart && r.week_number > 0)
    .sort((a, b) => b.week_start_date.localeCompare(a.week_start_date))[0];
  return before ? before.week_number + 1 : 1;
}

export const isPdf = (f: File | null | undefined): f is File =>
  !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));

/**
 * Store `file` as the training PDF of `weekStart` unless the week already has one —
 * a PDF the coach uploaded on the program page is theirs to replace, not the parser's.
 * Returns the PDF's URL when it stored one. Best-effort: the plan is already saved.
 */
export async function storeWeekTrainingPdf(file: File, weekStart: string): Promise<string | null> {
  try {
    const rows = await fetch('/api/program-weeks').then((r) => (r.ok ? r.json() : [])) as WeekRow[];
    if (rows.find((r) => r.week_start_date === weekStart)?.training_pdf_url) return null;
    const fd = new FormData();
    fd.append('week_number', String(weekNumberFor(rows, weekStart)));
    fd.append('week_start_date', weekStart);
    fd.append('training_pdf', file);
    const res = await fetch('/api/program-weeks', { method: 'POST', headers: await bearerHeaders(false), body: fd });
    if (!res.ok) return null;
    const row = (await res.json()) as Partial<WeekRow>;
    return row.training_pdf_url ?? null;
  } catch {
    return null;
  }
}
