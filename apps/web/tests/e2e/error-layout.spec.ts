import { expect, test } from '@playwright/test';
import { mockApi, ids, pickEmployee, unallocatedOrderId } from './fixtures';
import { orderLines } from '../fixtures';

test('station error stays below its actions', async ({ page }, testInfo) => {
  await mockApi(page, { role: 'production', stations: ['assembly'] });
  await page.route(
    `**/api/production/assembly/orders/${ids.order}/complete`,
    (route) =>
      route.fulfill({
        status: 409,
        json: { message: 'This order cannot be recorded yet.' },
      }),
  );
  await page.goto('/stations?station=assembly');
  await pickEmployee(page, 'Alex Reed');
  const manual = page.getByRole('button', { name: 'Mark 104801 assembled' });
  await manual.click();
  const alert = page
    .getByRole('alert')
    .filter({ hasText: 'This order cannot be recorded yet.' });
  await expect(alert).toBeVisible();
  // The cutting screen can have a worksheet action beside the completion
  // action. Add that sibling after React renders the error, so this layout
  // check stays independent of uncommitted cutting workflow changes.
  await page.evaluate(() => {
    const group = document.querySelector(
      '.station-workspace .inline-actions > .action-group',
    );
    if (!group?.parentElement) throw new Error('Station actions not found');
    const link = document.createElement('a');
    link.href = '#worksheet';
    link.className = 'button button-outline';
    link.textContent = 'Worksheet action';
    group.parentElement.prepend(link);
  });
  const worksheet = page.getByRole('link', { name: 'Worksheet action' });
  const [worksheetBox, manualBox, alertBox] = await Promise.all([
    worksheet.boundingBox(),
    manual.boundingBox(),
    alert.boundingBox(),
  ]);
  expect(worksheetBox && manualBox && alertBox).toBeTruthy();
  expect(Math.abs(worksheetBox!.y - manualBox!.y)).toBeLessThan(2);
  expect(alertBox!.y).toBeGreaterThanOrEqual(manualBox!.y + manualBox!.height);
  expect(
    await alert.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('station-error.png') });
});

test('generation banner centers its cancel action', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  state.orders[1]!.lines = structuredClone(orderLines);
  let release!: () => void;
  await page.route('**/api/allocations/optimize', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort('failed').catch(() => {});
  });
  await page.goto(`/allocations/new?workOrder=${unallocatedOrderId}`);
  await page.getByRole('button', { name: 'Generate plan' }).click();
  const banner = page
    .getByRole('status')
    .filter({ hasText: 'Generating a cutting plan' });
  const message = banner.getByText('Generating a cutting plan…');
  const cancel = banner.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  const [messageBox, cancelBox] = await Promise.all([
    message.boundingBox(),
    cancel.boundingBox(),
  ]);
  expect(messageBox && cancelBox).toBeTruthy();
  expect(
    Math.abs(
      messageBox!.y +
        messageBox!.height / 2 -
        cancelBox!.y -
        cancelBox!.height / 2,
    ),
  ).toBeLessThan(2);
  await page.screenshot({
    path: testInfo.outputPath('generation-banner.png'),
    fullPage: true,
  });
  release();
});
