import { devices, expect, test, type Page } from '@playwright/test';

const ACTIVITY_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

test.use({ ...devices['iPhone 13'], browserName: 'chromium' });

async function signInAndOpenChat(page: Page) {
  await page.goto('/');
  await page.getByTestId('dev-toolbar-toggle').click();
  await page.getByRole('button', { name: 'Test Runner', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.goto(`/dashboard/run-chat/${ACTIVITY_ID}`);
  await expect(page.locator('.run-chat-page')).toBeVisible();
  await expect(page.locator('.str-chat__message-list')).toBeVisible();
}

async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...from, radiusX: 4, radiusY: 4 }],
  });
  for (let step = 1; step <= 6; step += 1) {
    const progress = step / 6;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
          radiusX: 4,
          radiusY: 4,
        },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
  await page.waitForTimeout(250);
}

test('chat owns vertical swipes without triggering page refresh', async ({ page }) => {
  await signInAndOpenChat(page);
  const messageList = page.locator('.str-chat__message-list');
  const box = await messageList.boundingBox();
  expect(box).not.toBeNull();

  await messageList.evaluate((element) => {
    element.scrollTop = 0;
  });

  let mainFrameNavigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  const x = box!.x + box!.width / 2;
  await swipe(
    page,
    { x, y: box!.y + box!.height * 0.8 },
    { x, y: box!.y + box!.height * 0.25 },
  );
  const afterSwipeUp = await messageList.evaluate((element) => element.scrollTop);
  expect(afterSwipeUp).toBeGreaterThan(0);

  await swipe(
    page,
    { x, y: box!.y + box!.height * 0.25 },
    { x, y: box!.y + box!.height * 0.75 },
  );
  const afterSwipeDown = await messageList.evaluate((element) => element.scrollTop);
  expect(afterSwipeDown).toBeLessThan(afterSwipeUp);

  await messageList.evaluate((element) => {
    element.scrollTop = 0;
  });
  await swipe(
    page,
    { x, y: box!.y + box!.height * 0.3 },
    { x, y: box!.y + box!.height * 0.85 },
  );

  expect(mainFrameNavigations).toBe(0);
  await expect(page.locator('.run-chat-page')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/dashboard/run-chat/${ACTIVITY_ID}$`));
});

test('mobile chat has no horizontal overflow and keeps controls reachable', async ({ page }) => {
  await signInAndOpenChat(page);

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    windowScrollY: window.scrollY,
    composerFontSize: getComputedStyle(
      document.querySelector('.run-chat-contenteditable')!,
    ).fontSize,
  }));

  expect(dimensions.documentWidth).toBe(dimensions.viewportWidth);
  expect(dimensions.windowScrollY).toBe(0);
  expect(dimensions.composerFontSize).toBe('16px');
  await expect(page.locator('.run-chat-composer-row textarea')).toHaveCount(0);
  await expect(page.locator('.run-chat-contenteditable')).toHaveAttribute(
    'contenteditable',
    'plaintext-only',
  );

  const composer = await page.locator('.run-chat-composer-row').boundingBox();
  const chatPage = await page.locator('.run-chat-page').boundingBox();
  expect(composer).not.toBeNull();
  expect(chatPage).not.toBeNull();
  await expect(page.locator('nav.md\\:hidden')).toHaveCount(0);
  expect(chatPage!.x).toBe(0);
  expect(chatPage!.y).toBe(0);
  expect(chatPage!.width).toBe(dimensions.viewportWidth);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(chatPage!.height);
});
