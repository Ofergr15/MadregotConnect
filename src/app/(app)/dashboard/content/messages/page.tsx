'use client';

import { postsOf } from '@/lib/content/hub';
import { Empty, Group, PlusButton, PublishedRow, SectionHead, TypePage } from '@/components/content/hub-ui';
import { useHubContent, useLive } from '@/components/content/use-hub';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › הודעות (mockup content-v4, the same template): what is waiting to go out
// and what went out, each message with its own likes and the phones it reached.
// ═════════════════════════════════════════════════════════════════════════════

export default function ContentMessagesPage() {
  const { data: hub } = useHubContent();
  const { data: live } = useLive();
  const queued = (live?.items ?? []).filter((r) => r.source === 'scheduled');
  const posts = postsOf(hub?.recent ?? [], 'messages');
  const members = hub?.members ?? 0;
  return (
    <TypePage type="messages" action={<PlusButton label="הודעה" href="/dashboard/content/publish?type=message" />}>
      {queued.length > 0 && (
        <>
          <SectionHead>מתוזמן</SectionHead>
          <Group>
            {queued.map((q) => (
              <div key={q.id} className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] text-lg" style={{ background: 'var(--c2)' }}>⏰</span>
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{q.title}</b>
                  <small className="block text-13 text-ink-400">יוצאת {when(q.at)}</small>
                </span>
              </div>
            ))}
          </Group>
        </>
      )}
      <SectionHead gray>פורסם · התוצאות של כל אחת</SectionHead>
      <Group>
        {!hub ? <Empty>טוען…</Empty> : posts.length === 0 ? <Empty>עוד לא פורסמה הודעה.</Empty>
          : posts.map((p) => <PublishedRow key={p.id} post={p} members={members} />)}
      </Group>
    </TypePage>
  );
}

function when(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
}
