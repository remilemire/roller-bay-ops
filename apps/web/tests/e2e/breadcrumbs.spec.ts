import { expect, test } from '@playwright/test';
import { ids, mockApi, pickEmployee } from './fixtures';

const sections = [
  ['/', 'Overview'],
  ['/stock-items', 'Fabric stock'],
  ['/stock-receipts', 'Stock receipts'],
  ['/work-orders', 'Work orders'],
  ['/allocations', 'Allocations'],
  ['/stations?station=cutting', 'Stations'],
  ['/fabric-catalog', 'Fabric catalog'],
  ['/locations', 'Locations'],
  ['/users', 'Users'],
  ['/settings', 'Settings'],
] as const;

test('top-level pages name their section without a back link', async ({
  page,
}) => {
  await mockApi(page);
  for (const [path, label] of sections) {
    await page.goto(path);
    const crumbs = page.getByRole('navigation', {
      name: 'Breadcrumb',
      exact: true,
    });
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(label);
    await expect(crumbs.getByRole('link')).toHaveCount(0);
  }
});

test('detail, creation and station pages link their section and use their loaded title', async ({
  page,
}) => {
  await mockApi(page);
  for (const [path, parent, label] of [
    [`/stock-items/${ids.stock}`, '/stock-items', 'Fabric stock'],
    [`/stock-receipts/${ids.receipt}`, '/stock-receipts', 'Stock receipts'],
    ['/stock-receipts/new', '/stock-receipts', 'Stock receipts'],
    [`/work-orders/${ids.order}`, '/work-orders', 'Work orders'],
    [`/allocations/${ids.allocation}`, '/allocations', 'Allocations'],
    ['/allocations/new', '/allocations', 'Allocations'],
    [
      `/allocations/${ids.allocation}?action=record-cutting-results`,
      '/allocations',
      'Allocations',
    ],
    ['/stations/employees', '/stations', 'Stations'],
    ['/stations/review', '/stations', 'Stations'],
    [`/stations/cutting/${ids.order}`, '/stations', 'Stations'],
  ]) {
    await page.goto(path!);
    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible();
    const crumbs = page.getByRole('navigation', {
      name: 'Breadcrumb',
      exact: true,
    });
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(
      (await heading.textContent())!,
    );
    await expect(
      crumbs.getByRole('link', { name: label!, exact: true }),
    ).toHaveAttribute('href', parent!);
    await expect(
      crumbs.getByRole('link', { name: 'Back', exact: true }),
    ).toHaveAttribute('href', parent!);
  }
});

test('printed cutting sheet links both its allocation and allocation list', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`/allocations/${ids.allocation}/cutting-sheet`);
  const crumbs = page.getByRole('navigation', {
    name: 'Breadcrumb',
    exact: true,
  });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText(
    'Cutting sheet',
  );
  await expect(
    crumbs.getByRole('link', { name: '104801', exact: true }),
  ).toHaveAttribute('href', `/allocations/${ids.allocation}`);
  await crumbs.getByRole('link', { name: '104801', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/allocations/${ids.allocation}$`));
  await crumbs.getByRole('link', { name: 'Allocations', exact: true }).click();
  await expect(page).toHaveURL(/\/allocations(?:\?|$)/);
});

test('Back preserves list filters after in-app navigation and direct entry falls back to the parent', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/work-orders?view=list&status=open&search=104801');
  await page.getByRole('link', { name: '104801', exact: true }).click();
  const crumbs = page.getByRole('navigation', {
    name: 'Breadcrumb',
    exact: true,
  });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('104801');
  await crumbs.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(
    /\/work-orders\?view=list&status=open&search=104801$/,
  );
  await page.goto(`/work-orders/${ids.order}`);
  await crumbs.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/work-orders(?:\?|$)/);
  await expect(
    page.getByRole('heading', { name: 'Work orders', exact: true }),
  ).toBeVisible();
});

test('worksheet editing keeps the owning page title and Back protects dirty input', async ({
  page,
}) => {
  await mockApi(page, { role: 'production', stations: ['cutting'] });
  await page.goto(`/stations/cutting/${ids.order}`);
  await page
    .getByRole('button', { name: 'Begin cutting', exact: true })
    .click();
  await pickEmployee(page, 'Alex Reed', 'Cutters');
  await page
    .getByRole('button', { name: 'Start worksheet', exact: true })
    .click();
  const crumbs = page.getByRole('navigation', {
    name: 'Breadcrumb',
    exact: true,
  });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText(
    'Cutting · 104801',
  );
  await page
    .getByLabel('What happened to this stock item?')
    .selectOption('returned-roll');
  await page.getByLabel('Radial depth (mm)').fill('12');
  page.once('dialog', (dialog) => dialog.dismiss());
  await crumbs.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/stations/cutting/${ids.order}$`));
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('12');
  page.once('dialog', (dialog) => dialog.accept());
  await crumbs.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/stations(?:\?|$)/);
});
