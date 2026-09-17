import * as schemas from '@roller-bay/shared/fabric-catalog';
import { api, noContent, queryString } from '@/lib/api';
export type CatalogKind = 'colors' | 'materials' | 'manufacturers';
export type CatalogRow = {
  id: string;
  name: string;
  parentId: string;
  parent: string;
  manufacturer: string;
  thicknessMm: number | null;
};
export const catalogKey = ['fabric-catalog'] as const;
export async function listCatalog(
  kind: CatalogKind,
  search: string,
  page: number,
  signal?: AbortSignal,
  parentId?: string,
) {
  const suffix = queryString({
    search,
    page,
    pageSize: 25,
    ...(parentId && kind === 'materials' ? { manufacturerId: parentId } : {}),
    ...(parentId && kind === 'colors' ? { materialId: parentId } : {}),
  });
  if (kind === 'colors') {
    const data = await api(
      `/fabric-catalog/colors${suffix}`,
      schemas.fabricColorListSchema,
      { signal },
    );
    return {
      ...data,
      items: data.items.map((i): CatalogRow => ({
        id: i.id,
        name: i.code,
        parentId: i.materialId,
        parent: i.materialName,
        manufacturer: i.manufacturerName,
        thicknessMm: i.thicknessMm,
      })),
    };
  }
  if (kind === 'materials') {
    const data = await api(
      `/fabric-catalog/materials${suffix}`,
      schemas.fabricMaterialListSchema,
      { signal },
    );
    return {
      ...data,
      items: data.items.map((i): CatalogRow => ({
        id: i.id,
        name: i.name,
        parentId: i.manufacturerId,
        parent: i.manufacturerName,
        manufacturer: i.manufacturerName,
        thicknessMm: null,
      })),
    };
  }
  const data = await api(
    `/fabric-catalog/manufacturers${suffix}`,
    schemas.manufacturerListSchema,
    { signal },
  );
  return {
    ...data,
    items: data.items.map((i): CatalogRow => ({
      id: i.id,
      name: i.name,
      parentId: '',
      parent: '',
      manufacturer: '',
      thicknessMm: null,
    })),
  };
}
export async function saveCatalog(
  kind: CatalogKind,
  id: string | undefined,
  input: { name: string; parentId: string; thicknessMm: number | null },
) {
  const method = id ? 'PATCH' : 'POST';
  const path = `/fabric-catalog/${kind}${id ? `/${id}` : ''}`;
  if (kind === 'colors')
    return api(path, schemas.fabricColorSchema, {
      method,
      body: schemas.createFabricColorSchema.parse({
        code: input.name,
        materialId: input.parentId,
        thicknessMm: input.thicknessMm,
      }),
    });
  if (kind === 'materials')
    return api(path, schemas.fabricMaterialSchema, {
      method,
      body: schemas.createFabricMaterialSchema.parse({
        name: input.name,
        manufacturerId: input.parentId,
      }),
    });
  return api(path, schemas.manufacturerSchema, {
    method,
    body: schemas.createManufacturerSchema.parse({ name: input.name }),
  });
}
export const deleteCatalog = (kind: CatalogKind, id: string) =>
  api(`/fabric-catalog/${kind}/${id}`, noContent, { method: 'DELETE' });
export async function lookupColors(
  search: string,
  page: number,
  signal: AbortSignal,
) {
  const data = await listCatalog('colors', search, page, signal);
  return {
    total: data.total,
    items: data.items.map((i) => ({
      id: i.id,
      label: `${i.name} · ${i.parent}`,
    })),
  };
}
