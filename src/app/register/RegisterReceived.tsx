'use client';

// The "we got it" screen of onboarding v2 (lib/install/flag): the same 4-step
// journey the approval mail and the install guide draw, so a new member always
// sees where they are and that there is nothing to do but wait for one thing.
// Drawn with the journey's one look (components/onboarding/journey-ui); the
// waiting screen for a signed-in member (/pending-approval) is the same screen.

import { useIsComputer } from '@/lib/install/use-computer';
import {
  JOURNEY, JourneyCard, JourneyHero, JourneyRow, JourneyScreen, JourneyTracker, NextCard, PrimaryButton,
} from '@/components/onboarding/journey-ui';

/**
 * The joining journey — kept as an export for older callers; it is the shared
 * JourneyTracker now. `done` always counts on the full four-step scale.
 */
export function Journey({ done, computer = false }: { done: number; computer?: boolean }) {
  return <JourneyTracker done={done} computer={computer} />;
}

export function RegisterReceived({ state, email, name }: { state: 'new' | 'pending' | 'member'; email: string; name: string }) {
  // On a computer there is nothing to install, so the tracker has no install step.
  const computer = useIsComputer();
  const first = name.split(/\s+/)[0] || '';
  const title = state === 'member' ? 'כבר יש לכם חשבון 🙌' : state === 'pending' ? 'כבר קיבלנו את הבקשה 🙌' : `קיבלנו${first ? `, ${first}` : ''} 🙌`;
  const subtitle = state === 'member' ? 'אין צורך להירשם שוב' : state === 'pending' ? 'הבקשה בבדיקה' : 'הצעד הראשון מאחוריכם';

  if (state === 'member') {
    return (
      <JourneyScreen
        testId="register-received"
        hero={<JourneyHero eyebrow="מועדון הריצה של מדרגות" title={title} subtitle={subtitle} />}
        // /welcome without a link is the email-code sign-in, never the marketing page.
        actions={<PrimaryButton href="/welcome">לכניסה לאפליקציה</PrimaryButton>}
      >
        <JourneyCard className="text-center">
          <p className="text-[15px] leading-relaxed" style={{ color: JOURNEY.body }}>
            הכתובת <bdi dir="ltr" className="font-bold">{email}</bdi> כבר רשומה במדרגות.
          </p>
        </JourneyCard>
      </JourneyScreen>
    );
  }

  return (
    <JourneyScreen
      testId="register-received"
      hero={<JourneyHero eyebrow="מועדון הריצה של מדרגות" title={title} subtitle={subtitle} />}
      actions={
        <p className="text-center text-[13px] leading-relaxed" style={{ color: JOURNEY.soft }}>
          אין צורך לעשות שום דבר בינתיים.<br />לא הגיע מייל תוך יום? כדאי לבדוק בספאם.
        </p>
      }
    >
      <JourneyTracker done={1} computer={computer} />
      <NextCard label="הבא בתור" title="אישור מהמאמן">
        בדרך כלל תוך יום. נשלח מייל אל<br />
        <bdi dir="ltr" className="font-bold" style={{ color: JOURNEY.ink }}>{email}</bdi>
      </NextCard>
      <JourneyCard>
        <JourneyRow icon="⌚" title="יש שעון ריצה או Strava?" sub="מחברים אחרי האישור, בלחיצה" />
        {/* The approval mail is opened on the phone, where the install takes a minute. */}
        {computer && <JourneyRow icon="📱" title="את המייל פותחים בטלפון" sub="שם ההתקנה לוקחת דקה, והמסך מראה בדיוק איך" />}
      </JourneyCard>
    </JourneyScreen>
  );
}
