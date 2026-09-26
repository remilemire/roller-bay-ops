import { test, expect } from '@playwright/test';
import { ids, mockApi, pickEmployee } from './fixtures';
test('admins schedule and ship orders, and delete only unused orders', async ({
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

  // An order that still needs fabric is scheduled as a back order, or its
  // row opens the entry screen on it.
  const unallocated = page.getByRole('row', { name: /104877/ });
  await expect(unallocated).toContainText('new');
  await expect(
    unallocated.getByRole('button', { name: 'Schedule order 104877' }),
  ).toBeVisible();
  await unallocated
    .getByRole('link', { name: 'Allocate order 104877' })
    .click();
  await expect(page).toHaveURL(/\/allocations\/new\?workOrder=/);
  await expect(
    page.getByRole('heading', { name: 'Allocate 104877' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add blind', exact: true }),
  ).toBeEnabled();
  // Opening an order to plan writes nothing.
  expect(state.orderRequests).toEqual([]);
  await page.goBack();

  await page.getByRole('button', { name: 'Shipped', exact: true }).click();
  await expect(page).toHaveURL(/status=shipped/);
  await expect(page.getByText('No orders here')).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  await existing.getByRole('link', { name: '104801' }).click();
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
  expect(state.orderRequests).toEqual([
    { method: 'PATCH', body: { expectedRevision: 3, shipDate: '2026-10-06' } },
  ]);
  // Milestones are recorded at the stations; an admin corrects them here.
  await page
    .getByRole('button', { name: 'Correct shipped record', exact: true })
    .click();
  const correction = page.getByRole('dialog', { name: /Correct shipped/ });
  await pickEmployee(correction, 'Alex Reed');
  await correction
    .getByLabel('Actual completion time')
    .fill('2026-10-06T09:00');
  await correction
    .getByLabel('Reason', { exact: true })
    .fill('Shipped without a station');
  await correction.getByRole('button', { name: 'Save correction' }).click();
  await expect(correction).toHaveCount(0);
  await expect(page.getByText(/^Alex Reed \(AR\) · /)).toBeVisible();
  expect(state.productionRequests).toEqual([
    {
      path: `/production/shipping/orders/${ids.order}/corrections`,
      body: expect.objectContaining({
        employeeIds: [state.employees[0]!.id],
        reason: 'Shipped without a station',
      }),
    },
  ]);

  await expect(
    page.getByRole('button', { name: 'Delete', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel work order', exact: true }),
  ).not.toBeVisible();
  const unused = state.orders.find((o) => o.orderNumber === '104877')!;
  await page.goto(`/work-orders/${unused.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(/\/work-orders$/);
  expect(state.orderRequests.at(-1)).toEqual({
    method: 'DELETE',
    body: { expectedRevision: unused.revision },
  });
  await page.goto('/work-orders?view=list');
  await expect(page.getByRole('row', { name: /104877/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('work orders reach attributed shipping through station navigation', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/work-orders?view=list');
  await expect(
    page.getByRole('link', { name: 'Record production' }),
  ).toHaveCount(0);
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Stations', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Choose station' })
    .getByRole('link', { name: /^Shipping/ })
    .click();
  await page
    .getByRole('searchbox', { name: 'Search order number…' })
    .fill('104801');
  await expect(page).toHaveURL(/stations\?station=shipping&search=104801/);
  await page.getByRole('button', { name: 'Mark 104801 shipped' }).click();
  const dialog = page.getByRole('dialog');
  await pickEmployee(dialog, 'Alex Reed');
  await dialog.getByRole('button', { name: 'Record completion' }).click();
  await expect(page.getByText(/shipped · Alex Reed/)).toBeVisible();
  expect(state.orders.find((o) => o.id === ids.order)!.cutAt).toBeNull();
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
  await expect(page.getByText('1 order · 1 blind · 1 scheduled')).toBeVisible();
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
  await expect(tray).toContainText(
    'No allocated or back-ordered orders are waiting',
  );
  const drag = async (
    source: ReturnType<typeof day>,
    target: ReturnType<typeof day>,
    place: string,
  ) => {
    // One move at a time: a press is ignored while the last move is saving
    // or its card is still settling, so press until the board announces the
    // pickup, which it does by saying where the card is.
    await expect(async () => {
      await page.mouse.up();
      const start = (await source
        .getByRole('link', { name: '104801' })
        .boundingBox())!;
      await page.mouse.move(start.x + 8, start.y + 8);
      await page.mouse.down();
      await page.mouse.move(start.x + 20, start.y + 20, { steps: 4 });
      await expect(announced).toHaveText(/^Order 104801 over /, {
        timeout: 500,
      });
    }).toPass();
    const end = (await target.boundingBox())!;
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 12,
    });
    // Let go once the board has registered where the card is, as a person
    // would: a release in the same instant as the arrival can come first.
    await expect(announced).toHaveText(`Order 104801 over ${place}.`);
    await page.mouse.up();
    await expect(target.getByRole('link', { name: '104801' })).toBeVisible();
  };
  await drag(day('Thu, Oct 1, 2026'), tray, 'the orders to schedule');
  await expect(tray).toContainText('1 order · 1 blind');
  await expect(page.getByText('0 orders · 0 blinds').first()).toBeVisible();
  await drag(tray, day('Mon, Sep 28, 2026'), 'Mon, Sep 28, 2026');
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
  await dialog.getByRole('button', { name: 'Unschedule' }).click();
  await expect(row).toContainText('allocated');
  await expect(
    page.getByRole('button', { name: 'Schedule order 104801' }),
  ).toBeVisible();
  expect(state.orderRequests).toEqual([
    { method: 'PATCH', body: { expectedRevision: 3, shipDate: '2026-10-07' } },
    { method: 'PATCH', body: { expectedRevision: 4, shipDate: null } },
  ]);
});
test('admins schedule an order without fabric as a back order', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00-06:00'));
  await page.goto('/work-orders?view=list');
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Schedule order 104877' }).click();
  await dialog.getByLabel('PO numbers').fill('43142, 43150');
  await dialog.getByLabel('Ship date').click();
  await dialog.getByRole('button', { name: 'Fri, Oct 2, 2026' }).click();
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.orderRequests).toEqual([
    {
      method: 'PATCH',
      body: {
        expectedRevision: 3,
        shipDate: '2026-10-02',
        backOrder: { purchaseOrderNumbers: ['43142', '43150'] },
      },
    },
  ]);
  // It goes on the week board with the fabric it waits on.
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  const friday = page.getByRole('region', { name: 'Fri, Oct 2, 2026' });
  await expect(friday).toContainText('104877');
  await expect(friday).toContainText('Back order · awaiting PO 43142, 43150');
});

test('an order is found from the week board, whether or not it is on it', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/work-orders?week=2026-10-12');
  const find = page.getByRole('searchbox', { name: 'Find order number…' });
  await find.fill('1048');
  await find.press('Enter');
  await expect(page).toHaveURL(/search=1048/);
  await expect(
    page.getByText('Nothing on this page matches 1048.'),
  ).toBeVisible();
  // One match still needs fabric; the other ships in another week.
  await expect(
    page.getByRole('link', { name: '104877 · to allocate' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '104801 · Fri, Oct 2, 2026' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeVisible();
  await expect(page.getByText('1 order marked on this page.')).toBeVisible();
  await expect(page.locator('.order-card.is-match')).toContainText('104801');
});
test('the overview counts the order queues and lists the orders shipping this week', async ({
  page,
}) => {
  await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00-06:00'));
  await page.goto('/');
  const toAllocate = page.getByRole('link', { name: /Orders to allocate/ });
  await expect(toAllocate).toContainText('1');
  await expect(toAllocate).toHaveAttribute(
    'href',
    '/work-orders?view=list&status=new',
  );
  await expect(
    page.getByRole('link', { name: /Orders to schedule/ }),
  ).toContainText('0');
  const week = page.locator('section', { hasText: 'Shipping this week' });
  await expect(week.getByRole('row', { name: /104801/ })).toContainText(
    'Fri, Oct 2, 2026',
  );
  // An order with no ship date is not the week's.
  await expect(week.getByRole('row', { name: /104877/ })).toHaveCount(0);
  await week.getByRole('link', { name: 'Open schedule' }).click();
  await expect(
    page.getByRole('heading', { name: 'Work orders' }),
  ).toBeVisible();
});
test('employees read work orders without admin actions', async ({ page }) => {
  const state = await mockApi(page, { role: 'staff' });
  await page.goto('/work-orders?view=list');
  await expect(page.getByRole('row', { name: /104801/ })).toBeVisible();
  // Adding an order is open to them, without a note. It stays on the
  // schedule, waiting for fabric; nothing is allocated.
  await page.getByRole('button', { name: 'New order' }).click();
  const adding = page.getByRole('dialog', { name: 'Add order' });
  await expect(adding.getByLabel('Note')).toHaveCount(0);
  await adding.getByLabel('Order number').fill('104950');
  await adding.getByLabel('Blinds').fill('6');
  await adding.getByRole('button', { name: 'Add order' }).click();
  await expect(adding).toHaveCount(0);
  await expect(page).toHaveURL(/\/work-orders\?view=list$/);
  expect(state.orderRequests).toEqual([
    {
      method: 'POST',
      body: {
        orderNumber: '104950',
        quantity: 6,
        note: null,
        backOrder: null,
        shipDate: null,
      },
    },
  ]);
  expect(state.allocationRequests).toEqual([]);
  await expect(
    page.getByRole('link', { name: 'Allocate order 104877' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Mark order|chedule order/ }),
  ).toHaveCount(0);
  await page.goto(`/work-orders/${ids.order}`);
  await expect(page.getByRole('heading', { name: '104801' })).toBeVisible();
  for (const name of ['Edit', 'Reschedule', 'Mark shipped', 'Delete'])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  // The calendar views are read-only for them.
  await page.goto('/work-orders?view=week&week=2026-10-02');
  await expect(page.getByRole('link', { name: '104801' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move order/ })).toHaveCount(0);
});
