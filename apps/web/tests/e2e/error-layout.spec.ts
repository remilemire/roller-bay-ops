import { expect, test } from '@playwright/test';
import { mockApi, ids, pickEmployee, unallocatedOrderId } from './fixtures';

test('station completion errors remain readable and the action stays retryable', async ({
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
  await submit.click({ trial: true });
  expect(
    await alert.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('station-error.png') });
});

test('generation can be cancelled while the request is pending', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  let release!: () => void;
  await page.route('**/api/allocations/optimize', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort('failed').catch(() => {});
  });
  await page.goto(`/allocations/new?workOrder=${unallocatedOrderId}`);
  // A plan is generated for the blinds entered.
  await page.getByRole('button', { name: 'Add blind', exact: true }).click();
  await page.getByLabel('Color · blind 1', { exact: true }).click();
  await page
    .getByRole('option', { name: 'C1-000 · Linen voile', exact: true })
    .click();
  await page.getByLabel('Width (in)', { exact: true }).fill('54');
  await page.getByLabel('Finished drop (in)').fill('90');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Generate plan' }).click();
  const banner = page
    .getByRole('status')
    .filter({ hasText: 'Generating a cutting plan' });
  const cancel = banner.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('generation-banner.png'),
    fullPage: true,
  });
  await cancel.click();
  await expect(banner).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Generate plan', exact: true }),
  ).toBeEnabled();
  release();
});
