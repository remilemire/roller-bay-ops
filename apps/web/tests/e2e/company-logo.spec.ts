import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const mode of ['light', 'dark']) {
  test(`${mode} branding identifies sign-in and the browser tab, and the home link navigates`, async ({
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
    await page.screenshot({
      path: info.outputPath(`company-sign-in-${mode}.png`),
    });
    state.authenticated = true;
    await page.goto('/stock-items');
    await expect(
      page.getByRole('heading', { name: 'Fabric stock', exact: true }),
    ).toBeVisible();
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
    const icon = page.locator('link[rel="icon"]').first();
    await expect(icon).toHaveAttribute('href', /.+/);
    const response = await page.request.get((await icon.getAttribute('href'))!);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^image\//);
    await expect(page).toHaveTitle('Roller Bay · Operations');
  });
}
