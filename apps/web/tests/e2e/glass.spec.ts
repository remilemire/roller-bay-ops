import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const palette of ['slate', 'sage', 'ocean', 'sand', 'plum']) {
  for (const mode of ['light', 'dark']) {
    test(`${palette} ${mode}: dashboard text and actions remain readable`, async ({
      page,
    }, info) => {
      const state = await mockApi(page);
      state.colorTheme = palette;
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(
        (mode) => localStorage.setItem('roller-bay-theme', mode),
        mode,
      );
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Overview', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('Orders to allocate', { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('.stat-value').filter({ hasText: '…' }),
      ).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute(
        'data-color-theme',
        palette,
      );
      await expect(page.locator('html')).toHaveClass(mode);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      // Check the muted text against every scene color through the actual
      // pane fill. Interpolated scene colors lie between these endpoints.
      const materialContrast = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const luminance = (channels: number[]) => {
          const linear = channels.slice(0, 3).map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return (
            linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
          );
        };
        const root = getComputedStyle(document.documentElement);
        const text = luminance(rgba(root.getPropertyValue('--muted').trim()));
        const pane = rgba(
          getComputedStyle(document.querySelector('.workspace-main')!)
            .backgroundColor,
        );
        const alpha = pane[3]! / 255;
        const muted = Math.min(
          ...['deep', 'mid', 'light'].map((tone) => {
            const scene = rgba(
              root
                .getPropertyValue(
                  tone === 'deep' ? '--scene-bar' : `--scene-${tone}`,
                )
                .trim(),
            );
            const background = luminance(
              scene.map(
                (value, index) => value * (1 - alpha) + pane[index]! * alpha,
              ),
            );
            return (
              (Math.max(text, background) + 0.05) /
              (Math.min(text, background) + 0.05)
            );
          }),
        );
        const action = getComputedStyle(
          document.querySelector('.button-primary')!,
        );
        const actionFill = rgba(action.backgroundColor);
        const actionText = luminance(rgba(action.color));
        const actionContrast = Math.min(
          ...['deep', 'mid', 'light'].map((tone) => {
            const scene = rgba(
              root
                .getPropertyValue(
                  tone === 'deep' ? '--scene-bar' : `--scene-${tone}`,
                )
                .trim(),
            );
            const background = luminance(
              scene.map((value, index) => {
                const shell = value * (1 - alpha) + pane[index]! * alpha;
                return (
                  shell * (1 - actionFill[3]! / 255) +
                  (actionFill[index]! * actionFill[3]!) / 255
                );
              }),
            );
            return (
              (Math.max(actionText, background) + 0.05) /
              (Math.min(actionText, background) + 0.05)
            );
          }),
        );
        return { muted, actionContrast };
      });
      expect(materialContrast.muted).toBeGreaterThanOrEqual(4.5);
      expect(materialContrast.actionContrast).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        path: info.outputPath(`${palette}-${mode}.png`),
        fullPage: true,
      });
    });
  }
}

test('reduced transparency survives navigation and reload and syncs while Settings is closed', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockApi(page);
  await page.goto('/settings');
  const setting = page.getByRole('combobox', { name: 'Reduce transparency' });
  await expect(setting).toHaveValue('system');
  await setting.selectOption('on');
  await expect(setting).toHaveValue('on');
  await expect(page.locator('html')).toHaveAttribute(
    'data-reduce-transparency',
    'true',
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem('roller-bay-reduce-transparency'),
    ),
  ).toBe('true');
  await page.goto('/stock-items');
  await page.reload();
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'backdrop-filter',
    'none',
  );
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  expect(
    await page
      .locator('.panel')
      .first()
      .evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3];
      }),
  ).toBe(255);
  const other = await context.newPage();
  await mockApi(other);
  await other.goto('/settings');
  await expect(
    other.getByRole('combobox', { name: 'Reduce transparency' }),
  ).toHaveValue('on');
  await other
    .getByRole('combobox', { name: 'Reduce transparency' })
    .selectOption('off');
  await expect(page.locator('html')).toHaveAttribute(
    'data-reduce-transparency',
    'false',
  );
  await expect(page.locator('body')).not.toHaveCSS('background-image', 'none');
  await other
    .getByRole('combobox', { name: 'Reduce transparency' })
    .selectOption('system');
  await expect(
    other.getByRole('combobox', { name: 'Reduce transparency' }),
  ).toHaveValue('system');
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-reduce-transparency',
  );
  await other.close();
  expect(errors).toEqual([]);
});

test('a saved preference applies before React and invalid or blocked storage uses the system', async ({
  page,
}) => {
  await page.route('**/_next/**/*.js*', (route) => route.abort());
  await page.addInitScript(() => {
    const value = new URLSearchParams(location.search).get('preference');
    if (value === 'blocked') {
      Storage.prototype.getItem = () => {
        throw new Error('blocked');
      };
    } else
      localStorage.setItem('roller-bay-reduce-transparency', value ?? 'true');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-reduce-transparency',
    'true',
  );
  await expect(page.locator('.login-panel')).toHaveCSS(
    'backdrop-filter',
    'none',
  );
  for (const value of ['invalid', 'blocked']) {
    await page.goto(`/login?preference=${value}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-reduce-transparency',
    );
  }
});

test('system transparency preference is the default and an explicit choice overrides it', async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await mockApi(page);
  await page.goto('/settings');
  const setting = page.getByRole('combobox', { name: 'Reduce transparency' });
  await expect(setting).toHaveValue('system');
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'backdrop-filter',
    'none',
  );
  await setting.selectOption('off');
  await expect(page.locator('body')).not.toHaveCSS('background-image', 'none');
  await page.reload();
  await expect(setting).toHaveValue('off');
  await setting.selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-reduce-transparency',
  );
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-transparency', value: 'no-preference' },
    ],
  });
  await expect(setting).toHaveValue('system');
  await expect(page.locator('body')).not.toHaveCSS('background-image', 'none');
  await page.reload();
  await expect(setting).toHaveValue('system');
  await cdp.detach();
});

test('print retains dashboard content without the decorative background', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(
    page.getByText('Orders to allocate', { exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
});
