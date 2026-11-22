import { test, expect } from '@playwright/test';
import { mockApi, ids } from './fixtures';
import { receipt } from '../fixtures';

test('production history remains accessible and record pages fit the viewport', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  const timestamp = '2026-09-22T12:00:00.000Z';
  for (const station of ['assembly', 'checking'] as const) {
    state.productionCompletions.push({
      workOrderId: ids.order,
      station,
      employees: [
        {
          employeeId: state.employees[0]!.id,
          employeeName: 'Alex Reed',
          employeeInitials: 'AR',
        },
      ],
      completedAt: timestamp,
      recordedAt: timestamp,
      recordedByUserId: ids.user,
    });
  }
  await page.route('**/history?*', (route) =>
    route.fulfill({
      json: {
        items: ['receipt.corrected', 'receipt.submitted'].map(
          (action, index) => ({
            id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
            actorId: ids.user,
            actorName: 'Alex Reed',
            createdAt: timestamp,
            action,
            reason: null,
            changes: [],
          }),
        ),
        total: 2,
        page: 1,
        pageSize: 25,
      },
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem('roller-bay-theme', 'dark'),
  );
  await page.goto('/stations?station=cutting');
  const card = page.getByRole('region', { name: 'Order 104801', exact: true });
  await card.locator('summary').click();
  const stationRows = card.locator('.station-history-row');
  await expect(stationRows).toHaveCount(4);
  await expect(stationRows.filter({ hasText: 'Alex Reed' })).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('station-spacing.png'),
    fullPage: true,
  });

  await page.goto(`/work-orders/${ids.order}`);
  await expect(
    page.getByRole('heading', { name: 'Production', exact: true }),
  ).toBeVisible();
  const productionRows = page.locator('.record-list > div');
  await expect(productionRows).toHaveCount(4);
  await expect(page.locator('.history summary')).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('order-spacing.png'),
    fullPage: true,
  });
  await page.locator('.history summary').first().click();
  await expect(
    page.locator('.history > .panel-body > details').first(),
  ).toHaveAttribute('open', '');

  for (const [name, path] of [
    ['stock', `/stock-items/${ids.stock}`],
    ['receipt', `/stock-receipts/${ids.receipt}`],
    ['receipt-form', '/stock-receipts/new'],
    ['allocation', `/allocations/${ids.allocation}`],
    ['settings', '/settings'],
  ]) {
    await page.goto(path!);
    await expect(page.locator('main .panel').first()).toBeVisible();
    await expect(page.locator('main .loading')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${name}-spacing.png`),
      fullPage: true,
    });
  }
});

test('receipt values stay on one line as stock links flow and the table scrolls', async ({
  page,
}) => {
  await mockApi(page);
  const line = receipt.items[0]!;
  const fabricColorCode = 'CS204-SL';
  const stockItems = Array.from({ length: 24 }, (_, index) => ({
    ...line.stockItems[0]!,
    id: `${String(index + 1).padStart(8, '0')}-3333-4333-8333-333333333333`,
    fabricColorCode,
  }));
  await page.route(`**/api/stock-receipts/${ids.receipt}`, (route) =>
    route.fulfill({
      json: {
        ...receipt,
        items: [
          {
            ...line,
            quantity: stockItems.length,
            stockItems,
            stockItemIds: stockItems.map(({ id }) => id),
          },
        ],
      },
    }),
  );
  await page.goto(`/stock-receipts/${ids.receipt}`);
  const table = page.getByRole('table');
  const fabric = table.getByRole('cell', { name: fabricColorCode });
  const width = table.getByRole('cell', { name: '54 in' });
  const links = table.getByRole('link');
  await expect(links).toHaveCount(24);
  await expect(fabric).toHaveCSS('white-space', 'nowrap');
  await expect(width).toHaveCSS('white-space', 'nowrap');
  expect((await links.last().boundingBox())!.y).toBeGreaterThan(
    (await links.first().boundingBox())!.y,
  );

  await page.setViewportSize({ width: 360, height: 900 });
  const wrapper = page.locator('.data-table-wrap').filter({ has: table });
  expect(await wrapper.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
    await wrapper.evaluate((el) => el.clientWidth),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
