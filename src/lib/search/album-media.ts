/**
 * A search album's media line: "14 תמונות", "60 סרטונים", or both. A video-only album
 * (QA #6, "13.11": 60 videos, no photos) never reads "0 photos".
 */
export function albumMedia(
  t: (key: 'photoCount' | 'videoCount', values: { count: number }) => string,
  a: { count: number; videos?: number | null },
): string {
  const videos = a.videos ?? 0;
  const parts = [a.count > 0 ? t('photoCount', { count: a.count }) : '', videos > 0 ? t('videoCount', { count: videos }) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('photoCount', { count: 0 });
}
