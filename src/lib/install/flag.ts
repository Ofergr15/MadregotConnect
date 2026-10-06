// The one switch for onboarding v2 (the install guide, its video, the new approval
// mail and WhatsApp message). Its own module, with no 'use client', so the server
// routes that build the approval mail can read it too. Flip to ship to everyone.
export const ONBOARDING_V2_FOR_ALL = false;

/** The join link the v2 mail and WhatsApp message carry: `?onb=v2` turns the guide on for that phone. */
export function joinLinkV2(appUrl: string, token: string, v2: boolean): string {
  return `${appUrl}/join/${token}${v2 ? '?onb=v2' : ''}`;
}

/** The WhatsApp message an approver sends with one tap. */
export function approvalWhatsAppText(link: string, groupName?: string | null, name?: string | null): string {
  const first = (name || '').trim().split(/\s+/)[0];
  return [
    `היי${first ? ` ${first}` : ''}! 👋 כאן ממדרגות. אושרת להצטרף${groupName ? `, ${groupName}` : ''} 🎉`,
    '',
    'ככה מתקינים את האפליקציה (דקה אחת):',
    '1. לוחצים על הקישור כאן למטה',
    '2. עוקבים אחרי ההוראות שבמסך',
    '',
    link,
    '',
    'נתקעת? פשוט תענו להודעה הזאת 🙂',
  ].join('\n');
}
