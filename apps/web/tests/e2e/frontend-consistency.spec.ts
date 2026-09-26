import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockApi, ids } from './fixtures';
import { stock } from '../fixtures';

async function fits(page: Page, element: Locator) {
  await expect(element).toBeVisible();
  expect(
    await element.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: failed feature loads keep readable errors within the workspace`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await mockApi(page);
    await page.addInitScript(
      (value) => localStorage.setItem('roller-bay-theme', value),
      theme,
    );
    let failing = '';
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return path === `/api${failing}`
        ? route.fulfill({
            status: 400,
            json: {
              message: 'Unable to load this record. Try again.',
              issues: [
                {
                  code: 'conflict',
                  path: 'record',
                  message: `Reference ${'A'.repeat(220)} is unavailable.`,
                },
              ],
            },
          })
        : route.fallback();
    });
    const routes = [
      ['/stock-items', '/stock-items'],
      [`/stock-items/${ids.stock}`, `/stock-items/${ids.stock}`],
      ['/stock-receipts', '/stock-receipts'],
      [`/stock-receipts/${ids.receipt}`, `/stock-receipts/${ids.receipt}`],
      ['/allocations', '/allocations'],
      [`/allocations/${ids.allocation}`, `/allocations/${ids.allocation}`],
      ['/work-orders?view=list', '/work-orders'],
      [`/work-orders/${ids.order}`, `/work-orders/${ids.order}`],
      ['/fabric-catalog', '/fabric-catalog/manufacturers'],
      ['/locations', '/locations/zones'],
      ['/users', '/users'],
      ['/stations/employees', '/employees'],
      ['/stations?station=assembly', '/production/assembly/orders'],
    ];
    for (const [url, endpoint] of routes) {
      failing = endpoint!;
      await page.goto(url!);
      const alert = page
        .getByRole('alert')
        .filter({ hasText: 'Unable to load this record.' })
        .first();
      await fits(page, alert);
      await expect(alert).toContainText('Reference');
      expect(
        await alert.evaluate((node) => {
          const reference = document.createElement('span');
          reference.style.color = 'var(--danger)';
          node.append(reference);
          const color = getComputedStyle(reference).color;
          reference.remove();
          return getComputedStyle(node).color === color;
        }),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${endpoint!.replaceAll('/', '-')}-${theme}.png`),
      });
    }
  });
}

