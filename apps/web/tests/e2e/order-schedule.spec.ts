import { test, expect } from '@playwright/test';
import { ids, mockApi } from './fixtures';
test('admins schedule, edit, ship, and delete an order from the schedule', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/');
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Order schedule', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Order schedule' }),
  ).toBeVisible();
  const existing = page.getByRole('row', { name: /104801/ });
  await expect(existing).toContainText('Fri, Oct 2, 2026');
  await expect(existing).toContainText('allocated');

  await page.getByRole('button', { name: 'Add order' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Order number').fill('104900');
  // A Saturday is refused before anything is sent.
  await dialog.getByLabel('Ship date').fill('2026-10-10');
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(dialog.getByText('Must be a weekday.')).toBeVisible();
  expect(state.orderRequests).toEqual([]);
  await dialog.getByLabel('Ship date').fill('2026-10-09');
  await dialog.getByLabel('Note').fill('Motorised');
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(dialog).toBeHidden();
  expect(state.orderRequests).toEqual([
    {
      method: 'POST',
      body: {
        orderNumber: '104900',
        shipDate: '2026-10-09',
        note: 'Motorised',
      },
    },
  ]);
  await expect(page.getByRole('row', { name: /104900/ })).toContainText(
    'Fri, Oct 9, 2026',
  );

  await page.getByRole('button', { name: 'Shipped', exact: true }).click();
  await expect(page).toHaveURL(/status=shipped/);
  await expect(page.getByText('No orders here')).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  await existing.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/order-schedule/${ids.order}$`));
  await expect(page.getByRole('heading', { name: '104801' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByLabel('Ship date').fill('2026-10-06');
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(page.getByText('Ships Tue, Oct 6, 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Mark shipped' }).click();
  await expect(
    page.getByRole('button', { name: 'Mark not shipped' }),
  ).toBeVisible();
  expect(state.orderRequests.slice(1)).toEqual([
    {
      method: 'PATCH',
      body: { expectedRevision: 3, shipDate: '2026-10-06', note: 'Rush' },
    },
    { method: 'PATCH', body: { expectedRevision: 4, shipped: true } },
  ]);

  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/order-schedule$/);
  expect(state.orderRequests.at(-1)).toEqual({
    method: 'DELETE',
    body: { expectedRevision: 5 },
  });
  await expect(page.getByRole('row', { name: /104801/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('employees read the schedule and an order without admin actions', async ({
  page,
}) => {
  await mockApi(page, { role: 'user' });
  await page.goto('/order-schedule');
  await expect(page.getByRole('row', { name: /104801/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add order' })).toHaveCount(0);
  await page.goto(`/order-schedule/${ids.order}`);
  await expect(page.getByRole('heading', { name: '104801' })).toBeVisible();
  for (const name of ['Edit', 'Mark shipped', 'Delete'])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
});
