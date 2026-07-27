import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('program_weeks')
    .select('*')
    .order('week_start_date', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient();
  const formData = await request.formData();

  const weekNumber = Number(formData.get('week_number'));
  const rawStartDate = formData.get('week_start_date') as string;
  const trainingFile = formData.get('training_pdf') as File | null;
  const nutritionFile = formData.get('nutrition_pdf') as File | null;

  if (!weekNumber || !rawStartDate) {
    return NextResponse.json(
      { error: 'Missing required fields: week_number, week_start_date' },
      { status: 400 }
    );
  }

  // The program is always Sunday → Saturday. Snap the given date back to its
  // week's Sunday and derive the range server-side, so the stored row can never
  // be reversed or start on a non-Sunday (which produced a bad duplicate week
  // before). The client-supplied date_range, if any, is ignored.
  const picked = new Date(rawStartDate + 'T00:00:00');
  if (isNaN(picked.getTime())) {
    return NextResponse.json({ error: 'Invalid week_start_date' }, { status: 400 });
  }
  const sunday = new Date(picked);
  sunday.setDate(picked.getDate() - picked.getDay()); // getDay(): 0 = Sunday
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekStartDate = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const dateRange = `${pad(sunday.getDate())}.${pad(sunday.getMonth() + 1)} – ${pad(saturday.getDate())}.${pad(saturday.getMonth() + 1)}`;

  let trainingUrl: string | null = null;
  let nutritionUrl: string | null = null;

  if (trainingFile && trainingFile.size > 0) {
    const buffer = Buffer.from(await trainingFile.arrayBuffer());
    const path = `training-program/week-${weekStartDate}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('program-plans')
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: `Training upload failed: ${uploadError.message}` }, { status: 500 });
    }
    const { data: urlData } = supabase.storage.from('program-plans').getPublicUrl(path);
    trainingUrl = urlData.publicUrl;
  }

  if (nutritionFile && nutritionFile.size > 0) {
    const buffer = Buffer.from(await nutritionFile.arrayBuffer());
    const path = `nutrition-plan/week-${weekStartDate}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('program-plans')
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: `Nutrition upload failed: ${uploadError.message}` }, { status: 500 });
    }
    const { data: urlData } = supabase.storage.from('program-plans').getPublicUrl(path);
    nutritionUrl = urlData.publicUrl;
  }

  const { data, error } = await supabase
    .from('program_weeks')
    .upsert({
      week_number: weekNumber,
      date_range: dateRange,
      week_start_date: weekStartDate,
      training_pdf_url: trainingUrl,
      nutrition_pdf_url: nutritionUrl,
    }, { onConflict: 'week_start_date' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