test('standard controls align, filters expose their defaults, and views follow schedule order', async ({
  page,
}, info) => {
  await mockApi(page);
  for (const [url, label, selected] of [
    ['/stock-items', 'Stock status', 'On hand'],
    ['/stock-receipts', 'Receipt status', 'Submitted'],
    ['/allocations', 'Allocation status', 'Active'],
    ['/work-orders?view=list', 'Order status', 'Open'],
  ]) {
    await page.goto(url!);
    const group = page.getByRole('group', { name: label, exact: true });
    await expect(group.getByRole('button', { pressed: true })).toHaveText(
      selected!,
    );
    const input = page.getByRole('searchbox');
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await expect(input).toHaveCSS('height', '44px');
    await expect(search).toHaveCSS('height', '44px');
    await fits(page, group);
  }
  await page.goto('/work-orders');
  const view = page.getByRole('group', { name: 'View', exact: true });
  await expect(view.getByRole('button')).toHaveText(['List', 'Week', 'Month']);
  await expect(view.getByRole('button', { name: 'List' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto(`/work-orders/${ids.order}`);
  const actions = page.locator('.heading-actions');
  await expect(actions.getByRole('button')).toHaveText([
    'Edit',
    'Cancel work order',
    'Reschedule',
  ]);
  await expect(actions.getByRole('button', { name: 'Reschedule' })).toHaveClass(
    /button-primary/,
  );
  await page.goto('/stock-items');
  await page.getByRole('button', { name: 'Add opening stock' }).click();
  const dialog = page.getByRole('dialog');
  const heights = await dialog
    .locator('.input')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
  expect(heights.length).toBeGreaterThan(3);
  expect(new Set(heights)).toEqual(new Set([44]));
  await page.screenshot({
    path: info.outputPath('opening-stock-controls.png'),
  });
});

test('employee validation stays beside its fields and search has an empty state', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.route('**/api/employees', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          json: {
            message: 'Check the employee details.',
            issues: [
              {
                code: 'custom',
                path: ['name'],
                message: 'Enter the full employee name.',
              },
              {
                code: 'custom',
                path: ['initials'],
                message: 'These initials are already used.',
              },
            ],
          },
        })
      : route.fallback(),
  );
  await page.goto('/stations/employees');
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  await page.getByLabel('Full name').fill('Alex');
  await page.getByLabel('Initials', { exact: true }).fill('AR');
  await page.getByRole('button', { name: 'Save employee' }).click();
  await expect(page.getByLabel('Full name')).toHaveAccessibleDescription(
    'Enter the full employee name.',
  );
  await expect(page.getByLabel('Initials', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('alert')).not.toContainText('These initials');
  await fits(page, page.getByRole('dialog'));
  await page.screenshot({ path: info.outputPath('employee-validation.png') });
  await page.getByLabel('Full name').fill('Alex Reed');
  await expect(page.getByLabel('Full name')).not.toHaveAttribute(
    'aria-invalid',
  );
  await expect(page.getByLabel('Initials', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('searchbox').fill('Nobody matches');
  await expect(
    page.getByRole('heading', { name: 'No matching employees' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/search=Nobody/);
});

test('lookup failures and invalid additional fabric remain actionable', async ({
  page,
}, info) => {
  await mockApi(page);
  const extra = { ...stock, id: ids.receipt, fabricColorId: ids.user };
  let unavailable = true;
  await page.route('**/api/stock-items?*', (route) =>
    unavailable
      ? route.fulfill({
          status: 400,
          json: { message: 'Options unavailable.' },
        })
      : route.fulfill({
          json: { items: [extra], total: 1, page: 1, pageSize: 25 },
        }),
  );
  await page.route(`**/api/stock-items/${extra.id}`, (route) =>
    route.fulfill({ json: extra }),
  );
  await page.goto(
    `/allocations/${ids.allocation}?action=record-cutting-results`,
  );
  const picker = page.getByRole('combobox', { name: 'Additional roll used' });
  await expect(picker).toHaveAccessibleDescription(/Could not load options/);
  const field = page.locator('.field').filter({ has: picker });
  await expect(field.getByRole('button', { name: 'Retry' })).toHaveClass(
    /button-outline/,
  );
  unavailable = false;
  await field.getByRole('button', { name: 'Retry' }).click();
  await picker.click();
  await page
    .getByRole('listbox', { name: 'Additional roll used' })
    .getByRole('option')
    .click();
  await page
    .getByRole('button', { name: 'Add roll used', exact: true })
    .click();
  await expect(picker).toHaveAccessibleDescription(
    'Select fabric used by this order.',
  );
  await expect(picker).toHaveAttribute('aria-invalid', 'true');
  await fits(page, field);
  await page.screenshot({
    path: info.outputPath('additional-fabric-error.png'),
    fullPage: true,
  });
  await field
    .getByRole('button', { name: 'Clear Additional roll used' })
    .click();
  await expect(picker).not.toHaveAttribute('aria-invalid');
});

test('unscheduling an order without fabric shows date issues beside its date', async ({
  page,
}) => {
  const state = await mockApi(page);
  state.orders[0]!.allocatedAt = null;
  await page.route(`**/api/work-orders/${ids.order}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          json: {
            message: 'The schedule changed.',
            issues: [
              {
                code: 'custom',
                path: ['shipDate'],
                message: 'Reload the order before clearing this date.',
              },
            ],
          },
        })
      : route.fallback(),
  );
  await page.goto(`/work-orders/${ids.order}`);
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Unschedule', exact: true }).click();
  await expect(dialog.getByLabel('Ship date')).toHaveAccessibleDescription(
    'Reload the order before clearing this date.',
  );
});

test('date validation uses the field error style and preserves the selected date', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.route(`**/api/work-orders/${ids.order}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          json: {
            message: 'Check the ship date.',
            issues: [
              {
                code: 'custom',
                path: ['shipDate'],
                message: 'Choose a later shipping day.',
              },
            ],
          },
        })
      : route.fallback(),
  );
  await page.goto(`/work-orders/${ids.order}`);
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Reschedule order/ });
  await dialog.locator('.calendar-day:not(.is-selected)').first().click();
  const date = dialog.getByLabel('Ship date', { exact: true });
  const value = await date.textContent();
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(date).toHaveAccessibleDescription(
    'Choose a later shipping day.',
  );
  await expect(date).toHaveAttribute('data-invalid', 'true');
  await expect(date).toHaveText(value!);
  await expect(date).toHaveCSS('height', '44px');
  await expect(dialog.getByRole('alert')).not.toContainText('Choose a later');
  await fits(page, dialog);
  await page.screenshot({ path: info.outputPath('date-validation.png') });
});
