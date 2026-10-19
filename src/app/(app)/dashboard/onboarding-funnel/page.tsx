'use client';

import { Suspense } from 'react';
import { OnboardingFunnel } from '@/components/admin/OnboardingFunnel';

/** /dashboard/onboarding-funnel — the joining funnel. The API is gated to the super user and approvers. */
export default function OnboardingFunnelPage() {
  // Suspense: the screen reads ?stage= (the approvers' reminder lands on a step).
  return <Suspense><OnboardingFunnel /></Suspense>;
}
