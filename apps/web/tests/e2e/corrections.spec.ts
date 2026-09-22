import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';
import { ids, stock, receipt, timestamp } from '../fixtures';
import {
  receiptCorrectionContextSchema,
  stockCorrectionSchema,
  receiptCorrectionSchema,
  completionCorrectionContextSchema,
  completionCorrectionSchema,
} from '@roller-bay/shared/corrections';
const result = {
  eventId: ids.receipt,
  recordId: ids.stock,
  revision: 2,
  affectedAllocationIds: [],
  createdStockItemIds: [],
};
test('stock corrections review before saving and preserve an uncertain request', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  const writes: { key: string | undefined; body: unknown }[] = [];
  await page.route(
    `**/api/stock-items/${ids.stock}/corrections`,
    async (route) => {
      const req = route.request();
      writes.push({
        key: req.headers()['idempotency-key'],
        body: stockCorrectionSchema.parse(req.postDataJSON()),
      });
      if (writes.length === 1) return route.abort('failed');
      return route.fulfill({ json: result });
    },
  );
  await page.goto(`/stock-items/${ids.stock}`);
  await page
    .getByRole('button', { name: 'Correct stock', exact: true })
    .click();
  await page.getByLabel('Width (in)', { exact: true }).fill('80');
  await page
    .getByLabel('Reason for correction')
    .fill('Measured width at the cutting table');
  await page.getByRole('button', { name: 'Review changes' }).click();
  expect(writes).toHaveLength(0);
  await expect(
    page.getByRole('heading', { name: 'Review correction' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('stock-correction-review.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]!.body).toMatchObject({
    expectedRevision: stock.revision,
    changes: { widthMm: 2032 },
  });
});
test('receipt quantity corrections require an explicit roll choice and retain the reason', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  state.receiptSubmitted = true;
  const context = receiptCorrectionContextSchema.parse({
    record: receipt,
    baselineAvailable: true,
    eligibility: receipt.items[0]!.stockItems.map((s) => ({
      stockItemId: s.id,
      revision: s.revision,
      blockers: [],
    })),
  });
  await page.route(
    `**/api/stock-receipts/${ids.receipt}/correction-context`,
    (route) => route.fulfill({ json: context }),
  );
  const writes: unknown[] = [];
  await page.route(
    `**/api/stock-receipts/${ids.receipt}/corrections`,
    async (route) => {
      writes.push(
        receiptCorrectionSchema.parse(route.request().postDataJSON()),
      );
      return route.fulfill({ json: { ...result, recordId: ids.receipt } });
    },
  );
  await page.goto(`/stock-receipts/${ids.receipt}`);
  await page
    .getByRole('button', { name: 'Correct receipt', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Action', exact: true })
    .selectOption('update');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByRole('checkbox').first().check();
  await page.getByLabel('Reason for correction').fill('One roll entered twice');
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.screenshot({
    path: testInfo.outputPath('receipt-correction-review.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes[0]).toMatchObject({
    reason: 'One roll entered twice',
    operations: [
      {
        action: 'update',
        lineId: ids.line,
        data: { quantity: 1 },
        removeStockItemIds: [ids.stock],
      },
    ],
  });
});
test('employees see history but have no correction action', async ({
  page,
}) => {
  await mockApi(page, { role: 'staff' });
  await page.route(`**/api/stock-items/${ids.stock}/history*`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ids.receipt,
            actorId: ids.user,
            actorName: 'Warehouse admin',
            createdAt: timestamp,
            action: 'stock.corrected',
            reason: 'Physical recount',
            changes: [
              {
                recordType: 'stock-items',
                recordId: stock.id,
                before: { type: 'stock-items', value: stock },
                after: {
                  type: 'stock-items',
                  value: { ...stock, widthMm: 2032 },
                },
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    }),
  );
  await page.goto(`/stock-items/${ids.stock}`);
  await expect(
    page.getByRole('button', { name: 'Correct stock', exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.getByText(/Warehouse admin/).click();
  await expect(page.getByText('Physical recount')).toBeVisible();
});
test('completed cutting reviews explicit piece voids while preserving selected source identity', async ({
  page,
}, testInfo) => {
  const state = await mockApi(page);
  const source = {
    ...stock,
    isUsed: true,
    tubeOuterDiameterMm: 50,
    radialDepthMm: 10,
    measurementThicknessMm: 0.5,
    revision: 2,
  };
  const piece = {
    ...source,
    id: ids.item,
    isRemnant: true,
    widthMm: 300,
    initialLengthMm: 500,
    explicitLengthMm: 500,
    remainingLengthMm: 500,
    radialDepthMm: null,
    tubeOuterDiameterMm: null,
    measurementThicknessMm: null,
    sourceStockItemId: stock.id,
    stockReceiptItemId: null,
    revision: 1,
  };
  const outcome = {
    stockItemId: stock.id,
    expectedRevision: 1,
    outcome: 'returned-roll' as const,
    tubeOuterDiameterMm: 50,
    radialDepthMm: 10,
    locationId: ids.location,
    scraps: [
      { widthMm: 300, lengthMm: 500, locationId: ids.location, quantity: 1 },
    ],
  };
  state.allocation = {
    ...state.allocation,
    state: 'completed',
    revision: 2,
    completedAt: timestamp,
    items: [{ ...state.allocation.items[0]!, stockItem: source }],
    completion: {
      submittedByUserId: ids.user,
      items: [outcome],
      createdStockItemIds: [piece.id],
      affectedAllocationIds: [],
    },
  };
  const context = completionCorrectionContextSchema.parse({
    record: state.allocation,
    baselineAvailable: true,
    stockItems: [source, piece],
    effects: [
      {
        stockItemId: source.id,
        sourceStockItemId: null,
        before: stock,
        after: source,
        calculationThicknessMm: 0.5,
      },
      {
        stockItemId: piece.id,
        sourceStockItemId: source.id,
        before: null,
        after: piece,
        calculationThicknessMm: null,
      },
    ],
    eligibility: [source, piece].map((s) => ({
      stockItemId: s.id,
      revision: s.revision,
      blockers: [],
    })),
  });
  await page.route(
    `**/api/allocations/${ids.allocation}/correction-context`,
    (route) => route.fulfill({ json: context }),
  );
  const writes: unknown[] = [];
  await page.route(
    `**/api/allocations/${ids.allocation}/completion-corrections`,
    (route) => {
      writes.push(
        completionCorrectionSchema.parse(route.request().postDataJSON()),
      );
      return route.fulfill({
        json: { ...result, recordId: ids.allocation, revision: 3 },
      });
    },
  );
  await page.goto(`/allocations/${ids.allocation}`);
  await page
    .getByRole('button', { name: 'Correct cutting results', exact: true })
    .click();
  await page.getByRole('checkbox').check();
  await page.getByLabel('Radial depth (mm)', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Void piece', exact: true }).click();
  await page
    .getByLabel('Reason for correction')
    .fill('Offcut was recorded twice; depth measured incorrectly');
  await page.getByRole('button', { name: 'Review changes' }).click();
  await expect(page.getByText('Void pieces entered by mistake')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('cutting-correction-review.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes[0]).toMatchObject({
    expectedRevision: 2,
    items: [
      {
        outcome: {
          stockItemId: source.id,
          expectedRevision: 2,
          radialDepthMm: 12,
        },
        retainedPieces: [],
        removeRetainedPieceIds: [piece.id],
      },
    ],
  });
});
test('historical cutting blockers explain which later allocation needs attention', async ({
  page,
}) => {
  const state = await mockApi(page);
  state.allocation = {
    ...state.allocation,
    state: 'completed',
    revision: 2,
    completedAt: timestamp,
    completion: {
      submittedByUserId: ids.user,
      items: [
        {
          stockItemId: stock.id,
          expectedRevision: 1,
          outcome: 'consumed',
          tubeOuterDiameterMm: 50,
          scraps: [],
        },
      ],
      createdStockItemIds: [],
      affectedAllocationIds: [],
    },
  };
  const context = completionCorrectionContextSchema.parse({
    record: state.allocation,
    baselineAvailable: true,
    stockItems: [stock],
    effects: [
      {
        stockItemId: stock.id,
        sourceStockItemId: null,
        before: stock,
        after: stock,
      },
    ],
    eligibility: [
      {
        stockItemId: stock.id,
        revision: stock.revision,
        blockers: [
          {
            code: 'reserved',
            message: 'Release or reassign reservations before correcting.',
            allocationIds: [ids.receipt],
            stockItemIds: [],
          },
        ],
      },
    ],
  });
  await page.route(
    `**/api/allocations/${ids.allocation}/correction-context`,
    (route) => route.fulfill({ json: context }),
  );
  await page.goto(`/allocations/${ids.allocation}`);
  await page
    .getByRole('button', { name: 'Correct cutting results', exact: true })
    .click();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(
    page.getByText('Release or reassign reservations before correcting.'),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').locator(`a[href="/allocations/${ids.receipt}"]`),
  ).toBeVisible();
});
