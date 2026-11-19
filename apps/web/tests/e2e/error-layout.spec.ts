import { expect, test, type Page } from '@playwright/test';
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
  let cancelled = false;
  await page.route('**/api/allocations/planning-jobs/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      cancelled = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { status: 'searching' } });
  });
  await generateCuttingPlan(page);
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
  expect(cancelled).toBe(true);
});

async function generateCuttingPlan(page: Page) {
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
}

test('a ready cutting plan can be used while refinement is in progress', async ({
  page,
}) => {
  await mockApi(page);
  // Keep refinement pending long enough to choose the already validated plan.
  await page.route('**/api/allocations/planning-jobs/*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { status: 'searching' } })
      : route.fallback(),
  );
  await generateCuttingPlan(page);
  await page.getByRole('button', { name: 'Use available plan' }).click();
  await expect(
    page.getByText('Valid cutting plan', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Quantity in this cut', { exact: true }),
  ).toHaveValue('1');
});

test('reopening the order resumes the same search and restores its unsaved blinds', async ({
  page,
}) => {
  await mockApi(page);
  const submissions: string[] = [];
  await page.route('**/api/allocations/planning-jobs/*', (route) => {
    if (route.request().method() === 'PUT') {
      submissions.push(route.request().url());
      if (submissions.length > 1) return route.fallback();
    }
    return route.fulfill({ json: { status: 'searching' } });
  });
  await generateCuttingPlan(page);
  await expect.poll(() => submissions.length).toBe(1);
  await page.reload();
  await page
    .getByRole('button', { name: 'Resume previous cutting search' })
    .click();
  await page.getByRole('button', { name: 'Use available plan' }).click();
  await expect(page.getByLabel('Width (in)', { exact: true })).toHaveValue(
    '54',
  );
  await expect(
    page.getByText('Valid cutting plan', { exact: true }),
  ).toBeVisible();
  expect(submissions).toEqual([submissions[0], submissions[0]]);
});
