import { stockItemSchema } from '@roller-bay/shared/stock-items';
import {
  stockReceiptDraftSchema,
  stockReceiptDetailSchema,
  type StockReceiptDraftData,
} from '@roller-bay/shared/stock-receipts';
import { allocationDetailSchema } from '@roller-bay/shared/allocations';
import { scheduledOrderSchema } from '@roller-bay/shared/order-schedule';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
export const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  color: '22222222-2222-4222-8222-222222222222',
  stock: '33333333-3333-4333-8333-333333333333',
  location: '44444444-4444-4444-8444-444444444444',
  receipt: '55555555-5555-4555-8555-555555555555',
  allocation: '66666666-6666-4666-8666-666666666666',
  requirement: '77777777-7777-4777-8777-777777777777',
  material: '88888888-8888-4888-8888-888888888888',
  manufacturer: '99999999-9999-4999-8999-999999999999',
  zone: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  section: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  line: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  item: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  order: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};
export const timestamp = '2026-09-16T12:00:00.000Z';
export const user = {
  id: ids.user,
  name: 'Jamie Chen',
  email: 'jamie@example.com',
  role: 'admin',
  isActive: true,
  createdAt: timestamp,
  measurementUnits: defaultMeasurementUnits,
  colorTheme: 'slate',
};
export const color = {
  id: ids.color,
  code: 'C1-000',
  thicknessMm: 0.5,
  materialId: ids.material,
  materialName: 'Linen voile',
  manufacturerId: ids.manufacturer,
  manufacturerName: 'Textile House',
  createdAt: timestamp,
};
export const stock = stockItemSchema.parse({
  id: ids.stock,
  fabricColorId: ids.color,
  fabricColorCode: color.code,
  materialId: ids.material,
  materialName: color.materialName,
  manufacturerId: ids.manufacturer,
  manufacturerName: color.manufacturerName,
  isRemnant: false,
  isUsed: false,
  widthMm: 2997.2,
  initialLengthMm: 54864,
  remainingLengthMm: 54864,
  revision: 1,
  voidedAt: null,
  explicitLengthMm: null,
  radialDepthMm: null,
  tubeOuterDiameterMm: null,
  measurementThicknessMm: null,
  locationId: ids.location,
  locationLabel: '2',
  sectionId: ids.section,
  sectionLabel: 'A',
  zoneId: ids.zone,
  zoneName: 'Warehouse',
  sourceStockItemId: null,
  stockReceiptItemId: ids.line,
  consumedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const receiptData: StockReceiptDraftData = {
  purchaseOrderNumber: '26048',
  items: [
    {
      fabricColorId: ids.color,
      widthMm: 1371.6,
      initialLengthMm: 2286,
      quantity: 2,
      locationId: ids.location,
    },
  ],
};
export const receiptDraft = stockReceiptDraftSchema.parse({
  id: ids.receipt,
  state: 'draft',
  purchaseOrderNumber: receiptData.purchaseOrderNumber,
  createdByUserId: ids.user,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: 1,
  submittedAt: null,
  submittedByUserId: null,
  data: receiptData,
});
export const receipt = stockReceiptDetailSchema.parse({
  ...receiptDraft,
  state: 'submitted',
  submittedAt: timestamp,
  submittedByUserId: ids.user,
  revision: 2,
  items: [
    {
      id: ids.line,
      stockReceiptId: ids.receipt,
      ...receiptData.items[0],
      voidedAt: null,
      stockItemIds: [ids.stock, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
      stockItems: [
        stock,
        { ...stock, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      ].map((item) => ({
        ...item,
        widthMm: 1371.6,
        initialLengthMm: 2286,
        remainingLengthMm: 2286,
      })),
    },
  ],
});
export const allocation = allocationDetailSchema.parse({
  id: ids.allocation,
  orderNumber: '104801',
  state: 'active',
  revision: 1,
  createdByUserId: ids.user,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
  cancelledAt: null,
  needsReplanning: false,
  requirements: [
    {
      id: ids.requirement,
      fabricColorId: ids.color,
      widthMm: 1371.6,
      lengthMm: 2286,
      lengthAllowanceMm: 457.2,
      quantity: 1,
    },
  ],
  settings: {
    edgeTrimMm: 25.4,
    minimumRemnantWidthMm: 254,
    minimumRemnantLengthMm: 457.2,
  },
  plan: {
    cuts: [
      {
        stockItemId: ids.stock,
        lengthMm: 2743.2,
        items: [{ requirementId: ids.requirement, quantity: 1 }],
      },
    ],
  },
  plannedSummary: null,
  items: [
    {
      id: ids.item,
      stockItemId: ids.stock,
      reservedLengthMm: 2743.2,
      stockItem: stock,
    },
  ],
  completion: null,
  correctedAt: null,
});
// Ships on a Friday; the allocation above names this order.
export const order = scheduledOrderSchema.parse({
  id: ids.order,
  orderNumber: '104801',
  shipDate: '2026-10-02',
  quantity: 14,
  note: 'Rush',
  status: 'allocated',
  scheduledAt: timestamp,
  allocatedAt: timestamp,
  cutAt: null,
  shippedAt: null,
  updatedAt: timestamp,
  revision: 3,
});
