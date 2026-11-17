import { expect, test, type Locator } from '@playwright/test';
import { mockApi } from './fixtures';

async function expectAligned(group: Locator) {
  await expect
    .poll(async () => {
      const pill = await group.locator('.selection-pill').boundingBox();
      const button = await group
        .locator('button[aria-pressed="true"], a[aria-current="page"]')
        .boundingBox();
      if (!pill || !button) return false;
      return (['x', 'y', 'width', 'height'] as const).every(
        (key) => Math.abs(pill[key] - button[key]) < 1,
      );
    })
    .toBe(true);
}

test('theme selection slides between options and follows keyboard input', async ({
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
  await expectAligned(group);
  const pill = group.locator('.selection-pill');
  const initial = await pill.boundingBox();
  await expect(pill).toHaveCSS(
    'transition-property',
    'transform, width, height, background-color',
  );
  await group.getByRole('button', { name: 'Dark mode' }).click();
  await expectAligned(group);
  expect((await pill.boundingBox())!.x).toBeGreaterThan(initial!.x);
  await expect(pill).toHaveCSS(
    'box-shadow',
    'rgba(0, 0, 0, 0.2) 0px 1px 3px 0px',
  );
  await page.screenshot({ path: info.outputPath('glass-switch-dark.png') });
  const system = group.getByRole('button', { name: 'System theme' });
  await system.focus();
  await system.press('Space');
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(system).toBeFocused();
  await expectAligned(group);
  await page.screenshot({ path: info.outputPath('glass-switch.png') });
});

test('filter selection resizes and follows wrapped options without motion when requested', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.goto('/stock-items');
  const group = page.getByRole('group', { name: 'Stock status' });
  await expectAligned(group);
  await group.getByRole('button', { name: 'Consumed', exact: true }).click();
  await expect(page).toHaveURL(/state=consumed/);
  await expectAligned(group);
  await page.setViewportSize({ width: 320, height: 844 });
  const last = group.getByRole('button', { name: 'Voided', exact: true });
  await last.click();
  await expectAligned(group);
  const firstBounds = await group.getByRole('button').first().boundingBox();
  expect((await last.boundingBox())!.y).toBeGreaterThan(firstBounds!.y);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(group.locator('.selection-pill')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await group.getByRole('button', { name: 'On hand', exact: true }).click();
  await expectAligned(group);
  await page.screenshot({ path: info.outputPath('glass-filters-narrow.png') });
});

test('sidebar selection follows routes and Settings, including mobile navigation', async ({
  page,
}, info) => {
  await mockApi(page);
  await page.goto('/');
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
  await expectAligned(track);
  await track.getByRole('link', { name: 'Fabric stock', exact: true }).click();
  await expect(page).toHaveURL(/\/stock-items/);
  await openMobile();
  await expect(
    track.getByRole('link', { name: 'Fabric stock', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expectAligned(track);
  await track.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await openMobile();
  await expectAligned(track);
  const pill = await track.locator('.selection-pill').boundingBox();
  const stock = await track
    .getByRole('link', { name: 'Fabric stock', exact: true })
    .boundingBox();
  expect(pill!.y).toBeGreaterThan(stock!.y);
  await page.screenshot({ path: info.outputPath('sidebar-selection.png') });
});
