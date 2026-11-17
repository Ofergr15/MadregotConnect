// Hebrew copy for the seed Practice videos.
//
// The live library is a JSON blob in app_settings.practice_videos that coaches
// edit, and it stores ONE title/description per video (English, from the seed).
// Rather than rewrite stored data, the reader's locale picks the text here:
// a card whose stored English title matches a seed entry shows that entry's
// Hebrew in `he`. A title a coach typed by hand has no entry and is shown as-is.
export interface PracticeCopy { title: string; description: string }

export const PRACTICE_SEED_COPY: Record<string, { en: PracticeCopy; he: PracticeCopy }> = {
  'Leg Workout': {
    en: { title: 'Leg Workout', description: 'Leg strengthening exercises for runners.' },
    he: { title: 'אימון רגליים', description: 'תרגילי חיזוק רגליים לרצים.' },
  },
  'Leg Strength - Squats & Lunges': {
    en: { title: 'Leg Strength - Squats & Lunges', description: 'Build running-specific leg strength with bodyweight squats, lunges, and single-leg exercises.' },
    he: { title: 'כוח רגליים – סקוואטים ומכרעים', description: 'בניית כוח רגליים ייעודי לריצה: סקוואטים במשקל גוף, מכרעים ותרגילים על רגל אחת.' },
  },
  'Calf Raises & Ankle Stability': {
    en: { title: 'Calf Raises & Ankle Stability', description: 'Strengthen calves and improve ankle stability for better running form and injury prevention.' },
    he: { title: 'הרמות עקב ויציבות קרסול', description: 'חיזוק שרירי התאומים ושיפור יציבות הקרסול לטכניקת ריצה טובה יותר ולמניעת פציעות.' },
  },
  'Hip & Glute Activation': {
    en: { title: 'Hip & Glute Activation', description: 'Activate glutes and hip stabilizers. Essential for maintaining form during long runs.' },
    he: { title: 'הפעלת ירך וישבן', description: 'הפעלת שרירי הישבן ומייצבי הירך. חיוני לשמירה על טכניקה בריצות ארוכות.' },
  },
  'Post-Run Recovery Stretch': {
    en: { title: 'Post-Run Recovery Stretch', description: 'Cool down routine targeting quads, hamstrings, hip flexors, and calves after a run.' },
    he: { title: 'מתיחות התאוששות אחרי ריצה', description: 'שגרת שחרור אחרי ריצה: ארבע ראשי, שרירים אחוריים, מכופפי ירך ותאומים.' },
  },
  'Plyometrics - Jump Training': {
    en: { title: 'Plyometrics - Jump Training', description: 'Explosive jump exercises to build power and running speed. Box jumps, bounds, and hops.' },
    he: { title: 'פליאומטריקה – אימון קפיצות', description: 'תרגילי קפיצה מתפרצים לבניית כוח מתפרץ ומהירות ריצה: קפיצות לארגז, ניתורים וקפיצות רגל.' },
  },
};

/** Title/description in the reader's locale; unknown (coach-typed) text passes through. */
export function localizePractice<T extends PracticeCopy>(v: T, locale: string): T {
  const entry = PRACTICE_SEED_COPY[v.title.trim()];
  if (!entry || locale !== 'he') return v;
  // Only swap the description if the coach did not change it from the seed.
  const desc = v.description.trim() === entry.en.description ? entry.he.description : v.description;
  return { ...v, title: entry.he.title, description: desc };
}

/** "8 min" -> "8 דק׳" in Hebrew. */
export function localizeDuration(d: string, locale: string): string {
  return locale === 'he' ? d.replace(/\bmin\b/i, 'דק׳') : d;
}
