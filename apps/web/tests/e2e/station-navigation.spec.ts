import { test, expect } from '@playwright/test';
import { mockApi, pickEmployee, selectedEmployee } from './fixtures';

const stations = [
  { value: 'cutting', label: 'Cutting', action: 'cut' },
  { value: 'assembly', label: 'Assembly', action: 'assembled' },
  { value: 'checking', label: 'Checking', action: 'checked' },
  { value: 'shipping', label: 'Shipping', action: 'shipped' },
] as const;

for (const station of stations) {
  test(`${station.label}-only accounts cannot switch stations`, async ({
    page,
  }) => {
    const state = await mockApi(page, {
      role: 'production',
      stations: [station.value],
    });
    // An old or manually changed URL must not select an unassigned station.
    const other = station.value === 'cutting' ? 'shipping' : 'cutting';
    await page.goto(`/stations?station=${other}`);
    await expect(
      page.getByRole('heading', { name: `${station.label} station` }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Change station', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Stations', exact: true }),
    ).toHaveCount(0);
    if (station.value === 'cutting') {
      await expect(
        page.getByRole('button', { name: 'Record cutting', exact: true }),
      ).toBeVisible();
    } else {
      await page
        .getByRole('button', {
          name: `Mark 104801 ${station.action}`,
          exact: true,
        })
        .click();
      await pickEmployee(page.getByRole('dialog'), 'Alex Reed');
      await page.getByRole('button', { name: 'Record completion' }).click();
      expect(state.productionRequests.at(-1)?.path).toContain(
        `/production/${station.value}/orders/`,
      );
    }
  });
}

test('accounts with several stations choose one before working', async ({
  page,
}, info) => {
  await mockApi(page, {
    role: 'production',
    stations: ['shipping', 'assembly'],
  });
  const queues: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/production\/\w+\/orders$/.test(path)) queues.push(path);
  });
  // An unassigned station asks again instead of opening another one.
  await page.goto('/stations?station=cutting');
  const choices = page.getByRole('navigation', { name: 'Choose station' });
  await expect(choices.getByRole('link')).toHaveText([
    /^Assembly.*in queue$/,
    /^Shipping.*in queue$/,
  ]);
  await expect(
    page.getByRole('combobox', { name: 'Completed by' }),
  ).toHaveCount(0);
  // Cards count only assigned stations' queues.
  expect([...new Set(queues)].sort()).toEqual([
    '/api/production/assembly/orders',
    '/api/production/shipping/orders',
  ]);
  await page.screenshot({
    path: info.outputPath('station-choices.png'),
    fullPage: true,
  });
  await choices.getByRole('link', { name: 'Shipping' }).click();
  await expect(page).toHaveURL(/station=shipping/);
  await expect(
    page.getByRole('heading', { name: 'Shipping station' }),
  ).toBeVisible();
});

