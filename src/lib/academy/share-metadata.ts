import type { Metadata } from 'next';

/**
 * What WhatsApp, Instagram and iMessage show when an academy link is pasted.
 *
 * The preview is built from og:title / og:description, and a page that sets only
 * `title` still inherits the ROOT layout's openGraph block — so a personal form link
 * sent to a candidate previewed as "Madregot After 2KM · Israel's leading running
 * community", with no word of the academy. Both academy pages set their own.
 */
export function academyShareMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Madregot Academy', locale: 'he_IL', type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}
