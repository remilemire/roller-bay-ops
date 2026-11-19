import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const palette of ['slate', 'sage', 'ocean', 'sand', 'plum']) {
  for (const mode of ['light', 'dark']) {
    test(`${palette} ${mode} modal forms remain readable and keep keyboard focus contained`, async ({
      page,
    }, info) => {
      const state = await mockApi(page);
      state.colorTheme = palette;
      await page.addInitScript(
        (mode) => localStorage.setItem('roller-bay-theme', mode),
        mode,
      );
      await page.goto('/stock-items');
      const trigger = page.getByRole('button', {
        name: 'Add opening stock',
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole('dialog', {
        name: 'Add opening stock',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const materials = await dialog.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const over = (front: number[], back: number[]) =>
          front
            .slice(0, 3)
            .map(
              (value, index) =>
                (value * front[3]!) / 255 +
                back[index]! * (1 - front[3]! / 255),
            );
        const luminance = (rgb: number[]) => {
          const values = rgb
            .slice(0, 3)
            .map((value) =>
              value / 255 <= 0.04045
                ? value / 255 / 12.92
                : ((value / 255 + 0.055) / 1.055) ** 2.4,
            );
          return (
            values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
          );
        };
        const root = getComputedStyle(document.documentElement);
        const fill = rgba(getComputedStyle(element).backgroundColor);
        const veil = rgba(
          getComputedStyle(document.querySelector('.dialog-overlay')!)
            .backgroundColor,
        );
        const muted = luminance(rgba(root.getPropertyValue('--muted').trim()));
        // Include both extremes of real page content, not just the scene.
        const contrast = Math.min(
          ...['--surface', '--background', '--primary', '--foreground'].map(
            (token) => {
              const background = luminance(
                over(
                  fill,
                  over(veil, rgba(root.getPropertyValue(token).trim())),
                ),
              );
              return (
                (Math.max(muted, background) + 0.05) /
                (Math.min(muted, background) + 0.05)
              );
            },
          ),
        );
        return {
          contrast,
        };
      });
      expect(materials.contrast).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press('Tab');
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
      if (await dialog.locator('[aria-expanded="true"]').count()) {
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
      }
      await page.screenshot({
        path: info.outputPath(`modal-${palette}-${mode}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}

test('reduced transparency restores solid modal forms and disables blur', async ({
  page,
}) => {
  await mockApi(page);
  await page.addInitScript(() =>
    localStorage.setItem('roller-bay-reduce-transparency', 'true'),
  );
  await page.goto('/stock-items');
  await page
    .getByRole('button', { name: 'Add opening stock', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Add opening stock',
    exact: true,
  });
  await expect(dialog).toHaveCSS('backdrop-filter', 'none');
  expect(
    await dialog.evaluate((element) => {
      const color = getComputedStyle(element).backgroundColor;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    }),
  ).toBe(255);
});
