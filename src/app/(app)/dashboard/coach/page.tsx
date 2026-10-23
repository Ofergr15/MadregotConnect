import { redirect } from 'next/navigation';

// /dashboard/coach has no screen of its own: its first tab is היום.
export default function CoachSpaceIndex() {
  redirect('/dashboard/coach/today');
}
