import { SignupsClosed } from '@/components/auth/SignupsClosed';
import { signupsOpen } from '@/lib/signups/open';

export const dynamic = 'force-dynamic';

// New sign-ups are behind the `signups_open` switch (default off).
export default async function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (await signupsOpen()) ? children : <SignupsClosed />;
}
