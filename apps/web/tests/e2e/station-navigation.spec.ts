import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';

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
      page.getByRole('button', { name: 'Change station', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Stations', exact: true }),
    ).toHaveCount(0);
    if (station.value === 'cutting') {
      await expect(
        page.getByRole('link', { name: 'Open cutting sheet' }),
      ).toBeVisible();
    } else {
      await page
        .getByLabel('Completed by', { exact: true })
        .selectOption(state.employees[0]!.id);
      await page
        .getByRole('button', {
          name: `Mark 104801 ${station.action}`,
          exact: true,
        })
        .click();
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
  await expect(choices.getByRole('link')).toHaveText(['Assembly', 'Shipping']);
  await expect(page.getByLabel('Completed by', { exact: true })).toHaveCount(0);
  expect(queues).toHaveLength(0);
  await page.screenshot({
    path: info.outputPath('station-choices.png'),
    fullPage: true,
  });
  await choices.getByRole('link', { name: 'Shipping' }).click();
  await expect(page).toHaveURL(/station=shipping/);
  await expect(
    page.getByRole('heading', { name: 'Shipping station' }),
  ).toBeVisible();
  await expect.poll(() => queues).toContain('/api/production/shipping/orders');
});

test('changing stations requires confirmation and resets attribution and filters', async ({
  page,
}, info) => {
  const state = await mockApi(page, {
    role: 'production',
    stations: ['shipping', 'assembly'],
  });
  await page.goto('/stations?station=shipping&view=all&search=104801');
  const employee = page.getByLabel('Completed by', { exact: true });
  await employee.selectOption(state.employees[0]!.id);
  await page
    .getByRole('button', { name: 'Change station', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Change station' });
  await expect(
    dialog.getByRole('button', { name: 'Switch station', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel('Switch to station').locator('option'),
  ).toHaveText(['Choose station', 'Assembly']);
  await dialog.getByLabel('Switch to station').selectOption('assembly');
  await expect(
    dialog.getByText('New completions will be recorded as assembled.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/station=shipping/);
  await page.screenshot({
    path: info.outputPath('change-station.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(employee).toHaveValue(state.employees[0]!.id);
  await expect(page.getByLabel('Find order')).toHaveValue('104801');
  await page
    .getByRole('button', { name: 'Change station', exact: true })
    .click();
  await expect(dialog.getByLabel('Switch to station')).toHaveValue('');
  await dialog.getByLabel('Switch to station').selectOption('assembly');
  await dialog
    .getByRole('button', { name: 'Switch to Assembly', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Assembly station' }),
  ).toBeVisible();
  await expect(employee).toHaveValue('');
  await expect(page.getByLabel('Find order')).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Work queue', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Mark 104801 assembled', exact: true }),
  ).toBeDisabled();
  await employee.selectOption(state.employees[0]!.id);
  await page
    .getByRole('button', { name: 'Mark 104801 assembled', exact: true })
    .click();
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
  await expect(page.getByLabel('Completed by', { exact: true })).toBeVisible();
  const stationWidth = (await page.locator('.station-workspace').boundingBox())!
    .width;
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
