import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasVisibleText } from '@/components/AthleteLink';

/**
 * WCAG 2.5.3 "label in name" (task 111, axe on seeded data): an aria-label that
 * replaces visible text fails it. AthleteLink only labels links that show no text.
 */
describe('hasVisibleText', () => {
  it('sees text at any depth', () => {
    expect(hasVisibleText('נועה')).toBe(true);
    expect(hasVisibleText(7)).toBe(true);
    expect(hasVisibleText(<span><b>נועה</b> לוי</span>)).toBe(true);
    expect(hasVisibleText([null, <span key="a">x</span>])).toBe(true);
  });

  it('an avatar, an icon or whitespace is not text — those links keep the label', () => {
    expect(hasVisibleText(<img alt="" src="/a.png" />)).toBe(false);
    expect(hasVisibleText(<span className="avatar" />)).toBe(false);
    expect(hasVisibleText('  ')).toBe(false);
    expect(hasVisibleText(null)).toBe(false);
    expect(hasVisibleText(false)).toBe(false);
  });
});

describe('FeedCard labels start from what is on screen', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/FeedCard.tsx'), 'utf8');
  it('like has no label over the visible word, only aria-pressed', () => {
    expect(src).not.toContain("aria-label={liked ? t('unlike') : t('like')}");
    expect(src).toContain('aria-pressed={liked}');
  });
  it('comments starts with the visible word', () => {
    expect(src).toContain("aria-label={commentCount > 0 ? `${t('actionComment')} ${commentCount}` : t('actionComment')}");
  });
  it('share and run-chat labels start with their visible word', () => {
    expect(src).toContain("aria-label={`${t('actionShare')} · ${t('shareToStory')}`}");
    expect(src).toContain("aria-label={`${t('actionChat')} · ${runChatLabel}`}");
  });
  it('the run body keeps its content as the name; the hint is sr-only after it', () => {
    expect(src).not.toContain("aria-label={t('viewDetails')}");
    expect(src).toContain(`<span className="sr-only">{t('viewDetails')}</span>`);
  });
});
