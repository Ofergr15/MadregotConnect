import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'מדרגות · מאמן אישי U21',
  description: 'תוכנית ריצה, כוח ומוביליטי שבועית לגילאי 16–21. כל תוכנית עוברת את המאמן לפני שהיא נשלחת.',
};

export default function U21Layout({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-xl px-4 py-8">{children}</div>
    </div>
  );
}
