import { test, expect } from '@playwright/test';
import { ids, mockApi } from './fixtures';
test('admins schedule, edit, ship, and delete an order from the schedule', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  // The date calendar opens on the current month.
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00'));
  await page.goto('/');
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Order schedule', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Order schedule' }),
  ).toBeVisible();
  // The schedule opens on the week of the fixed clock.
  await expect(
    page.getByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  const existing = page.getByRole('row', { name: /104801/ });
  await expect(existing).toContainText('Fri, Oct 2, 2026');
  await expect(existing).toContainText('allocated');

  await page.getByRole('button', { name: 'Add order' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Order number').fill('104900');
  await dialog.getByLabel('Blinds').fill('8');
  // Dates are picked from a weekday calendar rather than typed.
  await dialog.getByRole('button', { name: 'Ship date' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Sat, Oct 3, 2026' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Next month' }).click();
  await dialog.getByRole('button', { name: 'Fri, Oct 9, 2026' }).click();
  await dialog.getByLabel('Note').fill('Motorised');
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(dialog).toBeHidden();
  expect(state.orderRequests).toEqual([
    {
      method: 'POST',
      body: {
        orderNumber: '104900',
        shipDate: '2026-10-09',
        quantity: 8,
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
  await dialog.getByRole('button', { name: 'Ship date' }).click();
  await dialog.getByRole('button', { name: 'Tue, Oct 6, 2026' }).click();
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
  await page.goto('/order-schedule?view=list');
  await expect(page.getByRole('row', { name: /104801/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('admins mark an order shipped from its row and it leaves the open list', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/order-schedule?view=list');
  await page.getByRole('button', { name: 'Mark order 104877 shipped' }).click();
  await expect(page.getByRole('row', { name: /104877/ })).toHaveCount(0);
  expect(state.orderRequests).toEqual([
    { method: 'PATCH', body: { expectedRevision: 3, shipped: true } },
  ]);
  await page.getByRole('button', { name: 'Shipped', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Mark order 104877 not shipped' }),
  ).toBeVisible();
});
test('admins drag an order to another day of the week, by mouse and by keyboard', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00'));
  await page.goto('/order-schedule');
  await expect(
    page.getByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeVisible();
  await expect(
    page.getByText('1 order · 14 blinds · 1 allocated'),
  ).toBeVisible();
  const day = (name: string) => page.getByRole('region', { name });
  const card = day('Fri, Oct 2, 2026').getByRole('link', { name: '104801' });
  await expect(card).toBeVisible();

  const from = (await card.boundingBox())!;
  const to = (await day('Wed, Sep 30, 2026').boundingBox())!;
  await page.mouse.move(from.x + 8, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(
    day('Wed, Sep 30, 2026').getByRole('link', { name: '104801' }),
  ).toBeVisible();
  expect(state.orderRequests).toEqual([
    { method: 'PATCH', body: { expectedRevision: 3, shipDate: '2026-09-30' } },
  ]);

  // One move at a time: wait for the first to be saved.
  await expect(page.getByText('Rescheduled.')).toBeAttached();
  // The handle moves an order a whole day per arrow key.
  await page
    .getByRole('button', { name: 'Move order 104801 to another day' })
    .focus();
  // The drag announces each step. It starts listening for arrow keys a moment
  // after pickup, sooner than a person types but not than a test, so press
  // again only while the announcement has not moved on.
  const announced = page.locator('[id^="DndLiveRegion"]');
  await page.keyboard.press('Space');
  await expect(announced).toHaveText('Order 104801 over Wed, Sep 30, 2026.');
  const thursday = 'Order 104801 over Thu, Oct 1, 2026.';
  await expect(async () => {
    if ((await announced.textContent()) !== thursday)
      await page.keyboard.press('ArrowRight');
    await expect(announced).toHaveText(thursday, { timeout: 500 });
  }).toPass();
  await page.keyboard.press('Space');
  await expect(
    day('Thu, Oct 1, 2026').getByRole('link', { name: '104801' }),
  ).toBeVisible();
  expect(state.orderRequests.at(-1)).toEqual({
    method: 'PATCH',
    body: { expectedRevision: 4, shipDate: '2026-10-01' },
  });

  // A click that does not drag still opens the order.
  await day('Thu, Oct 1, 2026').getByRole('link', { name: '104801' }).click();
  await expect(page).toHaveURL(new RegExp(`/order-schedule/${ids.order}$`));
});
test('admins add an order to a day of the month', async ({ page }) => {
  const state = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00'));
  await page.goto('/order-schedule?view=month&month=2026-10');
  const dialog = page.getByRole('dialog');
  await page
    .getByRole('button', { name: 'Add order on Wed, Oct 21, 2026' })
    .click();
  await expect(dialog.getByRole('button', { name: 'Ship date' })).toHaveText(
    'Wed, Oct 21, 2026',
  );
  await dialog.getByLabel('Order number').fill('104950');
  await dialog.getByLabel('Blinds').fill('20');
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(
    page
      .getByRole('gridcell', { name: 'Wed, Oct 21, 2026' })
      .getByRole('link', { name: /104950/ }),
  ).toBeVisible();
  expect(state.orderRequests).toEqual([
    {
      method: 'POST',
      body: {
        orderNumber: '104950',
        shipDate: '2026-10-21',
        quantity: 20,
        note: null,
      },
    },
  ]);
});
test('admins reschedule an order from its list row', async ({ page }) => {
  const state = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00'));
  await page.goto('/order-schedule?view=list');
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Reschedule order 104877' }).click();
  // The calendar is already open on the order's month.
  await dialog.getByRole('button', { name: 'Wed, Oct 7, 2026' }).click();
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(page.getByRole('row', { name: /104877/ })).toContainText(
    'Wed, Oct 7, 2026',
  );
  expect(state.orderRequests.at(-1)).toEqual({
    method: 'PATCH',
    body: { expectedRevision: 3, shipDate: '2026-10-07' },
  });
});
test('employees read the schedule and an order without admin actions', async ({
  page,
}) => {
  await mockApi(page, { role: 'user' });
  await page.goto('/order-schedule?view=list');
  await expect(page.getByRole('row', { name: /104801/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add order' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mark order/ })).toHaveCount(0);
  await page.goto(`/order-schedule/${ids.order}`);
  await expect(page.getByRole('heading', { name: '104801' })).toBeVisible();
  for (const name of ['Edit', 'Mark shipped', 'Delete'])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  // The calendar views are read-only for them.
  await page.goto('/order-schedule?view=week&week=2026-10-02');
  await expect(page.getByRole('link', { name: '104801' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move order/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add order/ })).toHaveCount(0);
});
