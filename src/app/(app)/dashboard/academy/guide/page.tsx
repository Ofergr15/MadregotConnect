'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell, CalendarDays, ChevronLeft, GraduationCap, MessageCircle, Smile, Sun, TrendingUp, Watch } from 'lucide-react';
import { useNavIdentity } from '@/lib/nav-items';
import { guideSteps, type GuideLabel, type GuideStep } from '@/lib/academy/guide';
import { CARD } from '@/components/trainee/ui';
import { SkeletonList } from '@/components/ui';

// ── "מדריך לאקדמיה" (lib/academy/guide.ts) ──────────────────────────────────────────────
// Six short steps for a new trainee, each with the real labels on the way to the screen and
// a button that opens it. The trainee experience decides which six (v2 or the classic one).

const ICONS: Record<GuideStep['icon'], React.ComponentType<{ className?: string }>> = {
  sun: Sun, calendar: CalendarDays, message: MessageCircle, feel: Smile,
  watch: Watch, progress: TrendingUp, graduation: GraduationCap, bell: Bell,
};

function Label({ label }: { label: GuideLabel }) {
  const t = useTranslations();
  const text = 'msg' in label ? t(label.msg, label.values) : label.lit;
  return (
    <span className="inline-flex min-h-[26px] items-center rounded-full bg-[#EEF0FF] px-2.5 text-[12.5px] font-extrabold text-brand-600">
      <bdi>{text}</bdi>
    </span>
  );
}

export default function AcademyGuidePage() {
  const t = useTranslations('academyGuide');
  const { traineeV2, accountKnown } = useNavIdentity();
  if (!accountKnown) return <div className="p-4"><SkeletonList count={6} /></div>;
  const steps = guideSteps(traineeV2);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-2.5 pb-4" dir="rtl" data-testid="academy-guide">
      <div className="px-1 pt-1">
        <h1 className="text-[24px] font-black leading-tight text-ink-900">{t('title')}</h1>
        <p className="mt-0.5 text-[14px] text-ink-500">{t('subtitle')}</p>
      </div>
      {steps.map((step, i) => {
        const Icon = ICONS[step.icon];
        return (
          <section key={step.id} className={`${CARD} px-3.5 py-3`} aria-labelledby={`guide-${step.id}`}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-600 text-white">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <small className="block text-[11.5px] font-bold text-ink-400">{t('stepOf', { n: i + 1 })}</small>
                <h2 id={`guide-${step.id}`} className="text-[16.5px] font-black leading-tight text-ink-900">{t(`steps.${step.id}.title`)}</h2>
              </div>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{t(`steps.${step.id}.body`)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {step.path.map((label, j) => (
                <span key={j} className="inline-flex items-center gap-1">
                  {j > 0 && <ChevronLeft className="h-3.5 w-3.5 text-ink-300" aria-hidden />}
                  <Label label={label} />
                </span>
              ))}
            </div>
            <Link
              href={step.href}
              className="mt-1.5 flex min-h-[44px] items-center gap-0.5 text-[14px] font-extrabold text-brand-600"
            >
              {t('open')} <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
          </section>
        );
      })}
    </div>
  );
}
