import * as s from '@roller-bay/shared/locations';
import { api, noContent, queryString } from '@/lib/api';
export const locationsKey = ['locations'] as const;
export type LocationKind = 'levels' | 'sections' | 'zones';
export type LocationRow = {
  id: string;
  name: string;
  parentId: string;
  parent: string;
  sortOrder: string;
};
const path = (kind: LocationKind) =>
  kind === 'levels' ? '/locations' : `/locations/${kind}`;
export async function listLocations(
  kind: LocationKind,
  search: string,
  page: number,
  signal?: AbortSignal,
  parentId?: string,
) {
  const url =
    path(kind) +
    queryString({
      search,
      page,
      pageSize: 25,
      ...(parentId && kind === 'sections' ? { zoneId: parentId } : {}),
      ...(parentId && kind === 'levels' ? { sectionId: parentId } : {}),
    });
  if (kind === 'zones') {
    const data = await api(url, s.locationZoneListSchema, { signal });
    return {
      ...data,
      items: data.items.map((i) => ({
        id: i.id,
        name: i.name,
        parentId: '',
        parent: '',
        sortOrder: String(i.sortOrder),
      })),
    };
  }
  if (kind === 'sections') {
    const data = await api(url, s.locationSectionListSchema, { signal });
    return {
      ...data,
      items: data.items.map((i) => ({
        id: i.id,
        name: i.label,
        parentId: i.zoneId,
        parent: i.zoneName,
        sortOrder: String(i.sortOrder),
      })),
    };
  }
  const data = await api(url, s.locationListSchema, { signal });
  return {
    ...data,
    items: data.items.map((i) => ({
      id: i.id,
      name: i.label,
      parentId: i.sectionId,
      parent: `${i.zoneName} / ${i.sectionLabel}`,
      sortOrder: String(i.sortOrder),
    })),
  };
}
export async function saveLocation(
  kind: LocationKind,
  id: string | undefined,
  input: { name: string; parentId: string; sortOrder: string },
) {
  const method = id ? 'PATCH' : 'POST';
  const url = `${path(kind)}${id ? `/${id}` : ''}`;
  const order = Number(input.sortOrder);
  if (kind === 'zones')
    return api(url, s.locationZoneSchema, {
      method,
      body: s.createLocationZoneSchema.parse({
        name: input.name,
        sortOrder: order,
      }),
    });
  if (kind === 'sections')
    return api(url, s.locationSectionSchema, {
      method,
      body: id
        ? s.updateLocationSectionSchema.parse({
            label: input.name,
            sortOrder: order,
          })
        : s.createLocationSectionSchema.parse({
            label: input.name,
            sortOrder: order,
            zoneId: input.parentId,
          }),
    });
  return api(url, s.locationSchema, {
    method,
    body: id
      ? s.updateLocationSchema.parse({ label: input.name, sortOrder: order })
      : s.createLocationSchema.parse({
          label: input.name,
          sortOrder: order,
          sectionId: input.parentId,
        }),
  });
}
export const deleteLocation = (kind: LocationKind, id: string) =>
  api(`${path(kind)}/${id}`, noContent, { method: 'DELETE' });
export async function lookupLocations(
  search: string,
  page: number,
  signal: AbortSignal,
) {
  const data = await listLocations('levels', search, page, signal);
  return {
    total: data.total,
    items: data.items.map((i) => ({
      id: i.id,
      label: `${i.parent} / ${i.name}`,
    })),
  };
}
