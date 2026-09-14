import { Injectable, NotFoundException } from '@nestjs/common';
import {
  fabricColorSchema,
  type CreateFabricColor,
  type UpdateFabricColor,
  type FabricColorQuery,
} from '@roller-bay/shared/fabric-catalog';
import { FabricColorsRepository } from './fabric-colors.repository.js';
import { catalogOperation } from '../catalog.operation.js';

@Injectable()
export class FabricColorsService {
  constructor(private readonly repository: FabricColorsRepository) {}
  list(query: FabricColorQuery) {
    return catalogOperation(async () => {
      const result = await this.repository.list(query);
      return {
        items: result.items.map((row) => this.toPublic(row)),
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  findById(id: string) {
    return catalogOperation(async () =>
      this.toPublic(await this.repository.findById(id)),
    );
  }
  create(input: CreateFabricColor) {
    return catalogOperation(async () =>
      this.toPublic(await this.repository.create(input)),
    );
  }
  update(id: string, input: UpdateFabricColor) {
    return catalogOperation(async () =>
      this.toPublic(await this.repository.update(id, input)),
    );
  }
  delete(id: string) {
    return catalogOperation(async () => {
      if (!(await this.repository.delete(id)))
        throw new NotFoundException('Catalog record not found.');
    });
  }
  private toPublic(
    row: Awaited<ReturnType<FabricColorsRepository['findById']>>,
  ) {
    if (!row) throw new NotFoundException('Catalog record not found.');
    return fabricColorSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      thicknessMm: Number(row.thicknessMm),
    });
  }
}
