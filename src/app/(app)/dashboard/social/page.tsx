import { redirect } from 'next/navigation';

// Social (10-18) folded into the Content hub as "תוכן › תמונות" (Content v4, Ofer
// 10-20: "why a new Social tab — we already have Content"). Old links and pushes
// still land here; they go on to the photos page.
export default function SocialPage() {
  redirect('/dashboard/content/photos');
}
