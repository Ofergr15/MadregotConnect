'use client';

import { use } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { InsetRow, InsetSection } from '@/components/ui';
import { MANAGE_GROUPS } from '@/lib/admin/manage-groups';

/** One of ניהול's grouped rows, opened: the places it holds (lib/admin/manage-groups). */
export default function ManageGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = use(params);
  const g = MANAGE_GROUPS.find((x) => x.key === group);
  return (
    <div className="pb-8" dir="rtl">
      <Link href="/dashboard/coach-tools" className="inline-flex min-h-[44px] items-center gap-1 px-1 text-[16px] text-brand-600">
        <ChevronRight className="h-4 w-4" />ניהול
      </Link>
      <h1 className="px-1 pb-4 text-[30px] font-black tracking-tight text-ink-700">{g?.title ?? 'ניהול'}</h1>
      {g && (
        <InsetSection>
          {g.items.map((i) => <InsetRow key={i.href} label={i.label} sublabel={i.sub} href={i.href} />)}
        </InsetSection>
      )}
    </div>
  );
}
