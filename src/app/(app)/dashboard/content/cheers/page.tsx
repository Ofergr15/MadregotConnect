'use client';

import Link from 'next/link';
import { postsOf, shortDay } from '@/lib/content/hub';
import { Chips, Empty, Group, PlusButton, PublishedRow, SectionHead, TypePage } from '@/components/content/hub-ui';
import { useCheerSuggestions, useHubContent, useLive } from '@/components/content/use-hub';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › ברכות (mockup content-v4, the same template): the cheers the records and
// races suggest (מחכה לך), what is on the circles now and until when, and the
// cheers posted, each with its own likes.
// ═════════════════════════════════════════════════════════════════════════════

export default function ContentCheersPage() {
  const { data: hub } = useHubContent();
  const { data: live } = useLive();
  const { data: sug } = useCheerSuggestions();
  const suggestions = sug?.suggestions ?? [];
  const onAir = (live?.items ?? []).filter((r) => r.source === 'feed' && r.active);
  const posts = postsOf(hub?.recent ?? [], 'cheers');
  const members = hub?.members ?? 0;
  return (
    <TypePage type="cheers" action={<PlusButton label="ברכה" href="/dashboard/content/publish?type=cheer" />}>
      {suggestions.length > 0 && (
        <>
          <SectionHead>מחכה לך · ברכות מוצעות</SectionHead>
          <Group>
            {suggestions.map((s) => (
              <div key={`${s.athleteId}:${s.detail}`} className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{s.name}</b>
                  <small dir="auto" className="block truncate text-13 text-ink-400">{s.line}</small>
                </span>
                <Link href={`/dashboard/content/publish?type=cheer&athlete=${s.athleteId}`} className="inline-flex min-h-[36px] shrink-0 items-center rounded-full px-[13px] text-[13px] font-bold text-white" style={{ background: 'var(--c)' }}>לאשר</Link>
              </div>
            ))}
          </Group>
        </>
      )}
      {onAir.length > 0 && (
        <>
          <SectionHead trailing={<Link href="/dashboard/content/celebrations" className="-my-3 inline-flex min-h-[44px] items-center text-13 font-semibold text-[#007aff]">לנהל ‹</Link>}>באוויר · בעיגולים</SectionHead>
          <Group>
            {onAir.map((r) => (
              <div key={r.id} className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-page text-lg">{r.emoji}</span>
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{r.title}</b>
                  <small className="block text-13 text-ink-400">{r.label}{r.auto ? ' · אוטומטי' : ''} · עד {r.until === live?.today ? 'היום' : shortDay(r.until)}</small>
                </span>
                {r.likes > 0 && <Chips chips={[{ key: 'likes', text: String(r.likes) }]} />}
              </div>
            ))}
          </Group>
        </>
      )}
      <SectionHead gray>פורסם · התוצאות של כל אחת</SectionHead>
      <Group>
        {!hub ? <Empty>טוען…</Empty> : posts.length === 0 ? <Empty>עוד לא פורסמה ברכה.</Empty>
          : posts.map((p) => <PublishedRow key={p.id} post={p} members={members} />)}
      </Group>
    </TypePage>
  );
}
