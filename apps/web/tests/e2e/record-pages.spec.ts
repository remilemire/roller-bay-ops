import { test, expect } from '@playwright/test';
import { mockApi, ids } from './fixtures';

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
