'use client';

import Link from 'next/link';
import './core.css';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import CoreRunnerBadge from '@/components/CoreRunnerBadge';
import { GoalRaceBanner } from '@/components/GoalRaceBanner';
import { ProfileCounts } from '@/components/profile/ProfileCounts';
import { SetupProgressCard } from '@/components/onboarding/SetupProgressCard';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import { HeroChip, ProfileHero } from '@/components/profile/ProfileHero';
import { MyWeekCard } from '@/components/profile/MyWeekCard';
import { profilePackChip } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// The owner's profile in two halves the page places apart: the header (hero,
// chips, counts, setup card) at the top, and the week (goal race + the day-by-day
// plan) inside the stats tab. Every value comes from an endpoint the app already
// serves; see the DESIGN SYSTEM block in tailwind.config.ts for the tokens.
// ═════════════════════════════════════════════════════════════════════════════

interface ReminderCfg {
  teamDays?: number[];
  workoutHour?: number;
}

export function ProfileOverview({
  athleteId,
  athleteName,
  avatarUrl,
  initials,
  uploadingPhoto,
  onPhotoClick,
  onOpenSetup,
  onFollowersClick,
  onFollowingClick,
  onEditProfile,
  part,
}: {
  athleteId: string;
  athleteName: string;
  avatarUrl: string | null;
  initials: string;
  uploadingPhoto: boolean;
  onPhotoClick: () => void;
  /** Opens the setup checklist. The card above it renders itself away for good
   *  once setup is done, so this is dead weight for most of the club's life. */
  onOpenSetup: () => void;
  onFollowersClick?: () => void;
  onFollowingClick?: () => void;
  /** The header's one action — opens personal info. */
  onEditProfile?: () => void;
  /**
   * Which half to draw (2026-10-17): `header` is the top of the profile — the
   * hero and, for a new member, the setup card; `week` is the week itself — the
   * goal race and "השבוע שלי" (MyWeekCard) — which opens the profile's
   * stats tab instead of the landing.
   */
  part: 'header' | 'week';
}) {
  const t = useTranslations('profile');

  // הגרעין — a flag, not a role (migration 091), so it has to be asked for; it
  // cannot be derived from anything already on this screen. Shares the SWR key
  // with the nav and Settings, so it costs no extra request.
  const { data: me } = useApi<{ isCoreRunner?: boolean }>('/api/auth/me');
  // The chips under the name — pack, academy band, coach — the same /public the
  // teammate page reads, so both headers say the same thing about the same person.
  const { data: pub } = useApi<{ groupName: string | null; isAcademy: boolean; academyBand: { name: string | null } | null; coachName: string | null }>(
    part === 'header' && athleteId ? `/api/athletes/${athleteId}/public` : null,
  );
  const isCore = me?.isCoreRunner === true;
  // The core runner's own perks summary — the badge's gender and the row's counts.
  const { data: core } = useApi<{ gender: string | null; perks: Array<{ tone: string | null }> }>(isCore && onEditProfile && part === 'header' ? '/api/perks/core' : null);
  const coreWord = core?.gender === 'female' ? 'רצת גרעין' : 'רץ גרעין';
  const coreNow = core?.perks.filter((p) => p.tone === 'now').length ?? 0;
  // Used for the mark beside the name and nothing else. There is deliberately no
  // perks row on this screen: the entitlement explains itself where the perks
  // actually are (Partnerships names the tier on the exclusive ones), so a
  // second entry point here was a signpost to a place the user was already going.

  const { data: reminder } = useApi<{ config?: ReminderCfg }>(part === 'week' ? '/api/reminder-config' : null);
  const teamDays = reminder?.config?.teamDays ?? [2, 5];
  const workoutHour = reminder?.config?.workoutHour ?? 18;

  const [photoOpen, setPhotoOpen] = useState(false);

  return (
    <div className="space-y-5">
      {part === 'header' && (
        <>
          <ProfileHero
            photo={
                    <div className="relative h-full w-full rounded-full">
                      {photoOpen && avatarUrl && (
                        <PhotoLightbox url={avatarUrl} alt={athleteName} onClose={() => setPhotoOpen(false)} />
                      )}
                      <button
                        type="button"
                        onClick={avatarUrl ? () => setPhotoOpen(true) : onPhotoClick}
                        className="block h-full w-full overflow-hidden rounded-full"
                        aria-label={avatarUrl ? t('viewPhoto') : t('changePhoto')}
                      >
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt={athleteName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-600 to-primary-500 text-2xl font-extrabold text-white">{initials}</span>
                        )}
                      </button>
                      {/* The frame draws a bare avatar, but this badge is the only way to
                          change a photo anywhere in the app — so it stays, smaller. It is a
                          real button now: when a photo exists the circle behind it enlarges
                          instead of uploading, so the badge has to carry the upload itself.

                          24px and not 20: the audit measured 20×20, under WCAG 2.5.8's floor.
                          It cannot reach Apple's 44 and that is geometry, not neglect — two
                          controls share a 55px circle, and a 44px halo on this one would
                          cover the avatar button's own centre point, so the bigger target
                          would break the target underneath it. 24 is the largest size that
                          leaves the circle behind it tappable. */}
                      <button
                        type="button"
                        onClick={onPhotoClick}
                        aria-label={t('changePhoto')}
                        className="absolute bottom-0.5 end-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-card shadow ring-2 ring-page"
                      >
                        {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <Camera className="h-3.5 w-3.5 text-ink-500" />}
                      </button>
                    </div>
            }
            name={athleteName}
            core={isCore && !!onEditProfile}
            nameAside={isCore && !onEditProfile ? <CoreRunnerBadge className="text-base" /> : undefined}
            chips={
              <>
                {/* C1 (10-21): Hebrew in the profile; English stays on the card itself. */}
                {isCore && onEditProfile && (
                  <Link href="/dashboard/core" className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-[#0c0c0d] py-1 pe-3 ps-1.5">
                    <span className="mc-core-shine" aria-hidden />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/logo.png" alt="" className="mc-core-emb h-[18px] w-[18px] object-contain" />
                    <span className="mc-core-foil text-[12.5px] font-black">{coreWord}</span>
                  </Link>
                )}
                {profilePackChip(pub?.groupName, pub?.isAcademy ? pub.academyBand?.name : null) && (
                  <HeroChip brand>{profilePackChip(pub?.groupName, pub?.isAcademy ? pub.academyBand?.name : null)}</HeroChip>
                )}
                {pub?.isAcademy && pub.academyBand?.name && (
                  // The academy band chip opens the academy, where its paces are.
                  <Link href="/dashboard/academy" className="contents"><HeroChip>{pub.academyBand.name}</HeroChip></Link>
                )}
                {pub?.isAcademy && pub.coachName && <HeroChip>{t('coachChip', { name: pub.coachName })}</HeroChip>}
              </>
            }
            counts={
              <ProfileCounts
                athleteId={athleteId}
                onFollowersClick={onFollowersClick}
                onFollowingClick={onFollowingClick}
              />
            }
            actions={
              onEditProfile ? (
                <button
                  type="button"
                  onClick={onEditProfile}
                  className="min-h-[44px] flex-1 rounded-xl bg-page/70 text-sm font-extrabold text-ink-900 active:bg-page"
                >
                  {t('editProfile')}
                </button>
              ) : undefined
            }
          />
          {/* ═══ הגרעין שלי ═══ — core runners only (mockup core-profile C1, 10-21). */}
          {isCore && onEditProfile && (
            <Link href="/dashboard/core" className="relative flex min-h-[64px] items-center gap-3 overflow-hidden rounded-[20px] bg-[#0c0c0d] px-4 py-3 text-white shadow-[0_14px_30px_-14px_rgba(122,92,18,0.8)] active:opacity-90">
              <span aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.02)_0_1px,transparent_1px_3px),radial-gradient(80%_140%_at_85%_50%,rgba(255,214,120,0.16),transparent_60%)]" />
              <span className="mc-core-shine" aria-hidden />
              <span className="relative min-w-0 flex-1">
                <span className="mc-core-foil block text-[11px] font-black">מדרגות · הגרעין</span>
                <b className="block text-[17px]">ההטבות שלי</b>
                <small className="block text-12 text-[#ffecbe]/70">{core ? `${core.perks.length} הטבות · ${coreNow} זמינות עכשיו` : 'הטבות לרצי הגרעין'}</small>
              </span>
              <span className="relative text-[20px] text-[#d6ab48]">‹</span>
            </Link>
          )}
          {/* ═══ SETUP PROGRESS — new members only, then gone for good ═══ */}
          <SetupProgressCard onOpen={onOpenSetup} />
        </>
      )}

      {part === 'week' && (
        <>
          {/* ═══ GOAL RACE ═══ — the same slim banner the feed opens with. */}
          <GoalRaceBanner />
          {/* ═══ השבוע שלי ═══ — the ring, where to be by tonight, the days, ten weeks, RSVP. */}
          <MyWeekCard athleteId={athleteId} owner athleteName={athleteName} teamDays={teamDays} workoutHour={workoutHour} />
        </>
      )}
    </div>
  );
}
