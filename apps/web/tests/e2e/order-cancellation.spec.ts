import { expect, test } from '@playwright/test';
import { orderCancellationSchema } from '@roller-bay/shared/work-orders';
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
      body: orderCancellationSchema.parse(r.request().postDataJSON()),
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
    .getByRole('button', { name: 'Cancel work order', exact: true })
    .click();
  await page.getByLabel('Reason', { exact: true }).fill('Customer cancelled');
  await expect(
    page.getByRole('button', { name: 'Review cancellation' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('link', { name: 'Resolve cutting results' }),
  ).toHaveAttribute('href', `/stations/review?worksheet=${worksheetId}`);
  const warning = page.locator('.cancellation-warning');
  await expect(warning).toHaveCSS('display', 'grid');
  await expect(warning).toHaveCSS('font-size', '14px');
  const fits = await warning.evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  expect(fits).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('order-cancellation-form.png'),
    fullPage: true,
  });
  await page
    .getByRole('checkbox', { name: /Continue without recording results/ })
    .check();
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  expect(writes).toHaveLength(0);
  await expect(
    page.getByText(/Stock balances will stay unchanged/),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('order-cancellation-review.png'),
    fullPage: true,
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel work order', exact: true })
    .click();
  await expect(page.getByText(/uncertain result/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry saved request' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]!.body).toMatchObject({
    skipCuttingResults: true,
    worksheetId,
    expectedWorksheetRevision: 2,
  });
  await expect(page.getByText('Cancelled: Customer cancelled')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel work order', exact: true }),
  ).not.toBeVisible();
  expect(state.orders[0]!.cutAt).toBe(timestamp);
});

test('a stale cancellation reloads details while preserving the reason and requiring a new review', async ({
  page,
}) => {
  const state = await mockApi(page);
  let reads = 0;
  let writes = 0;
  await page.route(
    `**/api/work-orders/${ids.order}/cancellation-context`,
    (r) => {
      reads++;
      return r.fulfill({
        json: {
          order: { ...state.orders[0], revision: reads },
          allocation: { id: ids.allocation, revision: 1, completedAt: null },
          worksheet: null,
          outstandingCuttingResults: false,
        },
      });
    },
  );
  await page.route(`**/api/work-orders/${ids.order}/cancellation`, (r) => {
    writes++;
    const body = orderCancellationSchema.parse(r.request().postDataJSON());
    expect(body.expectedRevision).toBe(writes);
    expect(body.reason).toBe('Customer cancelled');
    return r.fulfill(
      writes === 1
        ? { status: 409, json: { message: 'The order changed.' } }
        : {
            json: {
              eventId: ids.receipt,
              recordId: ids.order,
              revision: 3,
              affectedAllocationIds: [ids.allocation],
              createdStockItemIds: [],
            },
          },
    );
  });
  await page.goto(`/work-orders/${ids.order}`);
  await page
    .getByRole('button', { name: 'Cancel work order', exact: true })
    .click();
  await expect(page.getByLabel('Action', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Refresh current state' }),
  ).toHaveCount(0);
  await page.getByLabel('Reason', { exact: true }).fill('Customer cancelled');
  await page
    .getByRole('button', { name: 'Review cancellation', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel work order', exact: true })
    .click();
  await expect(page.getByText(/This order changed. Review/)).toBeVisible();
  await expect(page.getByLabel('Reason', { exact: true })).toHaveValue(
    'Customer cancelled',
  );
  expect(reads).toBe(2);
  await page
    .getByRole('button', { name: 'Review cancellation', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel work order', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('allocation cancellation keeps the date, flags the order, and leaves unscheduling in scheduling', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  const scheduled = state.orders[0]!;
  const date = scheduled.shipDate;
  await page.route(
    `**/api/allocations/${ids.allocation}/cancellation-context`,
    (r) =>
      r.fulfill({
        json: {
          order: scheduled,
          allocation: { id: ids.allocation, revision: 1, completedAt: null },
          worksheet: null,
          outstandingCuttingResults: false,
        },
      }),
  );
  await page.route(`**/api/allocations/${ids.allocation}/cancellation`, (r) => {
    const body = orderCancellationSchema.parse(r.request().postDataJSON());
    expect(body.allocationId).toBe(ids.allocation);
    scheduled.allocatedAt = null;
    scheduled.revision++;
    return r.fulfill({
      json: {
        eventId: ids.receipt,
        recordId: ids.allocation,
        revision: 2,
        affectedAllocationIds: [ids.allocation],
        createdStockItemIds: [],
      },
    });
  });
  await page.goto(`/allocations/${ids.allocation}`);
  const cancelAllocation = page.locator('.page-heading').getByRole('button', {
    name: 'Cancel allocation',
    exact: true,
  });
  await expect(cancelAllocation).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('allocation-header.png') });
  await cancelAllocation.click();
  await expect(page.getByText(/Its ship date stays/)).toBeVisible();
  await page
    .getByLabel('Reason', { exact: true })
    .fill('Choose a different roll');
  await page
    .getByRole('button', { name: 'Review cancellation', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel allocation', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(scheduled.shipDate).toBe(date);
  await page.goto(`/work-orders/${ids.order}`);
  await expect(page.getByText('Needs fabric allocation')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Allocate', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('scheduled-without-allocation.png'),
    fullPage: true,
  });
  // Without fabric, a new date takes a back order; clearing it does not.
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('PO numbers')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Unschedule', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Needs fabric allocation')).toHaveCount(0);
  expect(state.orders[0]!.shipDate).toBeNull();
});
