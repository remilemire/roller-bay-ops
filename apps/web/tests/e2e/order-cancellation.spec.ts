import { expect, test } from '@playwright/test';
import { orderWorkflowSchema } from '@roller-bay/shared/work-orders';
import { mockApi } from './fixtures';
import { ids, timestamp } from '../fixtures';

test('cancellation reviews skipped results, preserves milestones, and retries the exact request', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  state.orders[0]!.cutAt = timestamp;
  state.orders[0]!.status = 'cut';
  const worksheetId = '80000000-0000-4000-8000-000000000088';
  await page.route(
    `**/api/work-orders/${ids.order}/cancellation-context`,
    (r) =>
      r.fulfill({
        json: {
          order: state.orders[0],
          allocation: { id: ids.allocation, revision: 1, completedAt: null },
          worksheet: { id: worksheetId, revision: 2, submittedAt: timestamp },
          outstandingCuttingResults: true,
        },
      }),
  );
  const writes: { key: string | undefined; body: unknown }[] = [];
  await page.route(`**/api/work-orders/${ids.order}/cancellation`, (r) => {
    writes.push({
      key: r.request().headers()['idempotency-key'],
      body: orderWorkflowSchema.parse(r.request().postDataJSON()),
    });
    if (writes.length === 1) return r.abort('failed');
    Object.assign(state.orders[0]!, {
      status: 'cancelled',
      cancelledAt: timestamp,
      cancellationReason: 'Customer cancelled',
      allocatedAt: null,
      shipDate: null,
      scheduledAt: null,
      revision: 4,
    });
    return r.fulfill({
      json: {
        eventId: ids.receipt,
        recordId: ids.order,
        revision: 4,
        affectedAllocationIds: [ids.allocation],
        createdStockItemIds: [],
      },
    });
  });
  await page.goto(`/work-orders/${ids.order}`);
  await page
    .getByRole('button', { name: 'Cancel or release', exact: true })
    .click();
  await page.getByLabel('Reason', { exact: true }).fill('Customer cancelled');
  await expect(
    page.getByRole('button', { name: 'Review changes' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('link', { name: 'Resolve cutting results' }),
  ).toHaveAttribute('href', `/stations/review?worksheet=${worksheetId}`);
  await page
    .getByRole('checkbox', { name: /Continue without recording results/ })
    .check();
  await page.getByRole('button', { name: 'Review changes' }).click();
  expect(writes).toHaveLength(0);
  await expect(
    page.getByText(/Stock balances will stay unchanged/),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('order-cancellation-review.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Confirm changes' }).click();
  await expect(page.getByText(/uncertain result/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry saved request' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]!.body).toMatchObject({
    action: 'cancel-order',
    skipCuttingResults: true,
    worksheetId,
    expectedWorksheetRevision: 2,
  });
  await expect(page.getByText('Cancelled: Customer cancelled')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel or release', exact: true }),
  ).not.toBeVisible();
  expect(state.orders[0]!.cutAt).toBe(timestamp);
});

test('unscheduling needs no skipped-results acknowledgment and a stale review preserves input', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.route(
    `**/api/work-orders/${ids.order}/cancellation-context`,
    (r) =>
      r.fulfill({
        json: {
          order: state.orders[0],
          allocation: { id: ids.allocation, revision: 1, completedAt: null },
          worksheet: null,
          outstandingCuttingResults: true,
        },
      }),
  );
  await page.route(`**/api/work-orders/${ids.order}/cancellation`, (r) => {
    const body = orderWorkflowSchema.parse(r.request().postDataJSON());
    expect(body.action).toBe('unschedule');
    expect(body.skipCuttingResults).toBe(false);
    return r.fulfill({
      status: 409,
      json: { message: 'The order changed. Refresh the cancellation form.' },
    });
  });
  await page.goto(`/work-orders/${ids.order}`);
  await page
    .getByRole('button', { name: 'Cancel or release', exact: true })
    .click();
  await page.getByLabel('Action', { exact: true }).selectOption('unschedule');
  await page.getByLabel('Reason', { exact: true }).fill('Move delivery later');
  await expect(page.getByRole('checkbox')).not.toBeVisible();
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.getByRole('button', { name: 'Confirm changes' }).click();
  await expect(page.getByRole('alert')).toContainText('order changed');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Reason', { exact: true })).toHaveValue(
    'Move delivery later',
  );
  await page.getByRole('button', { name: 'Refresh current state' }).click();
  await expect(page.getByLabel('Reason', { exact: true })).toHaveValue(
    'Move delivery later',
  );
});
