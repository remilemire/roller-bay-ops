import { test, expect } from '@playwright/test';
import { mockApi, ids } from './fixtures';
test('station login, whole-order attribution, and employee directory', async ({
  page,
}) => {
  const state = await mockApi(page, {
    role: 'station',
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
  const state = await mockApi(page, { role: 'station', stations: ['cutting'] });
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
    page.getByRole('button', { name: 'cut recorded', exact: true }),
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
  await expect(page.getByLabel('Cut 1 done')).toBeChecked();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('10');
  await page.getByLabel('Cut 1 done').uncheck();
  await page.getByLabel('Radial depth (mm)').fill('99');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Cut 1 done')).toBeChecked();
  await expect(page.getByLabel('Radial depth (mm)')).toHaveValue('10');
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
  state.role = 'station';
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
  await page.goto('/settings/employees');
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
