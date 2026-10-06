import type { Metadata } from 'next';

// The join page's own manifest (api/public/manifest): the icon added from here
// opens on this member's welcome screen. See that route for why.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return { manifest: `/api/public/manifest?t=${encodeURIComponent(token)}` };
}

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
