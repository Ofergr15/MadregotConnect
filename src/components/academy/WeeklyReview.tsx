'use client';

import { useState } from 'react';
import { ListOrdered, Users } from 'lucide-react';
import { SegmentedControl } from '@/components/ui';
import { AcademyCompliance } from '@/components/AcademyCompliance';
import { WeeklyQueue } from '@/components/academy/WeeklyQueue';

// Two readings of one week, behind one tab rather than two.
//
// The queue and the compliance list hold the same data — the same twenty
// trainees, the same sessions, the same drill-down onto the same feedback form.
// The only difference is the ORDER and what a tap opens. Making them separate
// tabs would ask the mentor to choose between them before knowing what is in
// either, and the answer is always "the queue, unless I am looking for one
// specific person" — which is exactly what a toggle says and a tab pair doesn't.
//
// The queue is the default because it is the one that saves the evening.
type View = 'queue' | 'roster';

export function WeeklyReview() {
  const [view, setView] = useState<View>('queue');
  return (
    <div dir="rtl">
      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'queue', label: 'תור המשוב', icon: ListOrdered },
          { value: 'roster', label: 'לפי רוסטר', icon: Users },
        ]}
        className="mb-5"
      />
      {view === 'queue' ? <WeeklyQueue /> : <AcademyCompliance />}
    </div>
  );
}
