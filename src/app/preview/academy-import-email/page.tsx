import { notFound } from 'next/navigation';
import { academyExistingFormEmail } from '@/lib/email';

// The details-form mail an imported trainee gets (the existing move-in mail — the import re-uses
// it), for a made-up name and link. Development only. In production the route does not exist.
export default function PreviewAcademyImportEmail() {
  if (process.env.NODE_ENV === 'production') notFound();
  const mail = academyExistingFormEmail({ name: 'מיכל אורן', url: 'https://www.madregot.app/academy-register?i=0123456789abcdef0123456789abcdef' });
  return (
    <div style={{ background: '#E6E8EE', minHeight: '100vh', padding: 12 }}>
      <p style={{ font: '700 13px system-ui', color: '#6B7280', direction: 'rtl', margin: '0 4px 8px' }}>נושא: {mail.subject}</p>
      <iframe title="mail" srcDoc={mail.html} style={{ width: '100%', height: 760, border: 0, borderRadius: 16, background: '#fff' }} />
    </div>
  );
}
