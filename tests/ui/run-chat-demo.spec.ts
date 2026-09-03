import { expect, test, type Page } from '@playwright/test';

const ACTIVITY_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const DEMO_URL = `/dashboard/run-chat/${ACTIVITY_ID}/demo`;

async function signInAndOpenDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Test Runner', exact: true }).click();
  await page.waitForURL(/\/(dashboard|feed)(\?|$)/);
  await page.goto(DEMO_URL);

  await expect(page.getByTestId('run-chat-live-demo')).toBeVisible();
  await expect(page.getByTestId('runner-chat-pane')).toContainText(/Runner view|תצוגת רץ/);
  await expect(page.getByTestId('coach-chat-pane')).toContainText(/Coach view|תצוגת מאמן/);
}

test.beforeEach(async ({ page }) => {
  await signInAndOpenDemo(page);
});

test('mobile dev toolbar leaves the bottom navbar available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');

  const toolbar = page.getByTestId('dev-toolbar');
  const actions = page.getByTestId('dev-toolbar-actions');
  const toggle = page.getByTestId('dev-toolbar-toggle');
  const navbar = page.locator('nav.md\\:hidden');

  await expect(toggle).toBeVisible();
  await expect(actions).toBeHidden();

  const collapsedToolbar = await toolbar.boundingBox();
  const navbarBox = await navbar.boundingBox();
  expect(collapsedToolbar).not.toBeNull();
  expect(navbarBox).not.toBeNull();
  expect(navbarBox!.y - (collapsedToolbar!.y + collapsedToolbar!.height)).toBeGreaterThan(0);

  await toggle.click();
  await expect(actions).toBeVisible();
  const expandedToolbar = await toolbar.boundingBox();
  expect(expandedToolbar).not.toBeNull();
  expect(navbarBox!.y - (expandedToolbar!.y + expandedToolbar!.height)).toBeGreaterThan(0);
});

test('mobile chat uses edge-to-edge messages and a compact composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/run-chat/${ACTIVITY_ID}`);

  const planMessage = page.locator('.run-chat-msg').filter({ hasText: 'תוכנית האימון' }).first();
  const attachment = planMessage.locator('.run-chat-clipboard-thumb');
  const composer = page.locator('.run-chat-composer-row');
  const chatPage = page.locator('.run-chat-page');
  const navbar = page.locator('nav.md\\:hidden');

  await expect(attachment).toBeVisible();
  await expect(planMessage.locator('.run-chat-msg__avatar')).toBeHidden();
  await expect(navbar).toHaveCount(0);

  const attachmentBox = await attachment.boundingBox();
  const composerBox = await composer.boundingBox();
  const chatPageBox = await chatPage.boundingBox();
  expect(attachmentBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(chatPageBox).not.toBeNull();

  expect(chatPageBox!.x).toBe(0);
  expect(chatPageBox!.y).toBe(0);
  expect(chatPageBox!.width).toBe(390);
  expect(chatPageBox!.height).toBe(844);
  expect(attachmentBox!.x).toBeGreaterThanOrEqual(15);
  expect(attachmentBox!.x).toBeLessThanOrEqual(17);
  expect(attachmentBox!.width).toBeGreaterThanOrEqual(356);
  expect(attachmentBox!.width).toBeLessThanOrEqual(359);
  expect(composerBox!.x).toBeGreaterThanOrEqual(15);
  expect(composerBox!.x).toBeLessThanOrEqual(17);
  expect(composerBox!.height).toBeGreaterThanOrEqual(56);
  expect(composerBox!.height).toBeLessThanOrEqual(62);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(chatPageBox!.height);
});

