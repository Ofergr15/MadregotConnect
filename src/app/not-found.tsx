import { getTranslations } from 'next-intl/server';
import { JourneyCard, JourneyHero, JourneyScreen, PrimaryButton } from '@/components/onboarding/journey-ui';

/**
 * Every unmatched URL lands here (root not-found). Without it Next served its own
 * English "This page could not be found." with no chrome and no way back.
 * Drawn with the joining-journey kit so it looks like the rest of the app, with
 * one action: back to the feed (which bounces signed-out visitors to login).
 */
export default async function NotFound() {
  const t = await getTranslations('notFoundPage');
  return (
    <JourneyScreen
      testId="not-found"
      hero={<JourneyHero eyebrow={<bdi dir="ltr">404</bdi>} title={t('title')} subtitle={t('subtitle')} />}
      actions={<PrimaryButton href="/feed">{t('back')}</PrimaryButton>}
    >
      <JourneyCard className="text-center text-[15px] leading-relaxed">{t('body')}</JourneyCard>
    </JourneyScreen>
  );
}
