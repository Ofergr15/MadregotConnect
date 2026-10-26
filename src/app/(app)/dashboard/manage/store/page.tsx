'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { StoreAdminSection } from '@/components/podium/StoreAdminSection';

/** ניהול → חנות: every store, each with its status and audience; Podium opens its own screen (Ofer 10-26). */
export default function ManageStorePage() {
  return (
    <div className="pb-8" dir="rtl">
      <Link href="/dashboard/coach-tools" className="inline-flex min-h-[44px] items-center gap-1 px-1 text-[16px] text-brand-600">
        <ChevronRight className="h-4 w-4" />ניהול
      </Link>
      <h1 className="px-1 pb-4 text-[30px] font-black tracking-tight text-ink-700">חנות</h1>
      <StoreAdminSection header={null} />
    </div>
  );
}
