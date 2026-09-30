import { academyShareMetadata } from '@/lib/academy/share-metadata';

// The page itself is a client component, which cannot export metadata.
export const metadata = academyShareMetadata(
  'אקדמיית מדרגות · שאלון הצטרפות',
  'ליווי אישי בריצה: מאמן 1:1 ותוכנית שנבנית בשבילך. כמה דקות של שאלון ואנחנו חוזרים אליך.',
);

export default function AcademyRegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
