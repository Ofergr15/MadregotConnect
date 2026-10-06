'use client';

import { notFound } from 'next/navigation';
import { RegisterReceived } from '@/app/register/RegisterReceived';

// Login-free preview of the v2 "we got it" screen. Development only.
export default function RegisterReceivedPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <RegisterReceived state="new" email="noa.levi@gmail.com" name="נועה לוי" />;
}
