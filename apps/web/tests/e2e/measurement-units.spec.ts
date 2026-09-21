import { test, expect } from '@playwright/test';
import { ids, mockApi, unallocatedOrderId } from './fixtures';

test('units chosen per field in Settings relabel forms and lists while requests stay in millimetres', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/settings');
  const measurements = page.getByRole('region', { name: 'Measurement units' });
  // A label wrapping a select also contains the option text, so query by role.
  const blindWidth = measurements.getByRole('combobox', {
    name: 'Blind width',
    exact: true,
  });
  await expect(blindWidth).toHaveValue('in');
  await blindWidth.selectOption('mm');
  await expect(blindWidth).toHaveValue('mm');
  const rollWidth = measurements.getByRole('combobox', {
    name: 'Roll width',
    exact: true,
  });
  await rollWidth.selectOption('cm');
  await expect(rollWidth).toHaveValue('cm');
  expect(state.unitRequests).toEqual([
    { blindWidth: 'mm' },
    { rollWidth: 'cm' },
  ]);
  await expect(
    measurements.getByRole('combobox', { name: 'Finished drop', exact: true }),
  ).toHaveValue('in');
  await expect(
    measurements.getByRole('combobox', {
      name: 'Tube outer diameter',
      exact: true,
    }),
  ).toHaveValue('mm');

  await page.goto(`/allocations/new?workOrder=${unallocatedOrderId}`);
  await page.getByRole('button', { name: 'Add blind', exact: true }).click();
  await page.getByLabel('Color · blind 1', { exact: true }).click();
  await page
    .getByRole('option', { name: 'C1-000 · Linen voile', exact: true })
    .click();
  await page.getByLabel('Width (mm)', { exact: true }).fill('1371.6');
  await page.getByLabel('Finished drop (in)', { exact: true }).fill('90');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  // The blinds reach the order in millimetres, whatever units they were
  // typed in.
  await page.getByRole('button', { name: 'Save blinds', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Blinds saved', exact: true }),
  ).toBeVisible();
  expect(state.orderRequests.at(-1)!.body).toMatchObject({
    lines: [{ widthMm: 1371.6, lengthMm: 2286, quantity: 1 }],
  });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/allocations/${ids.allocation}$`));
  await expect(page.getByLabel('Width (mm)', { exact: true })).toHaveValue(
    '1371.6',
  );

  await page.goto('/stock-items');
  await expect(page.getByRole('cell', { name: '299.72 cm' })).toBeVisible();
});
