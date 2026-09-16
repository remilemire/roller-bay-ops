import { test, expect } from '@playwright/test';
import { mockApi, ids } from './fixtures';
test('session bootstrap and reload hydrate without recoverable React errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /hydration|Minified React error #(?:418|423)/i.test(message.text())
    )
      errors.push(message.text());
  });
  await mockApi(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('workspace renders real-contract data and persists accessible light/dark preferences', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('248', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass('dark');
  await expect(
    page.getByRole('button', { name: 'Dark mode', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(17, 29, 27)',
  );
  await page.screenshot({
    path: `/tmp/roller-bay-${testInfo.project.name}-dark.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Light mode', exact: true }).click();
  await expect(page.locator('html')).toHaveClass('light');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(242, 245, 245)',
  );
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(33, 53, 50)');
  await page.screenshot({
    path: `/tmp/roller-bay-${testInfo.project.name}-light.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s');
});
test('touch navigation and role visibility follow the current session', async ({
  page,
}, testInfo) => {
  await mockApi(page, { role: 'user' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Fabric stock', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Fabric stock' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add opening stock' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: /C1-000/ }).click();
  await expect(page.getByRole('heading', { name: 'C1-000' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit stock' })).toHaveCount(0);
});
test('an unauthenticated visitor sees the Microsoft sign-in screen', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/stock-items');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('link', { name: 'Continue with Microsoft' }),
  ).toHaveAttribute('href', /\/api\/auth\/login$/);
  await expect(page.getByRole('heading', { name: 'Fabric stock' })).toHaveCount(
    0,
  );
});
test('Microsoft account rejection is shown on the login screen with a same-tab retry', async ({
  page,
}, testInfo) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/login?error=account_not_eligible');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'This Microsoft account is not eligible to sign in. Choose your company Microsoft account and try again.',
  );
  const retry = page.getByRole('link', { name: 'Continue with Microsoft' });
  await expect(retry).toHaveAttribute('href', /\/api\/auth\/login$/);
  expect(await retry.getAttribute('target')).toBeNull();
  await page.screenshot({ path: testInfo.outputPath('sign-in-error.png') });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('unknown and repeated login errors use a safe fallback message', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false });
  for (const query of [
    'error=private-provider-message',
    'error=account_not_eligible&error=unavailable',
  ]) {
    await page.goto(`/login?${query}`);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Sign-in could not be completed or has expired. Choose your company Microsoft account and try again.',
    );
    await expect(page.getByText('private-provider-message')).toHaveCount(0);
  }
});
test('receipt drafts preserve partial imperial input and unsaved edits on conflict', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/stock-receipts/new');
  await page.getByLabel('Purchase-order number').fill('PO-PARTIAL');
  await page.getByLabel('Width (in)', { exact: true }).fill('54');
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await expect(
    page.getByLabel('Color · line 2', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/stock-receipts/${ids.receipt}$`));
  await expect(page.getByText(/REVISION 1/)).toBeVisible();
  expect(state.draftRequests[0]!.body.data.items[0]).toMatchObject({
    widthMm: 1371.6,
    initialLengthMm: null,
    quantity: null,
  });
  expect(state.draftRequests[0]!.key).toMatch(/^[\da-f-]{36}$/);
  state.receiptConflict = true;
  await page.getByLabel('Purchase-order number').fill('MY-UNSAVED-CHANGE');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Receipt changed' }),
  ).toBeVisible();
  await expect(page.getByLabel('Purchase-order number')).toHaveValue(
    'MY-UNSAVED-CHANGE',
  );
});
test('receipt submission retries the same saved revision after an uncertain response', async ({
  page,
}) => {
  const state = await mockApi(page);
  state.failFirstSubmit = true;
  await page.goto(`/stock-receipts/${ids.receipt}`);
  await page
    .getByRole('button', { name: 'Submit receipt', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Submit receipt', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Temporarily unavailable',
  );
  await dialog
    .getByRole('button', { name: 'Submit receipt', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'PO-2026-048' }),
  ).toBeVisible();
  expect(state.submitAttempts).toBe(2);
  expect(state.stockCreations).toBe(1);
});
test('cutting completion preserves the stock revision and sends tube measurements in mm', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto(`/allocations/${ids.allocation}`);
  await page.getByRole('button', { name: 'Record cutting results' }).click();
  await page
    .getByLabel('What happened to this stock item?')
    .selectOption('consumed');
  await page.getByLabel('Tube outer diameter (mm)').fill('50');
  await page.getByRole('button', { name: 'Review and complete' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Complete order' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Cutting results recorded' }),
  ).toBeVisible();
  expect(state.completionRequests[0]).toMatchObject({
    expectedRevision: 1,
    items: [
      {
        stockItemId: ids.stock,
        outcome: 'consumed',
        tubeOuterDiameterMm: 50,
        expectedUpdatedAt: '2026-09-16T12:00:00.000Z',
      },
    ],
  });
});

test('expired sessions unmount private workflows and return to sign-in', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  state.authenticated = false;
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Fabric stock', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('link', { name: 'Continue with Microsoft' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fabric stock' })).toHaveCount(
    0,
  );
});
test('logging out closes the workspace and clears pending submissions', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem('roller-bay:pending:example', 'private'),
  );
  if (testInfo.project.name === 'tablet')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('button', { name: 'Account options for Jamie Chen' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('roller-bay:pending:example'),
    ),
  ).toBeNull();
});

test('allocation optimization is a preview until the shared draft is confirmed', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/allocations/new');
  await page.getByLabel('Order number', { exact: true }).fill('RB-PLANNED');
  await page.getByRole('button', { name: 'Add blind', exact: true }).click();
  await page
    .getByLabel('Color · blind 1', { exact: true })
    .selectOption(ids.color);
  await page.getByLabel('Width (in)', { exact: true }).fill('54');
  await page.getByLabel('Finished drop (yd)').fill('2.5');
  await page.getByLabel('Extra drop allowance (yd)').fill('0.5');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByLabel('Trim per outside edge (in)').fill('1');
  await page.getByLabel('Minimum reusable width (in)').fill('10');
  await page.getByLabel('Minimum reusable length (yd)').fill('0.5');
  await page.getByRole('button', { name: 'Optimize', exact: true }).click();
  await expect(
    page.getByText('Valid cutting plan', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Drop length (yd)', { exact: true }),
  ).toHaveValue('3');
  expect(state.allocationRequests.map((r) => r.path)).toEqual([
    '/allocations/optimize',
  ]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `/tmp/roller-bay-${testInfo.project.name}-allocation.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/allocations/${ids.allocation}$`));
  await expect(page.getByText(/SHARED DRAFT · REVISION 1/)).toBeVisible();
  expect(state.allocationDraft!.data.requirements[0]).toMatchObject({
    widthMm: 1371.6,
    lengthMm: 2286,
    lengthAllowanceMm: 457.2,
    quantity: 1,
  });
  await page
    .getByRole('button', { name: 'Confirm allocation', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm allocation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'RB-PLANNED', exact: true }),
  ).toBeVisible();
  expect(state.allocationRequests.at(-1)).toEqual({
    path: `/allocations/${ids.allocation}/submit`,
    body: { expectedRevision: 1 },
  });
});
test('disabled accounts see a clear access error without mounting workflows', async ({
  page,
}) => {
  const state = await mockApi(page);
  state.disabled = true;
  await page.goto('/stock-items');
  await expect(
    page.getByRole('heading', { name: 'Account unavailable' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fabric stock' })).toHaveCount(
    0,
  );
});

test('catalog editing normalizes color codes and retains thousandth-mm thickness', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/fabric-catalog');
  const edit = page.getByRole('button', { name: 'Edit C1-000', exact: true });
  await edit.click();
  await page.getByLabel('Color code', { exact: true }).fill('c2-001');
  await page.getByLabel('Thickness (mm)').fill('0.357');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save record', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.catalogWrites[0]).toEqual({
    code: 'C2-001',
    materialId: ids.material,
    thicknessMm: 0.357,
  });
  await expect(
    page.getByRole('cell', { name: 'C2-001', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit C2-001', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit C2-001', exact: true }),
  ).toBeFocused();
});
