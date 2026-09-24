import { test, expect } from '@playwright/test';
import type { Worksheet } from '@roller-bay/shared/production';
import { mockApi, ids } from './fixtures';
test('station login, whole-order attribution, and employee directory', async ({
  page,
}) => {
  const state = await mockApi(page, {
    role: 'production',
    stations: ['assembly'],
  });
  state.orders[0]!.shipDate = null;
  state.orders[0]!.scheduledAt = null;
  state.orders[0]!.status = 'allocated';
  await page.goto('/');
  await expect(page).toHaveURL(/stations$/);
  await expect(
    page.getByRole('heading', { name: 'Assembly station' }),
  ).toBeVisible();
  await expect(page.getByText(/Unscheduled/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mark 104801 assembled' }),
  ).toBeDisabled();
  await page
    .getByLabel('Completed by', { exact: true })
    .selectOption(state.employees[0]!.id);
  await page.getByRole('button', { name: 'Mark 104801 assembled' }).click();
  await page.getByRole('button', { name: 'All allocated orders' }).click();
  await expect(page.getByText(/assembled · Alex Reed/)).toBeVisible();
  expect(state.orders[0]!.cutAt).toBeNull();
  expect(state.orders[0]!.shipDate).toBeNull();
  await page.goto('/stock-items');
  await expect(page).toHaveURL(/stations$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('cutter saves a digital sheet, marks cut independently, and submits for office review', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page, {
    role: 'production',
    stations: ['cutting'],
  });
  await page.goto(`/stations/cutting/${ids.order}`);
  await page
    .getByLabel('Completed by', { exact: true })
    .selectOption(state.employees[0]!.id);
  await page.getByRole('button', { name: 'Begin cutting' }).click();
  await page.getByLabel('Cut 1 done').check();
  await page
    .getByRole('button', { name: 'Mark 104801 cut', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Cut recorded', exact: true }),
  ).toBeVisible();
  expect(state.completionRequests).toHaveLength(0);
  await page
    .getByLabel('What happened to this stock item?')
    .selectOption('returned-roll');
  await page.getByLabel('Tube outer diameter (mm)').fill('50');
  await page.getByLabel('Radial depth (mm)').fill('10');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByText('Progress saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Completed by', { exact: true })).toHaveValue(
    state.employees[0]!.id,
  );
  await expect(page.getByLabel('Cut 1 done')).toBeChecked();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('10');
  const discard = page.getByRole('button', { name: 'Discard changes' });
  await expect(discard).toBeDisabled();
  await page.getByLabel('Cut 1 done').uncheck();
  await page.getByLabel('Radial depth (mm)').fill('99');
  page.once('dialog', (dialog) => dialog.accept());
  await discard.click();
  await expect(page.getByLabel('Cut 1 done')).toBeChecked();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('10');
  await expect(discard).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('digital-cutting-sheet.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Review and submit results' }).click();
  await page
    .getByRole('button', { name: 'Submit results', exact: true })
    .click();
  await expect(page.getByText(/Results awaiting office review/)).toBeVisible();
  expect(state.worksheets[0]!.reviewedAt).toBeNull();
  expect(state.completionRequests).toHaveLength(0);
  state.role = 'admin';
  await page.goto('/stations/review');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page
    .getByLabel('Reason for returning or resolving results')
    .fill('Confirm measured depth');
  await page
    .getByRole('button', { name: 'Return for correction', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Accept and reconcile inventory' }),
  ).toBeDisabled();
  state.role = 'production';
  await page.goto(`/stations/cutting/${ids.order}`);
  await page.getByLabel('Radial depth (mm)').fill('12');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByText('Progress saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('12');
  await page.getByRole('button', { name: 'Review and submit results' }).click();
  await page
    .getByRole('button', { name: 'Submit results', exact: true })
    .click();
  await expect(page.getByText(/Results awaiting office review/)).toBeVisible();
  state.role = 'admin';
  await page.goto('/stations/review');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page
    .getByRole('button', { name: 'Accept and reconcile inventory' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Inventory reconciled', exact: true }),
  ).toBeVisible();
  expect(state.worksheets[0]!.reviewedAt).not.toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('admins maintain employees without creating application accounts', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/stations');
  await page.getByRole('link', { name: 'Manage employees' }).click();
  await expect(page).toHaveURL(/stations\/employees$/);
  await page.getByRole('button', { name: 'Add employee' }).click();
  await page.getByLabel('Full name').fill('Robin Park');
  await page.getByLabel('Initials', { exact: true }).fill('RP');
  await page.getByRole('button', { name: 'Save employee' }).click();
  await expect(page.getByRole('row', { name: /Robin Park/ })).toBeVisible();
  expect(state.employees).toHaveLength(2);
  await page
    .getByRole('row', { name: /Robin Park/ })
    .getByRole('button', { name: 'Edit' })
    .click();
  await page.getByLabel('Active', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save employee' }).click();
  await expect(page.getByRole('row', { name: /Robin Park/ })).toContainText(
    'inactive',
  );
});

function submittedSheet(state: Awaited<ReturnType<typeof mockApi>>): Worksheet {
  const employee = state.employees[0]!;
  return {
    id: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    allocationId: state.allocation.id,
    workOrderId: state.allocation.workOrderId,
    orderNumber: state.allocation.orderNumber,
    revision: 2,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeInitials: employee.initials,
    startedAt: '2026-09-16T12:00:00.000Z',
    abandonedAt: null,
    skippedAt: null,
    submittedAt: '2026-09-16T13:00:00.000Z',
    reviewedAt: null,
    startedByUserId: ids.user,
    submittedByUserId: ids.user,
    reviewedByUserId: null,
    snapshot: structuredClone(state.allocation),
    draft: null,
    results: {
      expectedRevision: state.allocation.revision,
      items: [
        {
          stockItemId: ids.stock,
          expectedRevision: state.allocation.items[0]!.stockItem.revision,
          outcome: 'returned-roll' as const,
          tubeOuterDiameterMm: 50,
          radialDepthMm: 10,
          locationId: ids.location,
          scraps: [],
        },
      ],
    },
  };
}

test('completion rejection permits another employee and a lost response can be retried after reload', async ({
  page,
}) => {
  const state = await mockApi(page, {
    role: 'production',
    stations: ['assembly'],
  });
  state.employees.push({
    ...state.employees[0]!,
    id: '33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Robin Park',
    initials: 'RP',
  });
  const attempts: { key: string | undefined; body: unknown }[] = [];
  await page.route(
    '**/production/assembly/orders/*/complete',
    async (route) => {
      attempts.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      if (attempts.length === 1)
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Employee is inactive.' }),
        });
      if (attempts.length === 2) return route.abort('failed');
      return route.fallback();
    },
  );
  await page.goto('/stations');
  await page
    .getByLabel('Completed by', { exact: true })
    .selectOption(state.employees[0]!.id);
  await page.getByRole('button', { name: 'Mark 104801 assembled' }).click();
  await expect(page.getByText('Employee is inactive.')).toBeVisible();
  await page
    .getByLabel('Completed by', { exact: true })
    .selectOption(state.employees[1]!.id);
  await page.getByRole('button', { name: 'Mark 104801 assembled' }).click();
  await expect(
    page.getByRole('button', { name: 'Retry original completion' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Retry original completion' }).click();
  await page.getByRole('button', { name: 'All allocated orders' }).click();
  await expect(page.getByText(/assembled · Robin Park/)).toBeVisible();
  expect(attempts[2]).toEqual(attempts[1]);
  expect(attempts[1]!.key).not.toEqual(attempts[0]!.key);
});

test('clean cutter follows office returns while background refresh preserves dirty measurements', async ({
  page,
}) => {
  const state = await mockApi(page, {
    role: 'production',
    stations: ['cutting'],
  });
  state.worksheets.push(submittedSheet(state));
  await page.goto('/stations');
  await expect(
    page.getByRole('button', { name: 'Mark 104801 cut', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Open cutting sheet' }).click();
  await expect(
    page.getByText('Results awaiting office review', { exact: false }),
  ).toBeVisible();
  state.worksheets[0]!.submittedAt = null;
  state.worksheets[0]!.revision++;
  await page.evaluate(() =>
    window.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('10', {
    timeout: 15000,
  });
  await page.getByLabel('Radial depth (mm)').fill('99');
  state.worksheets[0]!.results!.items[0] = {
    ...state.worksheets[0]!.results!.items[0]!,
    outcome: 'returned-roll',
    radialDepthMm: 20,
    locationId: ids.location,
  };
  state.worksheets[0]!.revision++;
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith(`/orders/${ids.order}/worksheet`),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event('visibilitychange')),
  );
  await refreshed;
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('99');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('20');
});

test('review order switches protect unsaved resolution measurements', async ({
  page,
}) => {
  const state = await mockApi(page);
  const first = submittedSheet(state);
  state.worksheets.push(first, {
    ...structuredClone(first),
    id: '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    orderNumber: '104802',
  });
  await page.goto(`/stations/review?worksheet=${first.id}`);
  await page
    .getByLabel('Reason for returning or resolving results')
    .fill('Measured again');
  await page
    .getByRole('button', { name: 'Resolve with current measurements' })
    .click();
  await page
    .getByLabel('What happened to this stock item?')
    .selectOption('returned-roll');
  await page.getByLabel('Radial depth (mm)').fill('12');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('row', { name: /104802/ })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('12');
  await expect(page).toHaveURL(new RegExp(first.id));
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('row', { name: /104802/ })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Order 104802' }),
  ).toBeVisible();
});

test('reconciliation retries the original keyed resolution after reload even when already reviewed', async ({
  page,
}) => {
  const state = await mockApi(page);
  const sheet = submittedSheet(state);
  state.worksheets.push(sheet);
  const requests: { key: string | undefined; body: unknown }[] = [];
  await page.route(
    `**/production/cutting/worksheets/${sheet.id}/review`,
    async (route) => {
      requests.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      if (requests.length === 1) {
        sheet.reviewedAt = new Date().toISOString();
        sheet.revision++;
        return route.abort('failed');
      }
      expect(requests[1]).toEqual(requests[0]);
      expect(requests[1]!.key).toMatch(/^[0-9a-f-]{36}$/);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(sheet),
      });
    },
  );
  await page.goto(`/stations/review?worksheet=${sheet.id}`);
  await page
    .getByLabel('Reason for returning or resolving results')
    .fill('Fresh physical measurements');
  await page
    .getByRole('button', { name: 'Resolve with current measurements' })
    .click();
  await page
    .getByLabel('What happened to this stock item?')
    .selectOption('returned-roll');
  await page.getByLabel('Tube outer diameter (mm)').fill('50');
  await page.getByLabel('Radial depth (mm)').fill('12');
  await page
    .getByRole('button', { name: 'Review and reconcile', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Reconcile allocation', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry original reconciliation' }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole('button', { name: 'Retry original reconciliation' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry original reconciliation' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Inventory reconciled', exact: true }),
  ).toBeVisible();
});

test('a rejected correction can be edited and resubmitted with a new request key', async ({
  page,
}) => {
  const state = await mockApi(page);
  const attempts: { key: string | undefined; body: { completedAt: string } }[] =
    [];
  await page.route(
    '**/production/cutting/orders/*/corrections',
    async (route) => {
      attempts.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      return route.fulfill({
        status: attempts.length === 1 ? 409 : 201,
        contentType: 'application/json',
        body: JSON.stringify(
          attempts.length === 1
            ? { message: 'Completion time cannot be in the future.' }
            : { recordId: ids.order, revision: 2 },
        ),
      });
    },
  );
  await page.goto(`/work-orders/${ids.order}`);
  await page
    .getByLabel('Completed by', { exact: true })
    .selectOption(state.employees[0]!.id);
  await page
    .getByRole('button', { name: 'Correct cut record', exact: true })
    .click();
  await page.getByLabel('Actual completion time').fill('2040-01-01T12:00');
  await page.getByLabel('Reason', { exact: true }).fill('Corrected date');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(
    page.getByText('Completion time cannot be in the future.'),
  ).toBeVisible();
  await page.getByLabel('Actual completion time').fill('2026-01-01T12:00');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]!.key).not.toEqual(attempts[0]!.key);
  expect(attempts[1]!.body.completedAt).toMatch(/^2026-/);
});
