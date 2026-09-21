import { expect, test, type Page } from '@playwright/test';
import { user, timestamp } from '../fixtures';

const uuid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function locations(page: Page, role = 'admin') {
  const zones = ['Warehouse', 'Workshop', 'Overflow'].map((name, i) => ({
    id: uuid(i + 1),
    name,
    sortOrder: i,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const sections = ['A', 'B', 'C'].map((label, i) => ({
    id: uuid(i + 10),
    label,
    zoneId: zones[0]!.id,
    zoneName: 'Warehouse',
    sortOrder: i,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const levels = ['Top', 'Middle', 'Bottom'].map((label, i) => ({
    id: uuid(i + 20),
    label,
    sectionId: sections[0]!.id,
    sectionLabel: 'A',
    zoneId: zones[0]!.id,
    zoneName: 'Warehouse',
    sortOrder: i,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const state = {
    fail: false,
    moves: [] as { id: string; targetId: string; position: string }[],
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': new URL(page.url()).origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
        },
        body: status === 204 ? undefined : JSON.stringify(body),
      });
    if (request.method() === 'OPTIONS') return send(null, 204);
    if (url.pathname === '/api/auth/me') return send({ ...user, role });
    const rows: Array<
      | (typeof zones)[number]
      | (typeof sections)[number]
      | (typeof levels)[number]
    > = url.pathname.includes('/zones')
      ? zones
      : url.pathname.includes('/sections')
        ? sections
        : levels;
    if (url.pathname.endsWith('/move')) {
      const id = url.pathname.split('/').at(-2)!;
      const body = request.postDataJSON() as {
        targetId: string;
        position: string;
      };
      state.moves.push({ id, ...body });
      if (state.fail)
        return send({ message: 'Order could not be saved.' }, 503);
      const from = rows.findIndex((row) => row.id === id);
      const [moved] = rows.splice(from, 1);
      rows.splice(
        rows.findIndex((row) => row.id === body.targetId) +
          (body.position === 'after' ? 1 : 0),
        0,
        moved!,
      );
      return send(null, 204);
    }
    const items = rows.filter(
      (row) =>
        (!url.searchParams.has('zoneId') ||
          ('zoneId' in row && row.zoneId === url.searchParams.get('zoneId'))) &&
        (!url.searchParams.has('sectionId') ||
          ('sectionId' in row &&
            row.sectionId === url.searchParams.get('sectionId'))),
    );
    return send({ items, total: items.length, page: 1, pageSize: 25 });
  });
  await page.goto('/locations');
  await expect(page.getByText('Bottom', { exact: true })).toBeVisible();
  return state;
}
const handles = (page: Page, kind = 'zone') =>
  page.getByRole('button', { name: new RegExp(`^Reorder ${kind} `) });
async function keyboardMove(
  page: Page,
  name: string,
  key = 'ArrowDown',
  end = 'Space',
) {
  const handle = page.getByRole('button', { name, exact: true });
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  // The keyboard sensor ignores a move key that arrives before it has measured
  // the picked-up row, which no person can do. Let a frame render first.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.keyboard.press(key);
  // Let the sortable transition finish before committing/cancelling the gesture.
  await page.waitForTimeout(280);
  await page.keyboard.press(end);
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
}

test('drags a zone with animated siblings and saves its relative position', async ({
  page,
}, testInfo) => {
  const state = await locations(page);
  await page.screenshot({ path: testInfo.outputPath('hierarchy.png') });
  await page
    .getByRole('button', { name: 'Warehouse zone', exact: true })
    .click();
  const first = handles(page).nth(0);
  const second = handles(page).nth(1);
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 8, {
    steps: 12,
  });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const siblingStyle = await second
    .locator('xpath=ancestor::li[1]')
    .evaluate((el) => ({
      transform: getComputedStyle(el).transform,
      duration: getComputedStyle(el).transitionDuration,
    }));
  expect(siblingStyle.transform).not.toBe('none');
  expect(siblingStyle.duration).toBe('0.24s');
  await page.screenshot({ path: testInfo.outputPath('dragging.png') });
  await page.mouse.up();
  await expect.poll(() => state.moves.length).toBe(1);
  await expect(handles(page).first()).toHaveAccessibleName(
    'Reorder zone Workshop',
  );
  expect(state.moves[0]).toEqual({
    id: uuid(1),
    targetId: uuid(2),
    position: 'after',
  });
  await page.reload();
  await expect(handles(page).first()).toHaveAccessibleName(
    'Reorder zone Workshop',
  );
});

test('reorders nested sections and levels with the keyboard', async ({
  page,
}) => {
  const state = await locations(page);
  await keyboardMove(page, 'Reorder level Warehouse / A / Top');
  await expect(handles(page, 'level').first()).toHaveAccessibleName(
    'Reorder level Warehouse / A / Middle',
  );
  await keyboardMove(page, 'Reorder section Warehouse / A');
  await expect(handles(page, 'section').first()).toHaveAccessibleName(
    'Reorder section Warehouse / B',
  );
  expect(state.moves.map((move) => move.id)).toEqual([uuid(20), uuid(10)]);
});

test('Escape cancels and failed saves restore the original order', async ({
  page,
}) => {
  const state = await locations(page);
  await keyboardMove(
    page,
    'Reorder level Warehouse / A / Top',
    'ArrowDown',
    'Escape',
  );
  expect(state.moves).toHaveLength(0);
  await expect(handles(page, 'level').first()).toHaveAccessibleName(
    'Reorder level Warehouse / A / Top',
  );
  state.fail = true;
  await keyboardMove(page, 'Reorder level Warehouse / A / Top');
  await expect(page.getByText('Order could not be saved.')).toBeVisible();
  await expect(handles(page, 'level').first()).toHaveAccessibleName(
    'Reorder level Warehouse / A / Top',
  );
});

test('hides numeric order fields and restricts reordering while searching', async ({
  page,
}) => {
  await locations(page);
  await page
    .getByRole('button', { name: 'Edit zone Warehouse', exact: true })
    .click();
  await expect(page.getByLabel('Display order')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/locations?search=Warehouse');
  await expect(handles(page).first()).toBeDisabled();
  await expect(page.getByText('Clear search to reorder.')).toBeVisible();
});

test('employees have no drag controls', async ({ page }) => {
  await locations(page, 'user');
  await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0);
});

test('touch dragging works and reduced motion disables row transitions', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch gesture coverage uses the tablet viewport.');
  const state = await locations(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const first = handles(page, 'level').nth(0);
  const second = handles(page, 'level').nth(1);
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const x = a.x + a.width / 2;
  const y = a.y + a.height / 2;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + 10 }],
  });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: b.y + b.height / 2 + 8 }],
  });
  await expect
    .poll(() =>
      second
        .locator('xpath=ancestor::li[1]')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    )
    .toBe('0s');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect.poll(() => state.moves.length).toBe(1);
  await expect(handles(page, 'level').first()).toHaveAccessibleName(
    'Reorder level Warehouse / A / Middle',
  );
});

test('moves an expanded zone with its entire branch', async ({ page }) => {
  const state = await locations(page);
  await keyboardMove(page, 'Reorder zone Warehouse');
  await expect(handles(page).first()).toHaveAccessibleName(
    'Reorder zone Workshop',
  );
  await expect(page.getByText('Bottom', { exact: true })).toBeVisible();
  expect(state.moves[0]).toEqual({
    id: uuid(1),
    targetId: uuid(2),
    position: 'after',
  });
});
