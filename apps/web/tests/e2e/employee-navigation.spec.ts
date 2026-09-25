import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';

for (const role of ['admin', 'owner']) {
  test(`${role} manages employees from Stations with spaced search`, async ({
    page,
  }, info) => {
    const state = await mockApi(page, { role });
    state.employees = [];
    state.colorTheme = 'sand';
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/stations');
    await page.getByRole('link', { name: 'Manage employees' }).click();
    await expect(
      page.getByRole('heading', { name: 'Employees', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }),
    ).toContainText('Stations');
    const search = page.getByRole('searchbox', { name: 'Find employee…' });
    await expect(search).toBeVisible();
    await expect(
      page.getByText('Add employees so stations can attribute completed work.'),
    ).toBeVisible();
    const field = (await search.boundingBox())!;
    const panel = (await page.locator('section.panel').boundingBox())!;
    expect(panel.y - field.y - field.height).toBeGreaterThanOrEqual(16);
    await page.screenshot({
      path: info.outputPath('employee-directory.png'),
      fullPage: true,
    });
    await page.goto('/settings');
    await expect(
      page.getByRole('link', { name: 'Manage employees' }),
    ).toHaveCount(0);
    await page.goto('/settings/employees');
    await expect(page).toHaveURL(/stations\/employees$/);
  });
}

test('production accounts have no employee management action or directory access', async ({
  page,
}) => {
  await mockApi(page, { role: 'production', stations: ['shipping'] });
  let directoryRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/employees')
      directoryRequests++;
  });
  await page.goto('/stations');
  await expect(
    page.getByRole('button', { name: 'Mark 104801 shipped' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Manage employees' }),
  ).toHaveCount(0);
  await page.goto('/stations/employees');
  await expect(page).toHaveURL(/stations$/);
  await expect(page.getByRole('button', { name: 'Add employee' })).toHaveCount(
    0,
  );
  expect(directoryRequests).toBe(0);
});
