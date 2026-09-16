import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';

const palettes = [
  {
    name: 'Sage',
    value: 'sage',
    light: 'rgb(242, 245, 245)',
    dark: 'rgb(17, 29, 27)',
  },
  {
    name: 'Slate',
    value: 'slate',
    light: 'rgb(242, 244, 247)',
    dark: 'rgb(23, 28, 36)',
  },
  {
    name: 'Ocean',
    value: 'ocean',
    light: 'rgb(239, 245, 249)',
    dark: 'rgb(17, 30, 41)',
  },
  {
    name: 'Sand',
    value: 'sand',
    light: 'rgb(247, 243, 236)',
    dark: 'rgb(35, 30, 25)',
  },
  {
    name: 'Plum',
    value: 'plum',
    light: 'rgb(246, 242, 248)',
    dark: 'rgb(35, 27, 41)',
  },
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
  await expect(appearance.getByRole('combobox')).toHaveCount(0);
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
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        palette[mode],
      );
      await expect(
        appearance.locator(`[data-theme-preview="${palette.value}"]`),
      ).toHaveCSS('background-color', palette[mode]);
      await page.reload();
      await expect(
        appearance.getByRole('radio', { name: palette.name, exact: true }),
      ).toBeChecked();
      await expect(page.locator('html')).toHaveClass(mode);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        palette[mode],
      );
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

test('palette follows local storage across tabs and system mode stays independent', async ({
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
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    palettes[2].dark,
  );
  const other = await context.newPage();
  await mockApi(other);
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute(
    'data-color-theme',
    'ocean',
  );
  await appearance.getByText('Sand', { exact: true }).click();
  await expect(other.locator('html')).toHaveAttribute(
    'data-color-theme',
    'sand',
  );
  await other.evaluate(() => localStorage.removeItem('roller-bay-color-theme'));
  await expect(
    appearance.getByRole('radio', { name: 'Slate', exact: true }),
  ).toBeChecked();
  await expect(page.locator('html')).toHaveClass('dark');
  await other.close();
});

test('saved palette is applied before React loads and invalid storage falls back to Slate', async ({
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
