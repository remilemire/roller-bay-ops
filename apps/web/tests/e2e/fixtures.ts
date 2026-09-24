import type {
  ProductionCompletion,
  Worksheet,
} from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import type { Page } from '@playwright/test';
import {
  allocationDraftSchema,
  allocationDetailSchema,
  allocationOptimizationSchema,
  type AllocationDraftInput,
} from '@roller-bay/shared/allocations';
import type { StockReceiptDraftData } from '@roller-bay/shared/stock-receipts';
import type { WorkOrderLine } from '@roller-bay/shared/work-orders';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  ids,
  timestamp,
  user,
  color,
  stock,
  receiptDraft,
  receipt,
  allocation,
  order,
  orderLines,
} from '../fixtures';
export { ids } from '../fixtures';
const teammate = {
  ...user,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name: 'Robin Park',
  email: 'robin@example.com',
};
// Mirrors the server: rules come from configuration and each cut is as long
// as its longest assigned drop plus that blind's allowance.
function draftData(input: AllocationDraftInput, lines: WorkOrderLine[]) {
  // The blinds a plan assigns are its order's saved lines.
  const requirements = lines.map((item) => ({
    ...item,
    lengthAllowanceMm: 254,
  }));
  const lengths = new Map(
    requirements.map((item) => [
      item.id,
      item.lengthMm === null ? null : item.lengthMm + item.lengthAllowanceMm,
    ]),
  );
  return {
    settings: {
      edgeTrimMm: 25.4,
      minimumRemnantWidthMm: 1524,
      minimumRemnantLengthMm: 1524,
      dropAllowanceMm: 254,
    },
    requirements,
    plan: {
      cuts: input.plan.cuts.map((cut) => ({
        ...cut,
        lengthMm: cut.items.reduce<number | null>(
          (longest, item) => {
            const length = lengths.get(item.requirementId) ?? null;
            return length === null || longest === null
              ? null
              : Math.max(longest, length);
          },
          cut.items.length ? 0 : null,
        ),
      })),
    },
  };
}

