import {
  stockSnapshotSchema,
  type StockSnapshot,
  type StockEffect,
} from '@roller-bay/shared/stock-items';
import type { AuditChange } from '@roller-bay/shared/audit';
import type {
  StockItemRecord,
  StockItemWrite,
} from './stock-items.repository.js';
export function stockSnapshot(row: StockItemRecord): StockSnapshot {
  const numeric = (v: string | null) => (v === null ? null : Number(v));
  return stockSnapshotSchema.parse({
    ...row,
    widthMm: Number(row.widthMm),
    initialLengthMm: Number(row.initialLengthMm),
    explicitLengthMm: numeric(row.explicitLengthMm),
    radialDepthMm: numeric(row.radialDepthMm),
    tubeOuterDiameterMm: numeric(row.tubeOuterDiameterMm),
    measurementThicknessMm: numeric(row.measurementThicknessMm),
    remainingLengthMm: Number(row.remainingLengthMm),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
  });
}
export function snapshotWrite(s: StockSnapshot): StockItemWrite {
  return {
    fabricColorId: s.fabricColorId,
    isRemnant: s.isRemnant,
    isUsed: s.isUsed,
    widthMm: s.widthMm.toFixed(3),
    initialLengthMm: s.initialLengthMm.toFixed(3),
    explicitLengthMm: s.explicitLengthMm?.toFixed(3) ?? null,
    radialDepthMm: s.radialDepthMm?.toFixed(3) ?? null,
    tubeOuterDiameterMm: s.tubeOuterDiameterMm?.toFixed(3) ?? null,
    measurementThicknessMm: s.measurementThicknessMm?.toFixed(3) ?? null,
    locationId: s.locationId,
    sourceStockItemId: s.sourceStockItemId,
    stockReceiptItemId: s.stockReceiptItemId,
    consumedAt: s.consumedAt ? new Date(s.consumedAt) : null,
    voidedAt: s.voidedAt ? new Date(s.voidedAt) : null,
  };
}
export function stockChanges(effects: StockEffect[]): AuditChange[] {
  return effects.map((e) => ({
    recordType: 'stock-items',
    recordId: e.stockItemId,
    before: e.before ? { type: 'stock-items', value: e.before } : null,
    after: { type: 'stock-items', value: e.after },
  }));
}
