/** The club's help line on WhatsApp (NEXT_PUBLIC_HELP_WHATSAPP), or null when unset. */
export function helpWhatsAppHref(text: string): string | null {
  const n = process.env.NEXT_PUBLIC_HELP_WHATSAPP || '';
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