test('runner and coach messages synchronize between both live panes', async ({ page }) => {
  const runnerPane = page.getByTestId('runner-chat-pane');
  const coachPane = page.getByTestId('coach-chat-pane');
  const runnerMessage = `runner-sync-${Date.now()}`;
  const coachMessage = `coach-sync-${Date.now()}`;

  await runnerPane.getByRole('textbox').fill(runnerMessage);
  await runnerPane.getByRole('textbox').press('Enter');
  await expect(runnerPane.getByText(runnerMessage, { exact: true })).toBeVisible();
  await expect(coachPane.getByText(runnerMessage, { exact: true })).toBeVisible();

  await coachPane.getByRole('textbox').fill(coachMessage);
  await coachPane.getByRole('textbox').press('Enter');
  await expect(runnerPane.getByText(coachMessage, { exact: true })).toBeVisible();
  await expect(coachPane.getByText(coachMessage, { exact: true })).toBeVisible();
});

test('message actions stay immediately beside outgoing and incoming bubbles', async ({ page }) => {
  const runnerPane = page.getByTestId('runner-chat-pane');
  const coachPane = page.getByTestId('coach-chat-pane');
  const outgoingText = `toolbar-runner-${Date.now()}`;
  const incomingText = `toolbar-coach-${Date.now()}`;

  await runnerPane.getByRole('textbox').fill(outgoingText);
  await runnerPane.getByRole('textbox').press('Enter');
  await coachPane.getByRole('textbox').fill(incomingText);
  await coachPane.getByRole('textbox').press('Enter');

  const outgoing = runnerPane.locator('.run-chat-msg--me').filter({ hasText: outgoingText }).last();
  await expect(outgoing).toBeVisible();
  await outgoing.hover();
  const outgoingBubble = await outgoing.locator('.str-chat__message-bubble').boundingBox();
  const outgoingActions = await outgoing.locator('.str-chat__message-options').boundingBox();
  expect(outgoingBubble).not.toBeNull();
  expect(outgoingActions).not.toBeNull();
  const outgoingGap = outgoingActions!.x - (outgoingBubble!.x + outgoingBubble!.width);
  expect(outgoingGap).toBeGreaterThanOrEqual(0);
  expect(outgoingGap).toBeLessThanOrEqual(16);

  const incoming = runnerPane
    .locator('.run-chat-msg--other')
    .filter({ hasText: incomingText })
    .last();
  await expect(incoming).toBeVisible();
  await incoming.hover();
  const incomingBubble = await incoming.locator('.str-chat__message-bubble').boundingBox();
  const incomingActions = await incoming.locator('.str-chat__message-options').boundingBox();
  expect(incomingBubble).not.toBeNull();
  expect(incomingActions).not.toBeNull();
  const incomingGap = incomingBubble!.x - (incomingActions!.x + incomingActions!.width);
  expect(incomingGap).toBeGreaterThanOrEqual(0);
  expect(incomingGap).toBeLessThanOrEqual(16);

  // Attachment messages use a wider Stream grid. This is the regression that
  // previously parked the emoji/menu controls inside the top of the card.
  const planAttachment = runnerPane
    .locator('.run-chat-msg--other')
    .filter({ hasText: 'תוכנית האימון' })
    .first();
  await planAttachment.locator('.str-chat__message-bubble').hover();
  const attachmentBubble = await planAttachment
    .locator('.str-chat__message-bubble')
    .boundingBox();
  const attachmentActions = await planAttachment
    .locator('.str-chat__message-options')
    .boundingBox();
  expect(attachmentBubble).not.toBeNull();
  expect(attachmentActions).not.toBeNull();
  const attachmentGap =
    attachmentBubble!.x - (attachmentActions!.x + attachmentActions!.width);
  expect(attachmentGap).toBeGreaterThanOrEqual(0);
  expect(attachmentGap).toBeLessThanOrEqual(16);
});

