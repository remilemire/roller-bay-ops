import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const palette of ['slate', 'sage', 'ocean', 'sand', 'plum']) {
  for (const mode of ['light', 'dark']) {
    test(`${palette} ${mode}: glass stays readable without nested filters`, async ({
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
      await expect(page.locator('.stat')).toHaveCount(6);
      await expect(
        page.locator('.stat-value').filter({ hasText: '…' }),
      ).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute(
        'data-color-theme',
        palette,
      );
      await expect(page.locator('html')).toHaveClass(mode);
      await expect(page.locator('.workspace-main')).toHaveCSS(
        'backdrop-filter',
        'none',
      );
      const surfaces = await page.evaluate(() => {
        const blurred = Array.from(
          document.querySelectorAll<HTMLElement>('body *'),
        ).filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.backdropFilter !== 'none';
        });
        return {
          count: blurred.length,
          nested: blurred.some((element) =>
            blurred.some(
              (other) => other !== element && other.contains(element),
            ),
          ),
          fits: document.documentElement.scrollWidth <= innerWidth,
          panelsUnfiltered: Array.from(
            document.querySelectorAll('.panel'),
          ).every(
            (element) => getComputedStyle(element).backdropFilter === 'none',
          ),
        };
      });
      expect(surfaces).toEqual({
        count: 0,
        nested: false,
        fits: true,
        panelsUnfiltered: true,
      });
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
            const scene = rgba(root.getPropertyValue(`--scene-${tone}`).trim());
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
        const content = getComputedStyle(
          document.querySelector('.panel:not(.stat)')!,
        );
        const summary = getComputedStyle(document.querySelector('.stat')!);
        return {
          muted,
          contentAlpha: rgba(content.backgroundColor)[3],
          summaryAlpha: rgba(summary.backgroundColor)[3],
          summaryBackgrounds: Array.from(
            document.querySelectorAll('.stat'),
          ).map((element) => getComputedStyle(element).backgroundColor),
          summaryColors: Array.from(document.querySelectorAll('.stat')).map(
            (element) => getComputedStyle(element).color,
          ),
          contentImage: content.backgroundImage,
          contentShadow: content.boxShadow,
          summaryImage: summary.backgroundImage,
        };
      });
      expect(materialContrast.muted).toBeGreaterThanOrEqual(4.5);
      expect(new Set(materialContrast.summaryBackgrounds).size).toBe(1);
      expect(new Set(materialContrast.summaryColors).size).toBe(1);
      expect(materialContrast.contentAlpha).toBe(255);
      expect(materialContrast.summaryAlpha).toBeLessThan(255);
      expect(materialContrast.contentImage).toBe('none');
      expect(materialContrast.contentShadow).toBe('none');
      expect(materialContrast.summaryImage).toBe('none');
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
  const setting = page.getByRole('checkbox', { name: 'Reduce transparency' });
  await expect(setting).not.toBeChecked();
  await setting.focus();
  await setting.press('Space');
  await expect(setting).toBeChecked();
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
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  const other = await context.newPage();
  await mockApi(other);
  await other.goto('/settings');
  await expect(
    other.getByRole('checkbox', { name: 'Reduce transparency' }),
  ).toBeChecked();
  await other.getByRole('checkbox', { name: 'Reduce transparency' }).uncheck();
  await expect(page.locator('html')).toHaveAttribute(
    'data-reduce-transparency',
    'false',
  );
  await expect(page.locator('body')).not.toHaveCSS('background-image', 'none');
  await other.evaluate(() => localStorage.clear());
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
  const setting = page.getByRole('checkbox', { name: 'Reduce transparency' });
  await expect(setting).toBeChecked();
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'backdrop-filter',
    'none',
  );
  await setting.uncheck();
  await expect(page.locator('body')).not.toHaveCSS('background-image', 'none');
  await page.reload();
  await expect(setting).not.toBeChecked();
  await cdp.detach();
});

test('print removes the scene and the glass pane', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.stat')).toHaveCount(6);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.workspace-main')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  await expect(page.locator('.panel').first()).toHaveCSS(
    'background-image',
    'none',
  );
  await expect(page.locator('.panel').first()).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
});
