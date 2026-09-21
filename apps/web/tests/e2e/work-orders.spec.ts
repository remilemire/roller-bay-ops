import { test, expect } from '@playwright/test';
import { ids, mockApi } from './fixtures';
test('admins add, schedule, ship, and delete work orders', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  // The date calendar opens on the current month.
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00-06:00'));
  await page.goto('/');
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Work orders', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Work orders' }),
  ).toBeVisible();
  // The page opens on the week of the fixed clock.
  await expect(
    page.getByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  const existing = page.getByRole('row', { name: /104801/ });
  await expect(existing).toContainText('Fri, Oct 2, 2026');
  await expect(existing).toContainText('scheduled');

  await page.getByRole('button', { name: 'Add order' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Order number').fill('104900');
  // Its blinds are entered where its fabric is allocated, and its ship date
  // follows that.
  await expect(dialog.getByLabel('Blinds')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Ship date' })).toHaveCount(
    0,
  );
  await dialog.getByLabel('Note').fill('Motorised');
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(dialog).toBeHidden();
  expect(state.orderRequests).toEqual([
    {
      method: 'POST',
      body: { orderNumber: '104900', note: 'Motorised' },
    },
  ]);
  const added = page.getByRole('row', { name: /104900/ });
  await expect(added).toContainText('new');
  // With no allocation it cannot be scheduled yet.
  await expect(added.getByRole('button', { name: /chedule/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Shipped', exact: true }).click();
  await expect(page).toHaveURL(/status=shipped/);
  await expect(page.getByText('No orders here')).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  await existing.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/work-orders/${ids.order}$`));
  await expect(page.getByRole('heading', { name: '104801' })).toBeVisible();
  // Dates are picked from a weekday calendar, already open, rather than typed.
  await page.getByRole('button', { name: 'Reschedule' }).click();
  const reschedule = page.getByRole('dialog', { name: /Reschedule order/ });
  await expect(
    reschedule.getByRole('button', { name: 'Sat, Oct 3, 2026' }),
  ).toHaveCount(0);
  await reschedule.getByRole('button', { name: 'Tue, Oct 6, 2026' }).click();
  await reschedule
    .getByRole('button', { name: 'Reschedule', exact: true })
    .click();
  await expect(page.getByText('Ships Tue, Oct 6, 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Mark shipped' }).click();
  await expect(
    page.getByRole('button', { name: 'Mark not shipped' }),
  ).toBeVisible();
  expect(state.orderRequests.slice(1)).toEqual([
    {
      method: 'PATCH',
      body: { expectedRevision: 3, shipDate: '2026-10-06' },
    },
    { method: 'PATCH', body: { expectedRevision: 4, shipped: true } },
  ]);

  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/work-orders$/);
  expect(state.orderRequests.at(-1)).toEqual({
    method: 'DELETE',
    body: { expectedRevision: 5 },
  });
  await page.goto('/work-orders?view=list');
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
  await page.goto('/work-orders?view=list');
  await page.getByRole('button', { name: 'Mark order 104801 shipped' }).click();
  await expect(page.getByRole('row', { name: /104801/ })).toHaveCount(0);
  expect(state.orderRequests).toEqual([
    { method: 'PATCH', body: { expectedRevision: 3, shipped: true } },
  ]);
  await page.getByRole('button', { name: 'Shipped', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Mark order 104801 not shipped' }),
  ).toBeVisible();
});
test('admins drag an order between days and the to-schedule tray, by mouse and by keyboard', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00-06:00'));
  await page.goto('/work-orders');
  await expect(
    page.getByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeVisible();
  await expect(
    page.getByText('1 order · 14 blinds · 1 scheduled'),
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
    .getByRole('button', { name: 'Move order 104801 to a day' })
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

  // Dropping it on the tray takes it off the schedule; from there it goes
  // onto a day again. A tray card is wider than a day, so the day under the
  // pointer, not the one nearest the card's centre, takes the drop.
  const tray = day('To schedule');
  await expect(tray).toContainText('No allocated orders are waiting');
  const drag = async (
    source: ReturnType<typeof day>,
    target: ReturnType<typeof day>,
  ) => {
    // One move at a time: the handle is disabled while the last one saves.
    await expect(
      page.getByRole('button', { name: 'Move order 104801 to a day' }),
    ).toBeEnabled();
    const start = (await source
      .getByRole('link', { name: '104801' })
      .boundingBox())!;
    const end = (await target.boundingBox())!;
    await page.mouse.move(start.x + 8, start.y + 8);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(target.getByRole('link', { name: '104801' })).toBeVisible();
  };
  await drag(day('Thu, Oct 1, 2026'), tray);
  await expect(tray).toContainText('1 order · 14 blinds');
  await expect(page.getByText('0 orders · 0 blinds').first()).toBeVisible();
  await drag(tray, day('Mon, Sep 28, 2026'));
  expect(state.orderRequests.slice(-2)).toEqual([
    { method: 'PATCH', body: { expectedRevision: 5, shipDate: null } },
    { method: 'PATCH', body: { expectedRevision: 6, shipDate: '2026-09-28' } },
  ]);

  // A click that does not drag still opens the order.
  await day('Mon, Sep 28, 2026').getByRole('link', { name: '104801' }).click();
  await expect(page).toHaveURL(new RegExp(`/work-orders/${ids.order}$`));
});
test('admins reschedule an order from its list row', async ({ page }) => {
  const state = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00-06:00'));
  await page.goto('/work-orders?view=list');
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Reschedule order 104801' }).click();
  // The calendar is already open on the order's month.
  await dialog.getByRole('button', { name: 'Wed, Oct 7, 2026' }).click();
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const row = page.getByRole('row', { name: /104801/ });
  await expect(row).toContainText('Wed, Oct 7, 2026');
  // Clearing the date takes it off the schedule; it stays allocated.
  await page.getByRole('button', { name: 'Reschedule order 104801' }).click();
  await dialog.getByRole('button', { name: 'Clear date' }).click();
  await expect(row).toContainText('allocated');
  await expect(
    page.getByRole('button', { name: 'Schedule order 104801' }),
  ).toBeVisible();
  expect(state.orderRequests).toEqual([
    { method: 'PATCH', body: { expectedRevision: 3, shipDate: '2026-10-07' } },
    { method: 'PATCH', body: { expectedRevision: 4, shipDate: null } },
  ]);
});
test('employees read work orders without admin actions', async ({ page }) => {
  await mockApi(page, { role: 'user' });
  await page.goto('/work-orders?view=list');
  await expect(page.getByRole('row', { name: /104801/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add order' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mark order/ })).toHaveCount(0);
  await page.goto(`/work-orders/${ids.order}`);
  await expect(page.getByRole('heading', { name: '104801' })).toBeVisible();
  for (const name of ['Edit', 'Reschedule', 'Mark shipped', 'Delete'])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  // The calendar views are read-only for them.
  await page.goto('/work-orders?view=week&week=2026-10-02');
  await expect(page.getByRole('link', { name: '104801' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move order/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add order/ })).toHaveCount(0);
});
