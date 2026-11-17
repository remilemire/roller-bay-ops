import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const mode of ['light', 'dark']) {
  test(`${mode} company logo fits sign-in and navigation and supplies the browser icon`, async ({
    page,
  }, info) => {
    const state = await mockApi(page, { signedIn: false });
    await page.addInitScript(
      (mode) => localStorage.setItem('roller-bay-theme', mode),
      mode,
    );
    await page.goto('/login');
    const loginLogo = page.getByRole('img', {
      name: 'BBV Vertican',
      exact: true,
    });
    await expect(loginLogo).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    const bounds = await loginLogo.boundingBox();
    expect(bounds!.width).toBeGreaterThan(200);
    expect(bounds!.height).toBeGreaterThan(40);
    const contrast = await loginLogo.evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgba = Array.from(context.getImageData(0, 0, 1, 1).data);
        const linear = rgba
          .slice(0, 3)
          .map((v) =>
            v / 255 <= 0.04045
              ? v / 255 / 12.92
              : ((v / 255 + 0.055) / 1.055) ** 2.4,
          );
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
      };
      const foreground = luminance(style.color);
      const cutout = luminance(style.getPropertyValue('--logo-cutout').trim());
      return (
        (Math.max(foreground, cutout) + 0.05) /
        (Math.min(foreground, cutout) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThan(7);
    await page.screenshot({
      path: info.outputPath(`company-sign-in-${mode}.png`),
    });
    state.authenticated = true;
    await page.goto('/stock-items');
    const mobile = !(await page.locator('.sidebar').isVisible());
    if (mobile)
      await page
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click();
    const surface = mobile
      ? page.getByRole('dialog', { name: 'Navigation', exact: true })
      : page.locator('.sidebar');
    await expect(
      surface.getByRole('img', { name: 'BBV Vertican', exact: true }),
    ).toBeVisible();
    const brand = surface.getByRole('link', {
      name: 'Roller Bay overview',
      exact: true,
    });
    await expect(brand).toHaveAttribute('href', '/');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`company-navigation-${mode}.png`),
    });
    await brand.click();
    await expect(
      page.getByRole('heading', { name: 'Overview', exact: true }),
    ).toBeVisible();
    const icon = page.locator('link[rel="icon"][href*="icon.svg"]');
    await expect(icon).toHaveCount(1);
    const response = await page.request.get((await icon.getAttribute('href'))!);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    await expect(page).toHaveTitle('Roller Bay · Operations');
  });
}
