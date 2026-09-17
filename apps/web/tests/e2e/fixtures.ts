import type { Page } from '@playwright/test';
import {
  allocationDraftSchema,
  allocationDetailSchema,
  allocationOptimizationSchema,
  type AllocationDraftInput,
} from '@roller-bay/shared/allocations';
import type { StockReceiptDraftData } from '@roller-bay/shared/stock-receipts';
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
} from '../fixtures';
export { ids } from '../fixtures';
const teammate = {
  ...user,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name: 'Robin Park',
  email: 'robin@example.com',
};
export async function mockApi(
  page: Page,
  options: { role?: string; signedIn?: boolean } = {},
) {
  const state = {
    authenticated: options.signedIn !== false,
    disabled: false,
    catalogColor: structuredClone(color),
    catalogWrites: [] as unknown[],
    allocationRequests: [] as { path: string; body: unknown }[],
    role: options.role ?? 'admin',
    measurementUnits: { ...defaultMeasurementUnits } as MeasurementUnits,
    unitRequests: [] as unknown[],
    teammateRole: 'user',
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
              measurementUnits: state.measurementUnits,
            }
          : { message: 'Sign in required' },
        state.authenticated ? 200 : 401,
      );
    if (path === '/auth/logout') {
      state.authenticated = false;
      return send(null, 204);
    }
    if (!state.authenticated) return send({ message: 'Session expired' }, 401);
    if (path.endsWith('/history')) return send(paged([], url));
    if (path === '/users/me/measurement-units' && method === 'PATCH') {
      const body = request.postDataJSON() as Partial<MeasurementUnits>;
      state.unitRequests.push(body);
      state.measurementUnits = { ...state.measurementUnits, ...body };
      return send({
        ...user,
        role: state.role,
        measurementUnits: state.measurementUnits,
      });
    }
    if (path === '/users' && method === 'GET')
      return state.role === 'user'
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
    if (path === '/locations')
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
    if (path === '/allocations/optimize') {
      const requirement = request.postDataJSON().requirements[0];
      return send(
        allocationOptimizationSchema.parse({
          status: 'feasible',
          stockItems: [stock],
          plan: {
            drops: [
              {
                ...allocation.plan.drops[0],
                lengthMm: 2540,
                items: [{ requirementId: requirement.id, quantity: 1 }],
              },
            ],
          },
          summary: {
            leftovers: [
              {
                stockItemId: ids.stock,
                dropIndex: 0,
                kind: 'left-edge',
                widthMm: 25.4,
                lengthMm: 2540,
                quantity: 1,
                reusable: false,
              },
              {
                stockItemId: ids.stock,
                dropIndex: 0,
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
            dropCount: 1,
            stockItemCount: 1,
            newRollCount: 1,
          },
        }),
      );
    }
    if (path === `/allocations/${ids.allocation}/draft` && method === 'PUT') {
      const input = request.postDataJSON().data as AllocationDraftInput;
      const data = {
        ...input,
        settings: {
          edgeTrimMm: 25.4,
          minimumRemnantWidthMm: 1524,
          minimumRemnantLengthMm: 1524,
          dropAllowanceMm: 254,
        },
        requirements: input.requirements.map((item) => ({
          ...item,
          lengthAllowanceMm: 254,
        })),
      };
      state.allocationDraft = allocationDraftSchema.parse({
        ...state.allocationDraft,
        orderNumber: data.orderNumber,
        data,
        revision: (state.allocationDraft?.revision ?? 0) + 1,
      });
      return send(state.allocationDraft);
    }
    if (path === `/allocations/${ids.allocation}/submit`) {
      const data = state.allocationDraft!.data;
      state.allocation = allocationDetailSchema.parse({
        ...allocation,
        ...data,
        revision: state.allocationDraft!.revision + 1,
      });
      state.allocationDraft = null;
      return send(state.allocation);
    }
    if (path === '/allocations/drafts') {
      const input = request.postDataJSON().data as AllocationDraftInput;
      const data = {
        ...input,
        settings: {
          edgeTrimMm: 25.4,
          minimumRemnantWidthMm: 1524,
          minimumRemnantLengthMm: 1524,
          dropAllowanceMm: 254,
        },
        requirements: input.requirements.map((item) => ({
          ...item,
          lengthAllowanceMm: 254,
        })),
      };
      state.allocationDraft = allocationDraftSchema.parse({
        ...allocation,
        state: 'draft',
        orderNumber: data.orderNumber,
        data,
      });
      return send(state.allocationDraft, 201);
    }
    if (path === '/allocations/validate')
      return send({
        valid: false,
        issues: [
          {
            code: 'WIDTH',
            path: 'plan.drops.0',
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
