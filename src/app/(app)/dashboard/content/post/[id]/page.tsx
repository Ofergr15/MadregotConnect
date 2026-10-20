'use client';

import { use } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { postType, type PostResults, type PublishedPost } from '@/lib/content/hub';
import { Empty, Group, SectionHead, typeVars } from '@/components/content/hub-ui';
import { cn } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// One post's results (mockup content-v4, 3) — this post only, never a total:
// likes and who, the phones its push reached (when the app recorded it), a
// survey's votes, and who hasn't opened the app since it went up. There is no
// view count per post, so nothing here claims "saw".
// ═════════════════════════════════════════════════════════════════════════════

interface PostInfo { id: string; at: string; kind: PublishedPost['kind']; text: string; emoji: string; image: string | null; photos: number }

const BACK: Record<PublishedPost['kind'], { href: string; label: string }> = {
  photos: { href: '/dashboard/content/photos', label: 'תמונות' },
  message: { href: '/dashboard/content/messages', label: 'הודעות' },
  survey: { href: '/dashboard/content/surveys', label: 'סקרים' },
  cheer: { href: '/dashboard/content/cheers', label: 'ברכות' },
};

const FACE = ['#db2777', '#059669', '#7c3aed', '#d97706', '#0891b2', '#65a30d', '#dc2626', '#4f46e5'];
const faceColor = (id: string) => FACE[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % FACE.length];
const initial = (name: string) => name.trim().charAt(0) || '·';

export default function PostResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useApi<{ post: PostInfo; results: PostResults }>(`/api/admin/content/post?id=${encodeURIComponent(id)}`);
  if (error) return <p className="py-10 text-center text-sm text-ink-400">לא מצאתי את הפרסום.</p>;
  if (!data) return <p className="py-10 text-center text-sm text-ink-400">טוען…</p>;
  const { post, results: r } = data;
  const type = postType(post);
  const back = BACK[post.kind];
  const posted = new Date(post.at).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  return (
    <div style={typeVars(type)} className="pb-8" dir="rtl">
      <div className="flex h-11 items-center justify-between">
        <Link href={back.href} className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ {back.label}</Link>
        <Link href={`/feed?item=${post.id}`} className="inline-flex min-h-[44px] items-center text-[16px] text-[#007aff]">בפיד</Link>
      </div>

      {post.image ? (
        <div className="relative h-[200px] overflow-hidden rounded-[18px] bg-page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.image} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-45% to-black/60" />
          <div className="absolute inset-x-3.5 bottom-3 text-white">
            <b dir="auto" className="block text-[19px]">{post.text}</b>
            <small className="text-13 opacity-90">פורסם {posted}{post.photos ? ` · ${post.photos} תמונות` : ''}</small>
          </div>
        </div>
      ) : (
        <div className="rounded-[18px] px-4 py-3.5" style={{ background: 'var(--c2)' }}>
          <span aria-hidden className="text-2xl">{post.emoji}</span>
          <b dir="auto" className="mt-1 block text-[18px] leading-snug text-ink-900">{post.text}</b>
          <small className="text-13" style={{ color: 'var(--ci)' }}>פורסם {posted}</small>
        </div>
      )}

      <div className={cn('mt-2.5 grid gap-2', r.delivered != null && r.delivered > 0 ? 'grid-cols-3' : 'grid-cols-2')}>
        {r.votes ? <Stat n={String(r.answered ?? 0)} of={r.members} label="ענו" /> : <Stat n={String(r.likes)} label="לייקים" />}
        {r.delivered != null && r.delivered > 0 && <Stat n={String(Math.min(r.delivered, r.members || r.delivered))} of={r.members} label="קיבלו התראה" meter />}
        <Stat n={String(r.members - r.notSeen.length)} of={r.members} label="פתחו את האפליקציה מאז" meter />
      </div>

      {r.votes && (
        <>
          <SectionHead>ההצבעות</SectionHead>
          <Group>
            {r.votes.map((v) => (
              <div key={v.option} className="px-3.5 py-2.5">
                <div className="flex justify-between text-[14.5px]">
                  <span dir="auto" className={v.leading ? 'font-extrabold' : 'font-semibold'}>{v.option}{v.leading && <span className="text-12 font-bold" style={{ color: 'var(--c)' }}> · מוביל</span>}</span>
                  <span className="font-semibold text-ink-400"><bdi dir="ltr">{v.count}</bdi></span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eeeef2]">
                  <i className="block h-full rounded-full" style={{ width: `${r.answered ? (v.count / r.answered) * 100 : 0}%`, background: 'var(--c)' }} />
                </div>
              </div>
            ))}
          </Group>
        </>
      )}

      {!r.votes && (
        <>
          <SectionHead gray>מי אהב{r.likes ? ` · ${r.likes}` : ''}</SectionHead>
          <Group>
            {r.likers.length === 0 ? <Empty>עוד אף אחד.</Empty> : (
              <div className="flex items-center gap-2.5 px-3.5 py-3">
                <span className="flex">
                  {r.likers.slice(0, 6).map((l, i) => (
                    <i key={l.id} className={cn('grid h-[30px] w-[30px] place-items-center rounded-full border-2 border-white text-[11.5px] font-extrabold not-italic text-white', i > 0 && '-ms-2')} style={{ background: faceColor(l.id) }}>{initial(l.name)}</i>
                  ))}
                </span>
                <span dir="auto" className="min-w-0 flex-1 text-[14px] text-ink-900">
                  {r.likers.slice(0, 3).map((l) => l.name.split(' ')[0]).join(', ')}
                  {r.likers.length > 3 && <span className="text-ink-400"> ועוד {r.likers.length - 3}</span>}
                </span>
              </div>
            )}
          </Group>
        </>
      )}

      <SectionHead gray>לא פתחו את האפליקציה מאז{r.notSeen.length ? ` · ${r.notSeen.length}` : ''}</SectionHead>
      <Group>
        {r.notSeen.length === 0 ? <Empty>כולם פתחו את האפליקציה מאז שזה עלה.</Empty>
          : r.notSeen.slice(0, 12).map((m) => (
            <div key={m.id} className="flex min-h-[54px] items-center gap-3 px-3.5 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-extrabold text-white" style={{ background: faceColor(m.id) }}>{initial(m.name)}</span>
              <span className="min-w-0 flex-1">
                <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{m.name}</b>
                <small className="block text-13 text-ink-400">{m.lastSeenAt ? `נכנס/ה לאחרונה ${lastSeen(m.lastSeenAt)}` : 'עוד לא נכנס/ה לאפליקציה'}</small>
              </span>
            </div>
          ))}
      </Group>
    </div>
  );
}

function Stat({ n, of, label, meter }: { n: string; of?: number; label: string; meter?: boolean }) {
  const pct = of ? Math.min(100, (Number(n) / of) * 100) : 0;
  return (
    <div className="rounded-[14px] bg-card px-3 py-2.5">
      <b className="block text-[24px] font-extrabold leading-tight tracking-[-0.4px] text-ink-900"><bdi dir="ltr">{n}{of ? <small className="text-13 font-semibold text-ink-400">/{of}</small> : null}</bdi></b>
      <small className="block text-12 font-semibold leading-tight text-ink-400">{label}</small>
      {meter && of ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eeeef2]"><i className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--c)' }} /></div> : null}
    </div>
  );
}

function lastSeen(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `לפני ${days} ימים`;
}
