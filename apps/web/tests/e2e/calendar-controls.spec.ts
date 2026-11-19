import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const mode of ['light', 'dark']) {
  for (const view of ['week', 'month']) {
    test(`${mode} ${view} calendar Previous, Next, and Today select the expected dates`, async ({
      page,
    }, info) => {
      await mockApi(page);
      await page.clock.setFixedTime(new Date('2026-09-28T12:00:00-06:00'));
      await page.addInitScript(
        (mode) => localStorage.setItem('roller-bay-theme', mode),
        mode,
      );
      await page.goto(`/work-orders?view=${view}`);
      const controls = page.locator('.calendar-nav');
      await controls
        .getByRole('button', { name: `Previous ${view}`, exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get(view))
        .toBe(view === 'week' ? '2026-09-21' : '2026-08');
      await expect(controls.getByRole('heading')).toHaveText(
        view === 'week' ? 'Sep 21 – Sep 25, 2026' : 'August 2026',
      );
      await controls
        .getByRole('button', { name: 'Today', exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get(view))
        .toBeNull();
      await expect(controls.getByRole('heading')).toHaveText(
        view === 'week' ? 'Sep 28 – Oct 2, 2026' : 'September 2026',
      );
      await controls
        .getByRole('button', { name: `Next ${view}`, exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get(view))
        .toBe(view === 'week' ? '2026-10-05' : '2026-10');
      await expect(controls.getByRole('heading')).toHaveText(
        view === 'week' ? 'Oct 5 – Oct 9, 2026' : 'October 2026',
      );
      await page.screenshot({
        path: info.outputPath(`calendar-controls-${mode}-${view}.png`),
      });
    });
  }
}
