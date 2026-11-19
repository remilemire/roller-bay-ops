import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';

const palettes = [
  { name: 'Sage', value: 'sage' },
  { name: 'Slate', value: 'slate' },
  { name: 'Ocean', value: 'ocean' },
  { name: 'Sand', value: 'sand' },
  { name: 'Plum', value: 'plum' },
] as const;

test('preview cards select all five palettes in light and dark mode and survive reload', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockApi(page);
  await page.goto('/settings');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  await expect(appearance.getByRole('radio')).toHaveCount(5);
  await expect(page.getByRole('banner').getByRole('radio')).toHaveCount(0);
  await expect(
    appearance.getByRole('combobox', { name: 'Reduce transparency' }),
  ).toHaveValue('system');
  for (const mode of ['light', 'dark'] as const) {
    await appearance
      .getByRole('button', {
        name: `${mode === 'light' ? 'Light' : 'Dark'} mode`,
        exact: true,
      })
      .click();
    for (const palette of palettes) {
      await appearance.getByText(palette.name, { exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-color-theme',
        palette.value,
      );
      await page.reload();
      await expect(
        appearance.getByRole('radio', { name: palette.name, exact: true }),
      ).toBeChecked();
      await expect(page.locator('html')).toHaveClass(mode);
    }
    await page.screenshot({
      path: `/tmp/roller-bay-themes-${testInfo.project.name}-${mode}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('palette follows the account over the browser cache and system mode stays independent', async ({
  page,
  context,
}) => {
  await mockApi(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  await appearance
    .getByRole('button', { name: 'System theme', exact: true })
    .click();
  await appearance.getByText('Ocean', { exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass('dark');
  // Another account in the same browser starts from the cached Ocean but
  // settles on its own palette.
  const other = await context.newPage();
  const otherAccount = await mockApi(other);
  otherAccount.colorTheme = 'sand';
  await other.goto('/settings');
  await expect(other.locator('html')).toHaveAttribute(
    'data-color-theme',
    'sand',
  );
  await expect(
    other.getByRole('radio', { name: 'Sand', exact: true }),
  ).toBeChecked();
  await other.close();
});

test('cached palette is applied before React loads and invalid storage falls back to Slate', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'roller-bay-color-theme',
      location.search.includes('invalid') ? 'invalid' : 'plum',
    ),
  );
  await page.route('**/_next/**/*.js*', (route) => route.abort());
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-color-theme',
    'plum',
  );
  await page.goto('/login?invalid', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-color-theme',
    'slate',
  );
});

test('theme cards support keyboard selection and fit a narrow screen', async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  const slate = appearance.getByRole('radio', { name: 'Slate', exact: true });
  await expect(appearance.getByRole('radio').first()).toHaveAccessibleName(
    'Slate',
  );
  await expect(slate).toBeChecked();
  await slate.focus();
  await slate.press('ArrowRight');
  await expect(
    appearance.getByRole('radio', { name: 'Sage', exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
