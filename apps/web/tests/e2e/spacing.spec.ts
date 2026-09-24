import { test, expect, type Locator } from '@playwright/test';
import { mockApi, ids, pickEmployee } from './fixtures';

async function boxes(rows: Locator) {
  return rows.evaluateAll((elements) =>
    elements.map((element) => {
      const { top, bottom, height } = element.getBoundingClientRect();
      return { top, bottom, height };
    }),
  );
}

test('record rows share spacing and detail cards remain separated', async ({
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
  await expect(page.locator('.record-list > p')).toHaveCount(2);
  const completions = await boxes(page.locator('.record-list > p'));
  expect(completions[0]!.height).toBe(44);
  expect(completions[1]!.top - completions[0]!.top).toBe(44);
  await page.screenshot({
    path: testInfo.outputPath('station-spacing.png'),
    fullPage: true,
  });

  await page.goto(`/work-orders/${ids.order}`);
  await expect(
    page.getByRole('heading', { name: 'Production', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.history summary')).toHaveCount(2);
  const history = await boxes(page.locator('.history summary'));
  expect(history[1]!.top - history[0]!.top).toBe(
    completions[1]!.top - completions[0]!.top,
  );
  const panels = await boxes(page.locator('main .panel'));
  expect(panels).toHaveLength(3);
  for (let index = 1; index < panels.length; index++) {
    expect(panels[index]!.top - panels[index - 1]!.bottom).toBe(24);
  }
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
    for (const lastRow of await page
      .locator('.panel-body > :is(.form-row, .plan-cut):last-child')
      .all()) {
      await expect(lastRow).toHaveCSS('margin-bottom', '0px');
    }
    await page.screenshot({
      path: testInfo.outputPath(`${name}-spacing.png`),
      fullPage: true,
    });
  }
});

test('help icons keep measurement labels aligned in station forms', async ({
  page,
}, testInfo) => {
  await mockApi(page, {
    role: 'production',
    stations: ['cutting'],
  });
  await page.goto(`/stations/cutting/${ids.order}`);
  await pickEmployee(page, 'Alex Reed');
  await page.getByRole('button', { name: 'Begin cutting' }).click();
  await page
    .getByLabel('What happened to this stock item?')
    .selectOption('returned-roll');
  const tube = page.getByLabel('Tube outer diameter (mm)');
  await expect(tube).toBeVisible();
  const field = page.locator('.field').filter({ has: tube });
  await expect(field.locator('.field-label')).toHaveCSS('height', '24px');
  await expect(field.locator('.info-tip')).toHaveCSS('height', '24px');
  await page.screenshot({
    path: testInfo.outputPath('station-form-spacing.png'),
    fullPage: true,
  });
});