test('changing stations returns to the station choices and resets attribution and filters', async ({
  page,
}) => {
  const state = await mockApi(page, {
    role: 'production',
    stations: ['shipping', 'assembly'],
  });
  await page.goto('/stations?station=shipping&view=all&search=104801');
  await page.getByRole('button', { name: 'Mark 104801 shipped' }).click();
  await pickEmployee(page, 'Alex Reed');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Change station', exact: true }).click();
  await expect(page).toHaveURL(/\/stations$/);
  await page
    .getByRole('navigation', { name: 'Choose station' })
    .getByRole('link', { name: /^Assembly/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Assembly station' }),
  ).toBeVisible();
  await expect(selectedEmployee(page, 'Alex Reed')).toHaveCount(0);
  await expect(
    page.getByRole('searchbox', { name: 'Search order number…' }),
  ).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Work queue', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'Mark 104801 assembled', exact: true })
    .click();
  await expect(selectedEmployee(page, 'Alex Reed')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Record completion' }),
  ).toBeDisabled();
  await pickEmployee(page, 'Alex Reed');
  await page.getByRole('button', { name: 'Record completion' }).click();
  expect(state.productionRequests).toHaveLength(1);
  expect(state.productionRequests[0]!.path).toContain(
    '/production/assembly/orders/',
  );
});

test('station layout uses the same content width as other workspace pages', async ({
  page,
}, info) => {
  await mockApi(page);
  if (info.project.name === 'desktop')
    await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/stations?station=checking');
  await expect(
    page.getByRole('combobox', { name: 'Completed by' }),
  ).toHaveCount(0);
  const stationWidth = (await page.locator('.station-workspace').boundingBox())!
    .width;
  const stationTabHeight = (await page
    .locator('.toolbar .tab')
    .first()
    .boundingBox())!.height;
  await page.screenshot({
    path: info.outputPath('station-layout.png'),
    fullPage: true,
  });
  await page.goto('/work-orders?view=list');
  await expect(
    page.getByRole('heading', { name: 'Work orders', exact: true }),
  ).toBeVisible();
  const otherWidth = (await page.locator('.page-heading').boundingBox())!.width;
  expect(stationWidth).toBeCloseTo(otherWidth, 0);
  await page.goto('/stock-receipts');
  await expect(
    page.getByRole('heading', { name: 'Stock receipts', exact: true }),
  ).toBeVisible();
  const standardTabHeight = (await page
    .locator('.toolbar .tab')
    .first()
    .boundingBox())!.height;
  expect(stationTabHeight).toBe(standardTabHeight);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('station search and views use the shared list toolbar', async ({
  page,
}) => {
  await mockApi(page, { role: 'production', stations: ['cutting'] });
  await page.goto('/stations');
  const toolbar = page.locator('.station-workspace .toolbar');
  const search = toolbar.getByRole('searchbox', {
    name: 'Search order number…',
  });
  await expect(search).toHaveAttribute('inputmode', 'numeric');
  await expect(
    toolbar.getByRole('button', { name: 'Search', exact: true }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole('group', { name: 'Order view' }),
  ).toBeVisible();
  await search.fill('104801');
  await search.press('Enter');
  await expect(page).toHaveURL(/search=104801/);
  await expect(
    toolbar.getByRole('button', { name: 'All allocated orders' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: 'Completed today' }).click();
  await expect(search).toHaveValue('');
  await expect(page).toHaveURL(/view=completed/);
  await expect(
    toolbar.getByRole('button', { name: 'Completed today' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('station actions and completion forms use consistent compact buttons', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.goto('/stock-receipts');
  const standard = page.getByRole('link', { name: 'New receipt', exact: true });
  await expect(standard).toBeVisible();
  const standardHeight = (await standard.boundingBox())!.height;
  for (const station of stations) {
    await page.goto(`/stations?station=${station.value}`);
    const trigger = page.getByRole('button', {
      name:
        station.value === 'cutting'
          ? 'Record cutting'
          : `Mark 104801 ${station.action}`,
      exact: true,
    });
    await expect(trigger).toBeVisible();
    const triggerBox = (await trigger.boundingBox())!;
    expect(triggerBox.height).toBe(standardHeight);
    expect(triggerBox.width).toBeLessThan(300);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', {
      name: station.value === 'cutting' ? 'Sign off only' : 'Record completion',
      exact: true,
    });
    await expect(submit).toBeVisible();
    const submitBox = (await submit.boundingBox())!;
    expect(submitBox.height).toBe(standardHeight);
    expect(submitBox.width).toBeLessThan(300);
    if (station.value === 'cutting') {
      const worksheet = dialog.getByRole('link', {
        name: 'Use worksheet',
        exact: true,
      });
      expect((await worksheet.boundingBox())!.height).toBe(standardHeight);
    }
    await page.screenshot({
      path: info.outputPath(`${station.value}-completion-buttons.png`),
    });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
  }
});
