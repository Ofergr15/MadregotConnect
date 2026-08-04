import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// The Practice video library (leg workouts / drills). Coaches edit it live —
// the list is stored as JSON in app_settings key 'practice_videos', so a Drive
// file ID can be swapped in without a code deploy. Until a coach saves, GET
// returns DEFAULT below (the seed list). A `driveId` starting with
// 'PLACEHOLDER' renders a "coming soon" state in the UI.
export interface PracticeVideo {
  id: string;
  title: string;
  description: string;
  driveId: string;
  duration: string;
  category: string; // one of the category keys: Strength | Activation | Recovery | Power
}

const DEFAULT: PracticeVideo[] = [
  { id: '1', title: 'Leg Workout', description: 'Leg strengthening exercises for runners.', driveId: '1tIoIaxDizlgRsNL0H5VK5HdJ2Cw4YBlc', duration: '—', category: 'Strength' },
  { id: '2', title: 'Leg Strength - Squats & Lunges', description: 'Build running-specific leg strength with bodyweight squats, lunges, and single-leg exercises.', driveId: 'PLACEHOLDER_DRIVE_ID_2', duration: '12 min', category: 'Strength' },
  { id: '3', title: 'Calf Raises & Ankle Stability', description: 'Strengthen calves and improve ankle stability for better running form and injury prevention.', driveId: 'PLACEHOLDER_DRIVE_ID_3', duration: '8 min', category: 'Strength' },
  { id: '4', title: 'Hip & Glute Activation', description: 'Activate glutes and hip stabilizers. Essential for maintaining form during long runs.', driveId: 'PLACEHOLDER_DRIVE_ID_4', duration: '10 min', category: 'Activation' },
  { id: '5', title: 'Post-Run Recovery Stretch', description: 'Cool down routine targeting quads, hamstrings, hip flexors, and calves after a run.', driveId: 'PLACEHOLDER_DRIVE_ID_5', duration: '7 min', category: 'Recovery' },
  { id: '6', title: 'Plyometrics - Jump Training', description: 'Explosive jump exercises to build power and running speed. Box jumps, bounds, and hops.', driveId: 'PLACEHOLDER_DRIVE_ID_6', duration: '15 min', category: 'Power' },
];

const VALID_CATEGORIES = ['Strength', 'Activation', 'Recovery', 'Power'];

// Coerce arbitrary saved JSON into a clean PracticeVideo[] — never trust the
// stored blob's shape (a bad save shouldn't crash the Practice page).
function sanitize(list: unknown): PracticeVideo[] {
  if (!Array.isArray(list)) return DEFAULT;
  const clean = list
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v, i) => ({
      id: String(v.id ?? i + 1),
      title: String(v.title ?? '').slice(0, 200),
      description: String(v.description ?? '').slice(0, 1000),
      driveId: String(v.driveId ?? '').trim().slice(0, 200),
      duration: String(v.duration ?? '—').slice(0, 40),
      category: VALID_CATEGORIES.includes(String(v.category)) ? String(v.category) : 'Strength',
    }))
    .filter((v) => v.title);
  return clean.length ? clean : DEFAULT;
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'practice_videos').maybeSingle();
    let videos = DEFAULT;
    try {
      if (data?.value) videos = sanitize(JSON.parse(data.value));
    } catch { /* default */ }
    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json({ videos: DEFAULT });
  }
}

export async function PUT(request: Request) {
  try {
    const { videos, actorEmail } = await request.json();
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    const clean = sanitize(videos);
    const supabase = createServerClient();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'practice_videos', value: JSON.stringify(clean), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return NextResponse.json({ videos: clean });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