// The mocked order that has no allocation yet.
export const unallocatedOrderId = 'ffffffff-ffff-4fff-8fff-fffffffffff0';
export async function mockApi(
  page: Page,
  options: { role?: string; signedIn?: boolean; stations?: Station[] } = {},
) {
  const worksheetReviewReplays = new Map<
    string,
    { body: unknown; result: Worksheet }
  >();
  const state = {
    stations: options.stations ?? ['cutting'],
    employees: [
      {
        id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Alex Reed',
        initials: 'AR',
        isActive: true,
        linkedUserId: null,
        revision: 1,
        createdAt: timestamp,
      },
    ],
    productionCompletions: [] as ProductionCompletion[],
    worksheets: [] as Worksheet[],
    productionRequests: [] as { path: string; body: unknown }[],
    worksheetReviewRequests: [] as { key: string; body: unknown }[],
    authenticated: options.signedIn !== false,
    disabled: false,
    catalogColor: structuredClone(color),
    catalogWrites: [] as unknown[],
    allocationRequests: [] as { path: string; body: unknown }[],
    role: options.role ?? 'admin',
    measurementUnits: { ...defaultMeasurementUnits } as MeasurementUnits,
    unitRequests: [] as unknown[],
    colorTheme: 'slate',
    teammateRole: 'staff',
    userRequests: [] as unknown[],
    receiptDraft: structuredClone(receiptDraft),
    receiptSubmitted: false,
    receiptConflict: false,
    submitAttempts: 0,
    stockCreations: 0,
    failFirstSubmit: false,
    draftRequests: [] as {
      body: { data: StockReceiptDraftData };
      key: string | undefined;
    }[],
    allocationDraft: null as ReturnType<
      typeof allocationDraftSchema.parse
    > | null,
    allocation: structuredClone(allocation),
    completionRequests: [] as unknown[],
    orders: [
      { ...structuredClone(order), lines: structuredClone(orderLines) },
      // Not allocated yet, so the allocation editor offers it and it has no
      // ship date.
      {
        ...structuredClone(order),
        id: unallocatedOrderId,
        orderNumber: '104877',
        shipDate: null,
        scheduledAt: null,
        // The allocation flow plans one blind for this order.
        quantity: 1,
        note: null,
        status: 'new' as const,
        allocatedAt: null,
        lines: [] as WorkOrderLine[],
      },
    ],
    orderRequests: [] as { method: string; body: unknown }[],
  };
  const paged = (items: unknown[], url: URL, total = items.length) => ({
    items,
    total,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? 25),
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(4);
    const method = request.method();
    // The app under test calls its own origin. Anything else means a local
    // .env leaked an API URL into the build, which CI would not reproduce.
    if (url.origin !== new URL(page.url()).origin)
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: `Browser tests expect same-origin API calls, not ${url.origin}.`,
        }),
      });
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin':
            request.headers().origin ?? 'http://localhost:3100',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type,Idempotency-Key',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
        body: status === 204 ? undefined : JSON.stringify(body),
      });
    if (method === 'OPTIONS') return send(null, 204);
    if (path === '/auth/me' && state.disabled)
      return send({ message: 'Your account is deactivated.' }, 403);
    if (path === '/auth/me')
      return send(
        state.authenticated
          ? {
              ...user,
              role: state.role,
              stations: state.stations,
              measurementUnits: state.measurementUnits,
              colorTheme: state.colorTheme,
            }
          : { message: 'Sign in required' },
        state.authenticated ? 200 : 401,
      );
    if (path === '/auth/logout') {
      state.authenticated = false;
      return send(null, 204);
    }
    if (!state.authenticated) return send({ message: 'Session expired' }, 401);

    if (path === '/production/employees')
      return send(state.employees.filter((e) => e.isActive));
    if (path === '/employees' && method === 'GET') return send(state.employees);
    if (path === '/employees' && method === 'POST') {
      const body = request.postDataJSON();
      const result = {
        ...body,
        id: crypto.randomUUID(),
        revision: 1,
        createdAt: timestamp,
      };
      state.employees.push(result);
      return send(result, 201);
    }
    if (path.startsWith('/employees/') && method === 'PUT') {
      const { expectedRevision, ...body } = request.postDataJSON();
      void expectedRevision;
      const i = state.employees.findIndex((e) => path.endsWith(e.id));
      state.employees[i] = {
        ...state.employees[i]!,
        ...body,
        revision: state.employees[i]!.revision + 1,
      };
      return send(state.employees[i]);
    }
    const completionPath = path.match(
      /^\/production\/orders\/([^/]+)\/completions$/,
    );
    if (completionPath)
      return send(
        state.productionCompletions.filter(
          (c) => c.workOrderId === completionPath[1],
        ),
      );
    const productionList = path.match(
      /^\/production\/(cutting|assembly|checking|shipping)\/orders$/,
    );
    if (productionList) {
      const station = productionList[1] as Station;
      const view = url.searchParams.get('view');
      const search = url.searchParams.get('search') ?? '';
      return send(
        paged(
          state.orders
            .filter(
              (o) =>
                o.allocatedAt &&
                o.orderNumber.includes(search) &&
                (view !== 'queue' ||
                  (!o.shippedAt &&
                    !state.productionCompletions.some(
                      (c) => c.workOrderId === o.id && c.station === station,
                    ))),
            )
            .map((o) => ({
              ...o,
              completions: state.productionCompletions.filter(
                (c) => c.workOrderId === o.id,
              ),
            })),
          url,
        ),
      );
    }
    const productionComplete = path.match(
      /^\/production\/(cutting|assembly|checking|shipping)\/orders\/([^/]+)\/complete$/,
    );
    if (productionComplete) {
      const station = productionComplete[1] as Station;
      const id = productionComplete[2];
      const body = request.postDataJSON();
      const employee = state.employees.find((e) => e.id === body.employeeId)!;
      const order = state.orders.find((o) => o.id === id)!;
      state.productionRequests.push({ path, body });
      const completedAt = new Date().toISOString();
      state.productionCompletions.push({
        workOrderId: order.id,
        station,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeInitials: employee.initials,
        completedAt,
        recordedAt: completedAt,
        recordedByUserId: ids.user,
      });
      const field = {
        cutting: 'cutAt',
        assembly: 'assembledAt',
        checking: 'checkedAt',
        shipping: 'shippedAt',
      } as const;
      order[field[station]] = completedAt;
      order.revision++;
      order.status = order.shippedAt
        ? 'shipped'
        : order.checkedAt
          ? 'checked'
          : order.assembledAt
            ? 'assembled'
            : order.cutAt
              ? 'cut'
              : order.shipDate
                ? 'scheduled'
                : 'allocated';
      return send({ recordId: order.id, revision: order.revision }, 201);
    }
    const orderWorksheet = path.match(
      /^\/production\/cutting\/orders\/([^/]+)\/worksheet$/,
    );
    if (orderWorksheet) {
      const existing = state.worksheets.find(
        (w) => w.workOrderId === orderWorksheet[1],
      );
      if (method === 'GET') return existing ? send(existing) : send(null, 204);
      if (existing) return send(existing);
      const body = request.postDataJSON();
      const employee = state.employees.find((e) => e.id === body.employeeId)!;
      const sheet: Worksheet = {
        id: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        allocationId: state.allocation.id,
        workOrderId: state.allocation.workOrderId,
        orderNumber: state.allocation.orderNumber,
        revision: 1,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeInitials: employee.initials,
        startedAt: timestamp,
        abandonedAt: null,
        skippedAt: null,
        submittedAt: null,
        reviewedAt: null,
        startedByUserId: ids.user,
        submittedByUserId: null,
        reviewedByUserId: null,
        snapshot: structuredClone(state.allocation),
        draft: null,
        results: null,
      };
      state.worksheets.push(sheet);
      return send(sheet, 201);
    }
    if (path === '/production/cutting/worksheets')
      return send(state.worksheets.filter((w) => !w.reviewedAt));
    const sheetPath = path.match(
      /^\/production\/cutting\/worksheets\/([^/]+)(?:\/(draft|submit|review|return))?$/,
    );
    if (sheetPath) {
      const sheet = state.worksheets.find((w) => w.id === sheetPath[1])!;
      if (method === 'GET') return send(sheet);
      const body = request.postDataJSON();
      if (sheetPath[2] === 'review') {
        const key = request.headers()['idempotency-key'];
        if (!key || !/^[0-9a-f-]{36}$/i.test(key))
          return send({ message: 'Idempotency-Key required.' }, 400);
        state.worksheetReviewRequests.push({ key, body });
        const previous = worksheetReviewReplays.get(`${sheet.id}:${key}`);
        if (previous)
          return JSON.stringify(previous.body) === JSON.stringify(body)
            ? send(previous.result)
            : send({ message: 'Request key payload changed.' }, 409);
        if (sheet.reviewedAt)
          return send({ message: 'Already reconciled.' }, 409);
      }

      if (body.expectedRevision !== sheet.revision)
        return send(
          { message: 'Worksheet changed; reload before saving.' },
          409,
        );
      if (sheetPath[2] === 'draft') sheet.draft = body.draft;
      if (sheetPath[2] === 'submit') {
        sheet.results = body.results;
        sheet.draft = body.draft ?? sheet.draft;
        sheet.submittedAt = new Date().toISOString();
        sheet.submittedByUserId = ids.user;
      }
      if (sheetPath[2] === 'return') {
        sheet.submittedAt = null;
        sheet.submittedByUserId = null;
      }
      if (sheetPath[2] === 'review') {
        sheet.reviewedAt = new Date().toISOString();
        sheet.reviewedByUserId = ids.user;
      }
      sheet.revision++;
      if (sheetPath[2] === 'review')
        worksheetReviewReplays.set(
          `${sheet.id}:${request.headers()['idempotency-key']}`,
          { body, result: structuredClone(sheet) },
        );
      return send(sheet);
    }
    if (path.endsWith('/history')) return send(paged([], url));
    if (path === '/users/me/measurement-units' && method === 'PATCH') {
      const body = request.postDataJSON() as Partial<MeasurementUnits>;
      state.unitRequests.push(body);
      state.measurementUnits = { ...state.measurementUnits, ...body };
      return send({
        ...user,
        role: state.role,
        measurementUnits: state.measurementUnits,
        colorTheme: state.colorTheme,
      });
    }
    if (path === '/users/me/color-theme' && method === 'PATCH') {
      state.colorTheme = (
        request.postDataJSON() as { colorTheme: string }
      ).colorTheme;
      return send({
        ...user,
        role: state.role,
        measurementUnits: state.measurementUnits,
        colorTheme: state.colorTheme,
      });
    }
    if (path === '/work-orders' && method === 'GET') {
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search') ?? '';
      const from = url.searchParams.get('shipDateFrom');
      const to = url.searchParams.get('shipDateTo');
      return send(
        paged(
          state.orders.filter(
            (row) =>
              row.orderNumber.includes(search) &&
              // A date range leaves out the orders that have no date.
              (!from || (row.shipDate !== null && row.shipDate >= from)) &&
              (!to || (row.shipDate !== null && row.shipDate <= to)) &&
              (!status ||
                (status === 'open'
                  ? row.status !== 'shipped'
                  : status === 'unscheduled'
                    ? !!row.allocatedAt && !row.shipDate && !row.shippedAt
                    : row.status === status)),
          ),
          url,
        ),
      );
    }
    if (path === '/work-orders' && method === 'POST') {
      const body = request.postDataJSON();
      state.orderRequests.push({ method, body });
      if (state.orders.some((row) => row.orderNumber === body.orderNumber))
        return send(
          {
            message: 'A work order with this number already exists.',
            issues: [
              {
                code: 'order_already_exists',
                path: ['orderNumber'],
                message: 'Already exists.',
              },
            ],
          },
          409,
        );
      const created = {
        ...order,
        ...body,
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        status: 'new' as const,
        shipDate: null,
        scheduledAt: null,
        allocatedAt: null,
        quantity: 0,
        lines: [] as WorkOrderLine[],
        revision: 1,
      };
      state.orders.push(created);
      return send(created, 201);
    }
    if (path.startsWith('/work-orders/')) {
      const index = state.orders.findIndex((row) => path.includes(row.id));
      const found = state.orders[index];
      if (!found) return send({ message: 'Order not found.' }, 404);
      if (method === 'GET') return send(found);
      const body = request.postDataJSON();
      state.orderRequests.push({ method, body });
      if (path.endsWith('/lines')) {
        const lines: WorkOrderLine[] = body.lines;
        state.orders[index] = {
          ...found,
          lines,
          quantity: lines.reduce((total, line) => total + line.quantity, 0),
          revision: body.expectedRevision + 1,
        };
        return send(state.orders[index]);
      }
      if (method === 'DELETE') {
        state.orders.splice(index, 1);
        return send(null, 204);
      }
      const { expectedRevision, shipped, ...fields } = body;
      const next = {
        ...found,
        ...fields,
        revision: expectedRevision + 1,
        ...(shipped === undefined
          ? {}
          : { shippedAt: shipped ? timestamp : null }),
      };
      // Derived as the API derives it; these orders are never cut.
      state.orders[index] = {
        ...next,
        scheduledAt: next.shipDate ? timestamp : null,
        status: next.shippedAt
          ? ('shipped' as const)
          : next.shipDate
            ? ('scheduled' as const)
            : next.allocatedAt
              ? ('allocated' as const)
              : ('new' as const),
      };
      return send(state.orders[index]);
    }
    if (path === '/users' && method === 'GET')
      return state.role === 'staff'
        ? send({ message: 'Your role cannot perform this action.' }, 403)
        : send(
            paged(
              [
                { ...user, role: state.role },
                { ...teammate, role: state.teammateRole },
              ],
              url,
            ),
          );
    if (path === `/users/${teammate.id}/role` && method === 'PATCH') {
      const body = request.postDataJSON() as { role: string };
      state.userRequests.push(body);
      state.teammateRole = body.role;
      return send({ ...teammate, role: state.teammateRole });
    }
    if (path === '/fabric-catalog/colors')
      return send(paged([state.catalogColor], url));
    if (path === `/fabric-catalog/colors/${ids.color}` && method === 'PATCH') {
      const body = request.postDataJSON();
      state.catalogWrites.push(body);
      state.catalogColor = { ...state.catalogColor, ...body };
      return send(state.catalogColor);
    }
    if (path === '/fabric-catalog/materials')
      return send(
        paged(
          [
            {
              id: ids.material,
              name: color.materialName,
              manufacturerId: ids.manufacturer,
              manufacturerName: color.manufacturerName,
              createdAt: timestamp,
            },
          ],
          url,
        ),
      );
    if (path === '/fabric-catalog/manufacturers')
      return send(
        paged(
          [
            {
              id: ids.manufacturer,
              name: color.manufacturerName,
              createdAt: timestamp,
            },
          ],
          url,
        ),
      );
    if (path === '/locations' || path === '/production/cutting/locations')
      return send(
        paged(
          [
            {
              id: ids.location,
              label: '2',
              sectionId: ids.section,
              sectionLabel: 'A',
              zoneId: ids.zone,
              zoneName: 'Warehouse',
              sortOrder: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          url,
        ),
      );
    if (path === '/locations/zones')
      return send(
        paged(
          [
            {
              id: ids.zone,
              name: 'Warehouse',
              sortOrder: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          url,
        ),
      );
    if (path === '/locations/sections')
      return send(
        paged(
          [
            {
              id: ids.section,
              label: 'A',
              zoneId: ids.zone,
              zoneName: 'Warehouse',
              sortOrder: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          url,
        ),
      );
    if (path === '/stock-items') return send(paged([stock], url, 248));
    if (path === `/stock-items/${ids.stock}`) return send(stock);
    if (path === '/stock-receipts')
      return send(
        paged(
          url.searchParams.get('state') === 'draft'
            ? [state.receiptDraft]
            : [receipt],
          url,
        ),
      );
    if (path === `/stock-receipts/${ids.receipt}` && method === 'GET')
      return send(state.receiptSubmitted ? receipt : state.receiptDraft);
    if (path === '/stock-receipts/drafts') {
      const body = request.postDataJSON() as { data: StockReceiptDraftData };
      state.draftRequests.push({
        body,
        key: request.headers()['idempotency-key'],
      });
      state.receiptDraft = {
        ...receiptDraft,
        purchaseOrderNumber: body.data.purchaseOrderNumber,
        data: body.data,
      };
      return send(state.receiptDraft, 201);
    }
    if (path === `/stock-receipts/${ids.receipt}/draft` && method === 'PUT') {
      if (state.receiptConflict)
        return send(
          { message: 'Receipt changed; refresh before submitting.' },
          409,
        );
      const body = request.postDataJSON();
      state.receiptDraft = {
        ...state.receiptDraft,
        data: body.data,
        purchaseOrderNumber: body.data.purchaseOrderNumber,
        revision: state.receiptDraft.revision + 1,
      };
      return send(state.receiptDraft);
    }
    if (path === `/stock-receipts/${ids.receipt}/submit`) {
      state.submitAttempts++;
      if (!state.receiptSubmitted) {
        state.receiptSubmitted = true;
        state.stockCreations++;
      }
      if (state.failFirstSubmit && state.submitAttempts === 1)
        return send({ message: 'Temporarily unavailable' }, 503);
      return send(receipt);
    }
    if (path === '/allocations')
      return send(
        paged(
          url.searchParams.get('state') === 'draft'
            ? state.allocationDraft
              ? [state.allocationDraft]
              : []
            : [state.allocation],
          url,
          url.searchParams.get('state') === 'active'
            ? 12
            : url.searchParams.get('state') === 'draft'
              ? state.allocationDraft
                ? 1
                : 0
              : 1,
        ),
      );
    if (path === `/allocations/${ids.allocation}` && method === 'GET')
      return send(state.allocationDraft ?? state.allocation);
    if (path.startsWith('/allocations') && method !== 'GET')
      state.allocationRequests.push({ path, body: request.postDataJSON() });
    const orderOf = (workOrderId: string) =>
      state.orders.find((row) => row.id === workOrderId)!;
    if (path === '/allocations/optimize') {
      const requirement = orderOf(request.postDataJSON().workOrderId).lines[0]!;
      return send(
        allocationOptimizationSchema.parse({
          status: 'feasible',
          stockItems: [stock],
          plan: {
            cuts: [
              {
                ...allocation.plan.cuts[0],
                lengthMm: 2540,
                items: [{ requirementId: requirement.id, quantity: 1 }],
              },
            ],
          },
          summary: {
            leftovers: [
              {
                stockItemId: ids.stock,
                cutIndex: 0,
                kind: 'left-edge',
                widthMm: 25.4,
                lengthMm: 2540,
                quantity: 1,
                reusable: false,
              },
              {
                stockItemId: ids.stock,
                cutIndex: 0,
                kind: 'right-edge',
                widthMm: 1600.2,
                lengthMm: 2540,
                quantity: 1,
                reusable: true,
              },
            ],
            reservations: [{ stockItemId: ids.stock, reservedLengthMm: 2540 }],
            inputAreaMm2: (2997.2 * 2540).toFixed(6),
            requiredAreaMm2: (1371.6 * 2540).toFixed(6),
            reusableAreaMm2: (1600.2 * 2540).toFixed(6),
            wasteAreaMm2: (25.4 * 2540).toFixed(6),
            cutCount: 1,
            stockItemCount: 1,
            newRollCount: 1,
          },
        }),
      );
    }
    if (path === `/allocations/${ids.allocation}/draft` && method === 'PUT') {
      const input: AllocationDraftInput = request.postDataJSON().data;
      const named = orderOf(input.workOrderId);
      state.allocationDraft = allocationDraftSchema.parse({
        ...state.allocationDraft,
        workOrderId: named.id,
        orderNumber: named.orderNumber,
        data: draftData(input, named.lines),
        revision: (state.allocationDraft?.revision ?? 0) + 1,
      });
      return send(state.allocationDraft);
    }
    if (path === `/allocations/${ids.allocation}/submit`) {
      const { data, workOrderId, orderNumber } = state.allocationDraft!;
      state.allocation = allocationDetailSchema.parse({
        ...allocation,
        ...data,
        workOrderId,
        orderNumber,
        revision: state.allocationDraft!.revision + 1,
      });
      state.allocationDraft = null;
      return send(state.allocation);
    }
    if (path === '/allocations/drafts') {
      const input: AllocationDraftInput = request.postDataJSON().data;
      const named = orderOf(input.workOrderId);
      state.allocationDraft = allocationDraftSchema.parse({
        ...allocation,
        state: 'draft',
        workOrderId: named.id,
        orderNumber: named.orderNumber,
        data: draftData(input, named.lines),
      });
      return send(state.allocationDraft, 201);
    }
    if (path === '/allocations/validate')
      return send({
        valid: false,
        issues: [
          {
            code: 'WIDTH',
            path: 'plan.cuts.0',
            message: 'The required widths do not fit this stock item.',
          },
        ],
        stockItems: [stock],
      });
    if (path === `/allocations/${ids.allocation}/complete`) {
      state.completionRequests.push(request.postDataJSON());
      state.allocation = {
        ...state.allocation,
        state: 'completed',
        completedAt: timestamp,
        revision: 2,
        completion: {
          submittedByUserId: ids.user,
          items: request.postDataJSON().items,
          unusedStockItemIds: request.postDataJSON().unusedStockItemIds,
          createdStockItemIds: [],
          affectedAllocationIds: [],
        },
      };
      return send(state.allocation);
    }
    return send({ message: `Unhandled test route: ${method} ${path}` }, 404);
  });
  return state;
}
