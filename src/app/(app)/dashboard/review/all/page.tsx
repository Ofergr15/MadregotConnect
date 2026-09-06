'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { FeedbackAdmin } from '@/components/FeedbackAdmin';

/**
 * The staff inbox for everything filed from /dashboard/review.
 *
 * It used to exist only as a tab inside Settings, behind a grid of eleven
 * management screens — reachable, but not somewhere anybody goes, and it showed:
 * every report in prod was still `status = 'new'`. This is the same component,
 * given a destination of its own, sitting directly under the review screen so
 * the two halves of the loop (file a report / read the reports) are neighbours.
 * Settings' Feedback tab renders the same component, so every existing link
 * there still works — one implementation, two entry points.
 *
 * Staff-only, enforced where it counts: every read and write goes through
 * /api/feedback, which calls requireStaff. A non-staff account that guesses this
 * URL gets an empty list, not hidden-but-fetchable data.
 */
export default function AllReportsPage() {
  const t = useTranslations('settings');
  const tr = useTranslations('review');

  return (
    <div className="mx-auto max-w-2xl" dir="rtl">
      <div className="mb-4">
        <Link href="/dashboard/review" className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-brand-600">
          <ChevronRight className="h-3.5 w-3.5" />
          {tr('title')}
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-700">{t('feedbackInbox')}</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">{t('feedbackInboxSubtitle')}</p>
      </div>
      <FeedbackAdmin />
    </div>
  );
}
