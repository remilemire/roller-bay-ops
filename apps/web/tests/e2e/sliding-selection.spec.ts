import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('theme selection follows clicks and keyboard input', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.addInitScript(() =>
    localStorage.setItem('roller-bay-theme', 'light'),
  );
  await page.goto('/');
  const group = page
    .getByRole('banner')
    .getByRole('group', { name: 'Appearance' });
  await group.getByRole('button', { name: 'Dark mode' }).click();
  await expect(
    group.getByRole('button', { name: 'Dark mode' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveClass('dark');
  await page.screenshot({ path: info.outputPath('glass-switch-dark.png') });
  const system = group.getByRole('button', { name: 'System theme' });
  await system.focus();
  await system.press('Space');
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(system).toBeFocused();
  await page.screenshot({ path: info.outputPath('glass-switch.png') });
});

test('filters remain usable on narrow screens and respect reduced motion', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.goto('/stock-items');
  const group = page.getByRole('group', { name: 'Stock status' });
  await group.getByRole('button', { name: 'Consumed', exact: true }).click();
  await expect(page).toHaveURL(/state=consumed/);
  await page.setViewportSize({ width: 320, height: 844 });
  const last = group.getByRole('button', { name: 'Voided', exact: true });
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/state=voided/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(group.locator('.selection-pill')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await group.getByRole('button', { name: 'On hand', exact: true }).click();
  await page.screenshot({ path: info.outputPath('glass-filters-narrow.png') });
});

test('sidebar selection follows routes and Settings, including mobile navigation', async ({
  page,
}, info) => {
  await mockApi(page);
  // Model a slower session response: navigation is absent until it resolves.
  await page.route('**/api/auth/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fallback();
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  const desktop = await page.locator('.sidebar').isVisible();
  const track = desktop
    ? page.locator('.sidebar-navigation').first()
    : page
        .getByRole('dialog', { name: 'Navigation', exact: true })
        .getByRole('group', { name: 'Sidebar', exact: true });
  const openMobile = async () => {
    if (!desktop)
      await page.getByRole('button', { name: 'Open navigation' }).click();
  };
  await openMobile();
  await track.getByRole('link', { name: 'Fabric stock', exact: true }).click();
  await expect(page).toHaveURL(/\/stock-items/);
  await openMobile();
  await expect(
    track.getByRole('link', { name: 'Fabric stock', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const stockLink = track.getByRole('link', {
    name: 'Fabric stock',
    exact: true,
  });
  await track.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await openMobile();
  const settingsLink = track.getByRole('link', {
    name: 'Settings',
    exact: true,
  });
  await expect(settingsLink).toHaveAttribute('aria-current', 'page');
  await expect(stockLink).not.toHaveAttribute('aria-current');
  await page.screenshot({ path: info.outputPath('sidebar-selection.png') });
});
