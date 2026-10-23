'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Award, Bell, CalendarDays, Radio, Sparkles, Trophy } from 'lucide-react';
import { InsetRow, InsetSection, Sheet } from '@/components/ui';
import { israelDateOf } from '@/lib/reports/last-7-days';
import {
  CONTENT_TYPES, cheerWaiting, photosWaiting, postsOf, resultChips, shortDay, surveyWaiting, TYPE_ORDER,
  type ContentType,
} from '@/lib/content/hub';
import { LastLine, TypeBlock, TypeIcon, WaitRow } from '@/components/content/hub-ui';
import { ShareBlock, useShareDays } from '@/components/content/share-ui';
import { useContentLevels } from '@/components/content/use-hub';
import { StoriesHome } from '@/components/content/StoriesHome';
import { FolderLinks } from '@/components/content/FolderLinks';
import { useApi } from '@/lib/api';
import { useCheerSuggestions, useHubContent, useLive, usePhotosStatus } from '@/components/content/use-hub';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן — v4 (mockup ~/.cache/madregot/mockups/content-hub-v2/content-v4.html, Ofer
// 10-20: "a real mess — what belongs to photos, what to surveys"). One block per
// kind, each in its own colour. What waits for you sits INSIDE its kind's block,
// with one button; the block's last line is that kind's newest post with ITS OWN
// numbers. No shared queue, no mixed calendar. Social folded in as "תמונות".
// The rest of what the hub used to list (challenges, badges, events, …) is at the
// bottom, unchanged.
// ═════════════════════════════════════════════════════════════════════════════

const NEW_CHOICES: Array<{ type: ContentType; title: string; sub: string; href: string }> = [
  { type: 'messages', title: 'הודעה', sub: 'לפיד, עם או בלי התראה', href: '/dashboard/content/publish?type=message' },
  { type: 'photos', title: 'תיקיית תמונות', sub: 'עכשיו, או ביום ושעה', href: '/dashboard/content/photos?new=1' },
  { type: 'surveys', title: 'סקר', sub: 'שאלה עם תשובות', href: '/dashboard/content/publish?type=survey' },
  { type: 'cheers', title: 'ברכה', sub: 'מרתון, שיא, יום הולדת', href: '/dashboard/content/publish?type=cheer' },
  { type: 'circle', title: 'עיגול מדרגות', sub: 'בראש הפיד, בשקט', href: '/dashboard/content/publish?type=message&place=circle' },
];

export default function ContentPage() {
  const t = useTranslations('contentHub');
  const { data } = useHubContent();
  const { data: live } = useLive();
  const { data: photos } = usePhotosStatus();
  // The folders the tick opened, polled so a new one appears without a refresh (10-23).
  const { data: folders } = useApi<{ made?: Array<{ date: string; name: string; link: string; createdAt?: string }> }>('/api/social/folders', { refreshInterval: 30_000 });
  const { data: sug } = useCheerSuggestions();
  const [adding, setAdding] = useState(false);
  const { levels, full } = useContentLevels();
  // "＋ חדש" offers only the parts this account publishes in.
  const choices = NEW_CHOICES.filter((c) => !levels || (levels[c.type] ?? 0) >= 3);

  const today = data?.today ?? live?.today ?? '';
  const members = data?.members ?? 0;
  const posts = data?.recent ?? [];
  const items = live?.items ?? [];
  const newest = (type: ContentType) => postsOf(posts, type)[0];

  const waiting = {
    photos: photosWaiting(photos?.status),
    surveys: surveyWaiting(items.filter((r) => r.source === 'survey').map((r) => ({ id: r.id, title: r.title, until: r.until, answers: r.answers ?? 0 })), members, today),
    cheers: cheerWaiting(sug?.suggestions ?? []),
  };
  const { data: share } = useShareDays();
  const count = [share?.today, waiting.photos, waiting.surveys, waiting.cheers].filter(Boolean).length;
  const onAir = (source: 'feed' | 'club' | 'scheduled') => items.filter((r) => r.source === source && r.active);

  const block = (type: ContentType) => {
    // Only the parts this account was given (הרשאות); staff see all, as before.
    if (levels && (levels[type] ?? 0) < 1) return null;
    if (type === 'share') return <ShareBlock key={type} />;
    const last = newest(type);
    const lastLine = last && <LastLine label="אחרון" title={last.text} chips={resultChips(last, members).slice(0, 2)} href={`/dashboard/content/post/${last.id}`} />;
    switch (type) {
      case 'photos': {
        const w = waiting.photos;
        return (
          <TypeBlock key={type} type={type}>
            {w && w.type === 'photos' && <WaitRow kicker={w.sub} title={w.title} thumb={w.previews[0]} action="לפרסם" href="/dashboard/content/photos?publish=1" />}
            {/* Today's and tomorrow's folder, once open: straight to Drive, or its link. */}
            {(folders?.made ?? []).filter((f) => f.link && f.date >= today).slice(0, 2).map((f) => (
              <div key={f.date} className="mx-2.5 mb-2 flex min-h-[48px] items-center gap-2.5 rounded-[13px] bg-page/70 px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-extrabold text-[#a3410a]">התיקייה נפתחה</span>
                  <span dir="auto" className="block truncate text-[14px] font-semibold text-ink-900">{f.name}</span>
                </span>
                <FolderLinks link={f.link} name={f.name} />
              </div>
            ))}
            {lastLine}
          </TypeBlock>
        );
      }
      case 'messages': {
        const queued = onAir('scheduled')[0];
        return (
          <TypeBlock key={type} type={type}>
            {queued && <LastLine first={!lastLine} label="מתוזמן" title={`${queued.title} · ${atLabel(queued.at)}`} href="/dashboard/content/messages" />}
            {lastLine}
          </TypeBlock>
        );
      }
      case 'surveys': {
        const w = waiting.surveys;
        return (
          <TypeBlock key={type} type={type}>
            {w && w.type === 'surveys' && <WaitRow kicker={w.sub} title={w.title} action="לפתוח" href="/dashboard/content/surveys" />}
            {lastLine}
          </TypeBlock>
        );
      }
      case 'cheers': {
        const w = waiting.cheers;
        const now = onAir('feed')[0];
        return (
          <TypeBlock key={type} type={type}>
            {w && w.type === 'cheers' && <WaitRow kicker={w.sub} title={w.title} action="לאשר" href={`/dashboard/content/publish?type=cheer&athlete=${w.athleteId}`} />}
            {now ? <LastLine label="באוויר" title={now.title} chips={now.likes ? [{ key: 'likes', text: String(now.likes) }] : undefined} href="/dashboard/content/cheers" /> : lastLine}
          </TypeBlock>
        );
      }
      case 'circle': {
        const now = onAir('club')[0];
        return (
          <TypeBlock key={type} type={type}>
            {now
              ? <LastLine first label="באוויר" title={now.title} href="/dashboard/content/circle" />
              : <LastLine first label="באוויר" title="אין כרגע · להוסיף" href="/dashboard/content/publish?type=message&place=circle" />}
          </TypeBlock>
        );
      }
    }
  };

  const active = (data?.challenges ?? []).filter((c) => c.phase === 'active').length;
  const scheduled = (data?.challenges ?? []).filter((c) => c.phase === 'scheduled').length;

  return (
    <div className="space-y-2.5 pb-8" dir="rtl">
      <div className="flex items-center justify-between px-0.5 pt-1">
        <h1 className="text-[34px] font-extrabold leading-tight tracking-[-0.4px] text-ink-900">{t('title')}</h1>
        {choices.length > 0 && <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-[38px] items-center rounded-full bg-ink-900 px-3.5 text-[14px] font-bold text-white">＋ חדש</button>}
      </div>
      <div className="px-0.5">
        <p className="pb-2 text-[14px] text-ink-400">
          {today ? dayTitle(today) : ''}{data && live ? (count ? ` · ${count === 1 ? 'דבר אחד מחכה לך' : `${count} דברים מחכים לך`}` : ' · אין משהו שמחכה לך') : ''}
        </p>
      </div>

      {today && full && <StoriesHome live={items} today={today} />}

      {TYPE_ORDER.map(block)}

      {full && <InsetSection header="עוד בתוכן" className="pt-3">
        <InsetRow icon={Trophy} iconBg="bg-[#F5B83D]" label={t('challenges')}
          sublabel={data ? (active || scheduled ? `${active} פעילים${scheduled ? ` · ${scheduled} מתוכננים` : ''}` : 'אין פעילים') : undefined}
          href="/dashboard/settings?tab=challenges" />
        <InsetRow icon={CalendarDays} iconBg="bg-accent-900" label={t('events')}
          sublabel={data?.events[0] ? t('eventsNext', { name: data.events[0].name, date: shortDay(data.events[0].date) }) : data ? t('eventsNone') : undefined}
          href="/dashboard/calendar" />
        <InsetRow icon={Award} iconBg="bg-fuchsia-500" label={t('badges')}
          sublabel={data ? t('badgesSub', { n: data.badges.active, w: data.badges.awardedThisWeek }) : undefined}
          href="/dashboard/settings?tab=badges" />
        <InsetRow icon={Bell} iconBg="bg-accent-red" label={t('notifications')}
          sublabel={data?.lastNotification
            ? t('notificationsSub', { date: shortDay(israelDateOf(data.lastNotification.sentAt)), n: data.lastNotification.reached })
            : data ? t('notificationsNone') : undefined}
          href="/dashboard/settings?tab=notifications" />
        <InsetRow icon={Radio} iconBg="bg-[#FF5315]" label={t('clubUpdates')} sublabel={t('clubUpdatesSub')} href="/dashboard/club-updates" />
        <InsetRow icon={Sparkles} iconBg="bg-brand-600" label={t('whatsNew')}
          sublabel={data?.latestNote ? t('whatsNewSub', { title: data.latestNote.title }) : undefined} href="/dashboard/whats-new" />
      </InsetSection>}

      <Sheet open={adding} onOpenChange={setAdding} title="מה לפרסם?">
        <div className="space-y-2 px-4 pb-6" dir="rtl">
          {choices.map((c) => (
            <Link key={c.type} href={c.href} onClick={() => setAdding(false)} className="flex min-h-[60px] items-center gap-3 rounded-[16px] bg-page px-3.5 py-2.5 active:opacity-70">
              <TypeIcon type={c.type} size={38} />
              <span className="min-w-0 flex-1">
                <b className="block text-[16px] text-ink-900">{c.title}</b>
                <small className="block text-13 text-ink-400">{c.sub}</small>
              </span>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CONTENT_TYPES[c.type].color }} />
            </Link>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

const DAY_NAME = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function dayTitle(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAY_NAME[d.getUTCDay()]} ${shortDay(day)}`;
}
function atLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  return `${DAY_NAME[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${time}`;
}