test('the first plan message opens prompt-based rebuilding', async ({ page }) => {
  let submittedPlan: Record<string, unknown> | null = null;
  await page.route('**/api/run-chat/*/plan', async (route) => {
    submittedPlan = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ chat: { id: 'test-chat' } }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Test Coach', exact: true }).click();
  await page.waitForURL(/\/(dashboard|feed)(\?|$)/);
  await page.goto(`/dashboard/run-chat/${ACTIVITY_ID}`);
  const planMessage = page.locator('.run-chat-msg').filter({ hasText: 'תוכנית האימון' }).first();
  await expect(planMessage).toBeVisible();
  await planMessage.locator('.str-chat__message-bubble').hover();
  await planMessage
    .getByRole('button', { name: 'Open Message Actions Menu' })
    .click();
  const editPlanAction = page.getByTestId('edit-plan-with-prompt');
  const actionLayout = await editPlanAction.evaluate((element) => {
    const icon = element.querySelector('svg');
    const label = element.querySelector('.str-chat__context-menu__button__label');
    const buttonRect = element.getBoundingClientRect();
    const iconRect = icon?.getBoundingClientRect();
    const labelRect = label?.getBoundingClientRect();
    return {
      display: getComputedStyle(element).display,
      alignItems: getComputedStyle(element).alignItems,
      height: buttonRect.height,
      iconHeight: iconRect?.height,
      iconCenterOffset:
        iconRect && Math.abs(iconRect.y + iconRect.height / 2 - (buttonRect.y + buttonRect.height / 2)),
      labelCenterOffset:
        labelRect &&
        Math.abs(labelRect.y + labelRect.height / 2 - (buttonRect.y + buttonRect.height / 2)),
    };
  });
  expect(actionLayout.display).toBe('flex');
  expect(actionLayout.alignItems).toBe('center');
  expect(actionLayout.height).toBeGreaterThanOrEqual(35);
  expect(actionLayout.height).toBeLessThanOrEqual(37);
  expect(actionLayout.iconHeight).toBeGreaterThanOrEqual(15);
  expect(actionLayout.iconHeight).toBeLessThanOrEqual(17);
  expect(actionLayout.iconCenterOffset).toBeLessThanOrEqual(1);
  expect(actionLayout.labelCenterOffset).toBeLessThanOrEqual(1);
  await editPlanAction.click();

  const dialog = page.getByTestId('edit-plan-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('edit-plan-prompt').fill('10km easy');
  await dialog.getByRole('button', { name: /Rebuild plan|בנה תוכנית מחדש/ }).click();

  await expect(dialog).toBeHidden();
  expect(submittedPlan).toMatchObject({ plannedText: '10km easy' });
  const payload = submittedPlan as unknown as Record<string, unknown>;
  expect(typeof payload.messageId).toBe('string');
});

test('the actual-run card shows laps as a table with collapsible repeat sets', async ({ page }) => {
  await page.goto(`/dashboard/run-chat/${ACTIVITY_ID}`);
  const runCard = page.locator('.run-chat-strava-card').first();
  await expect(runCard).toBeVisible();

  // The seeded test activity is warmup → N×(1000 + 400) → cooldown, so the
  // grouper must fold the interval laps into one repeat row; expanding it
  // reveals the 2·N individual laps.
  const repeatRow = runCard.getByTestId('laps-repeat-row');
  await expect(repeatRow).toBeVisible();
  await expect(repeatRow).toContainText(/\d+×/);
  await expect(repeatRow).toHaveAttribute('aria-expanded', 'false');
  const reps = Number((await repeatRow.innerText()).match(/(\d+)×/)![1]);
  expect(reps).toBeGreaterThanOrEqual(3);

  const rowsBefore = await runCard.locator('tbody tr').count();
  await repeatRow.click();
  await expect(repeatRow).toHaveAttribute('aria-expanded', 'true');
  const rowsAfter = await runCard.locator('tbody tr').count();
  expect(rowsAfter - rowsBefore).toBe(reps * 2);

  await repeatRow.click();
  await expect(repeatRow).toHaveAttribute('aria-expanded', 'false');
  expect(await runCard.locator('tbody tr').count()).toBe(rowsBefore);
});
