import { expect, test } from '@playwright/test';
import { mockApi, ids, pickEmployee, unallocatedOrderId } from './fixtures';
import { orderLines } from '../fixtures';

test('station completion errors sit between attribution and the retryable action', async ({
  page,
}, testInfo) => {
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
  await page.getByRole('button', { name: 'Mark 104801 assembled' }).click();
  const dialog = page.getByRole('dialog');
  await pickEmployee(dialog, 'Alex Reed');
  const submit = dialog.getByRole('button', { name: 'Record completion' });
  await submit.click();
  const alert = dialog
    .getByRole('alert')
    .filter({ hasText: 'This order cannot be recorded yet.' });
  await expect(alert).toBeVisible();
  await expect(submit).toBeEnabled();
  const [selectionBox, alertBox, submitBox] = await Promise.all([
    dialog.locator('.employee-selection').boundingBox(),
    alert.boundingBox(),
    submit.boundingBox(),
  ]);
  expect(selectionBox && alertBox && submitBox).toBeTruthy();
  expect(alertBox!.y).toBeGreaterThanOrEqual(
    selectionBox!.y + selectionBox!.height,
  );
  expect(submitBox!.y).toBeGreaterThanOrEqual(alertBox!.y + alertBox!.height);
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
