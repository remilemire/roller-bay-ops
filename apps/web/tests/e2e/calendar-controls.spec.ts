import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const mode of ['light', 'dark']) {
  for (const view of ['week', 'month']) {
    test(`${mode} ${view} calendar navigation has a quiet consistent shadow`, async ({
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
      await expect(controls.getByRole('button')).toHaveCount(3);
      for (const button of await controls.getByRole('button').all()) {
        const rest = await button.evaluate(
          (element) => getComputedStyle(element).boxShadow,
        );
        expect(rest).not.toBe('none');
        expect(rest).not.toContain('inset');
        await button.hover();
        await expect(button).toHaveCSS('box-shadow', rest);
      }
      await expect(
        page.getByRole('button', { name: 'New order', exact: true }),
      ).toHaveCSS('box-shadow', 'none');
      await controls
        .getByRole('button', { name: `Previous ${view}`, exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get(view))
        .toBe(view === 'week' ? '2026-09-21' : '2026-08');
      await controls
        .getByRole('button', { name: 'Today', exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get(view))
        .toBeNull();
      await page.screenshot({
        path: info.outputPath(`calendar-controls-${mode}-${view}.png`),
      });
    });
  }
}
