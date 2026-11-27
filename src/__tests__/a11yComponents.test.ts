import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/** Accessibility regressions fixed in the 2026-11 sweep (queue task 13). */
const read = (p: string) => readFileSync(`src/components/${p}`, 'utf8');

describe('a11y: inputs whose only visible hint is a placeholder carry an aria-label', () => {
  it.each([
    ['ManualActivitySheet.tsx', "aria-label={t('activityNamePlaceholder')}"],
    ['MemberDiscovery.tsx', "aria-label={t('discoverSearchPlaceholder')}"],
    ['profile/PrEditSheet.tsx', "aria-label={t('prNotePlaceholder')}"],
    ['events/EventSheet.tsx', "aria-label={t('addEvent.namePlaceholder')}"],
  ])('%s', (file, label) => expect(read(file)).toContain(label));
});

describe('a11y: RTL uses logical alignment, not physical', () => {
  it.each(['academy/ChatList.tsx', 'academy/ThreadInbox.tsx', 'academy/TestBoard.tsx', 'academy/CandidateFunnel.tsx', 'trainee/FormStrip.tsx'])(
    '%s has no text-right / ml-* / mr-*',
    (file) => expect(read(file)).not.toMatch(/["' ](text-right|ml-[\d.]+|mr-[\d.]+)["' ]/),
  );
});

describe('a11y: decorative map avatar is hidden from screen readers', () => {
  it('MeetupsMap host image has alt=""', () => expect(read('run-together/MeetupsMap.tsx')).toContain('<img src="${esc(m.host.avatarUrl)}" alt=""'));
});
