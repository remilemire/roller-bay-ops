import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';
test('admins reach the user directory from navigation and confirm a role change', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/');
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  const own = page.getByRole('row', { name: /Jamie Chen/ });
  await expect(own.getByRole('button')).toHaveCount(0);
  const row = page.getByRole('row', { name: /Robin Park/ });
  await expect(
    row.getByRole('button', { name: 'Transfer ownership' }),
  ).toHaveCount(0);
  await row.getByRole('button', { name: 'Change role' }).click();
  expect(state.userRequests).toEqual([]);
  const dialog = page.getByRole('dialog');
  const role = dialog.getByRole('combobox', { name: 'Role' });
  await role.selectOption('production');
  await expect(
    dialog.getByRole('group', { name: 'Allowed stations' }),
  ).toBeVisible();
  await role.selectOption('admin');
  await expect(
    dialog.getByRole('group', { name: 'Allowed stations' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save role' }).click();
  await expect(row.getByText('admin', { exact: true })).toBeVisible();
  expect(state.userRequests).toEqual([{ role: 'admin', stations: [] }]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('ordinary users have no Users link and no directory request', async ({
  page,
}, testInfo) => {
  await mockApi(page, { role: 'staff' });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/users');
  await expect(page.getByText('Admins only')).toBeVisible();
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  expect(requests.filter((url) => /\/api\/users(\?|$)/.test(url))).toEqual([]);
});
