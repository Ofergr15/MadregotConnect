import { redirect } from 'next/navigation';

/**
 * Short link for the feed.
 *
 * The page itself lives under /dashboard/feed so it inherits the dashboard
 * chrome (header, bottom tab bar, maintenance gate). This exists purely so
 * `/feed` is typeable and shareable — the club will say "go to /feed", not
 * "/dashboard/feed".
 */
export default function FeedShortcut() {
  redirect('/dashboard/feed');
}
