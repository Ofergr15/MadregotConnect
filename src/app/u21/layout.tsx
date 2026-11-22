import type { Metadata } from 'next';
import { TEST_PREVIEW_NOTE } from '@/lib/u21/intake';

export const metadata: Metadata = {
  title: 'מדרגות · מאמן אישי U21',
  description: 'תוכנית ריצה, כוח ומוביליטי שבועית לגילאי 16–21. כל תוכנית עוברת את המאמן לפני שהיא נשלחת.',
};

export default function U21Layout({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-xl px-4 py-8">
        {/* Always shown in this initial protected preview — every /u21 screen, every step. */}
        <p role="note" data-testid="u21-test-preview-notice" className="mb-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800">
          {TEST_PREVIEW_NOTE}
        </p>
        {children}
      </div>
    </div>
  );
}
