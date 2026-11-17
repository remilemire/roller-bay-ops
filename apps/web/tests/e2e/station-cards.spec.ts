import { expect, test } from '@playwright/test';
import { ids, mockApi } from './fixtures';

for (const mode of ['light', 'dark']) {
  test(`compact ${mode} cards group order details and disclose independent stages`, async ({
    page,
  }, info) => {
    const state = await mockApi(page, {
      role: 'production',
      stations: ['cutting'],
    });
    await page.clock.install();
    await page.addInitScript(
      (mode) => localStorage.setItem('roller-bay-theme', mode),
      mode,
    );
    const order = state.orders[0]!;
    order.quantity = 1;
    order.note = 'Keep the fabric label with the order.';
    order.shipDate = '2026-09-24';
    order.assembledAt = '2026-09-22T20:05:00.000Z';
    order.checkedAt = '2026-09-22T20:03:00.000Z';
    order.status = 'checked';
    const employee = state.employees[0]!;
    // Later stages are genuine records, not evidence that cutting happened.
    for (const station of ['checking', 'assembly'] as const) {
      state.productionCompletions.push({
        workOrderId: order.id,
        station,
        employees: [
          {
            employeeId: employee.id,
            employeeName: employee.name,
            employeeInitials: employee.initials,
          },
        ],
        completedAt:
          station === 'checking' ? order.checkedAt : order.assembledAt,
        recordedAt: '2026-09-22T20:06:00.000Z',
        recordedByUserId: ids.user,
      });
    }
    state.orders.push({
      ...order,
      id: '11111111-2222-4333-8444-555555555555',
      orderNumber: '104802',
      quantity: 8,
      note: '',
      shipDate: null,
      assembledAt: null,
      checkedAt: null,
      status: 'allocated',
    });
    for (const suffix of [3, 4]) {
      state.orders.push({
        ...state.orders.find((order) => order.orderNumber === '104802')!,
        id: `11111111-2222-4333-8444-55555555555${suffix}`,
        orderNumber: `10480${suffix}`,
      });
    }
    await page.goto('/stations');
    const card = page.getByRole('region', {
      name: 'Order 104801',
      exact: true,
    });
    await expect(
      card.getByRole('heading', { name: '104801', exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText('Cutting not recorded', { exact: true }),
    ).toBeVisible();
    await expect(card.locator('.station-order-meta')).toContainText(
      '1 blind · Ships',
    );
    await expect(card.locator('.station-order-note')).toHaveText(
      'Note Keep the fabric label with the order.',
    );
    const history = card.locator('details');
    await expect(history).not.toHaveAttribute('open');
    await expect(history.locator('summary')).toHaveText(
      'Production details · assembled, checked',
    );
    await expect(
      card.getByText(employee.name, { exact: false }).first(),
    ).not.toBeVisible();
    await history.locator('summary').click();
    const rows = history.locator('.station-history-row');
    await expect(rows.locator('dt')).toHaveText([
      'Cutting',
      'Assembly',
      'Checking',
      'Shipping',
    ]);
    await expect(rows.nth(0)).toContainText('Not recorded');
    await expect(rows.nth(1)).toContainText(employee.name);
    await expect(rows.nth(2)).toContainText(employee.name);
    await expect(rows.nth(3)).toContainText('Not recorded');
    // A refetch updates values without closing the worker's expanded history.
    order.note = 'Updated office note.';
    await page.clock.fastForward(10_000);
    await expect(card.locator('.station-order-note')).toContainText(
      'Updated office note.',
    );
    await expect(history).toHaveAttribute('open', '');
    const second = page.getByRole('region', {
      name: 'Order 104802',
      exact: true,
    });
    await expect(second.locator('.station-order-meta')).toHaveText(
      '8 blinds · Unscheduled',
    );
    await expect(second.locator('.station-order-note')).toHaveCount(0);
    await expect(second.locator('summary')).toHaveText(
      'Production details · No stages recorded',
    );
    await expect(page.locator('.station-queue > .pagination')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    const firstBounds = await card.boundingBox();
    const secondBounds = await second.boundingBox();
    if (info.project.name === 'desktop') {
      expect(secondBounds!.x).toBeGreaterThan(firstBounds!.x);
      expect(secondBounds!.y).toBe(firstBounds!.y);
      expect(secondBounds!.height).toBeLessThan(firstBounds!.height);
    } else {
      expect(secondBounds!.x).toBe(firstBounds!.x);
      expect(secondBounds!.y).toBeGreaterThan(firstBounds!.y);
    }
    if (info.project.name === 'desktop') {
      const third = page.getByRole('region', {
        name: 'Order 104803',
        exact: true,
      });
      await expect
        .poll(async () => {
          const upper = await second.boundingBox();
          const lower = await third.boundingBox();
          return Math.abs(lower!.y - upper!.y - upper!.height - 16);
        })
        .toBeLessThan(2);
      await history.locator('summary').click();
      const fourth = page.getByRole('region', {
        name: 'Order 104804',
        exact: true,
      });
      await expect
        .poll(async () => {
          const upper = await card.boundingBox();
          const lower = await fourth.boundingBox();
          return Math.abs(lower!.y - upper!.y - upper!.height - 16);
        })
        .toBeLessThan(2);
      await page.screenshot({
        path: info.outputPath(`station-cards-${mode}-packed.png`),
        fullPage: true,
      });
      await history.locator('summary').click();
    }
    await page.screenshot({
      path: info.outputPath(`station-cards-${mode}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const boxes = await page
          .locator('.station-order')
          .evaluateAll((cards) =>
            cards.map((card) => {
              const box = card.getBoundingClientRect();
              return { top: box.top, bottom: box.bottom };
            }),
          );
        return boxes.every(
          (box, index) =>
            index === 0 || box.top >= boxes[index - 1]!.bottom + 15,
        );
      })
      .toBe(true);
    const summary = await card.locator('.station-order-summary').boundingBox();
    const action = await card
      .getByRole('button', { name: 'Record cutting', exact: true })
      .boundingBox();
    expect(action!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`station-cards-${mode}-narrow.png`),
      fullPage: true,
    });
    await card
      .getByRole('button', { name: 'Record cutting', exact: true })
      .click();
    const worksheet = page.getByRole('link', {
      name: 'Use worksheet',
      exact: true,
    });
    await expect(worksheet).toHaveClass(/button-primary/);
    await worksheet.click();
    await expect(page).toHaveURL(new RegExp(`/stations/cutting/${order.id}$`));
  });
}
