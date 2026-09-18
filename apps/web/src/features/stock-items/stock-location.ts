import type { StockItem } from '@roller-bay/shared/stock-items';
/** Zone / section / level, the address read out on the floor. */
export const stockLocationLabel = (
  item: Pick<StockItem, 'zoneName' | 'sectionLabel' | 'locationLabel'>,
) => `${item.zoneName} / ${item.sectionLabel} / ${item.locationLabel}`;
