import { Injectable, NotFoundException } from '@nestjs/common';
import {
  fabricMaterialSchema,
  type CreateFabricMaterial,
  type FabricMaterialQuery,
  type UpdateFabricMaterial,
} from '@roller-bay/shared/fabric-catalog';
import { UnitOfWork } from '../../../unit-of-work/unit-of-work.js';
import { catalogOperation } from '../catalog.operation.js';
import { FabricMaterialsRepository } from './fabric-materials.repository.js';
@Injectable()
export class FabricMaterialsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: FabricMaterialsRepository,
  ) {}
  list(query: FabricMaterialQuery) {
    return catalogOperation(async () => {
      const result = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.fabricMaterials.list(query),
      );
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
  create(input: CreateFabricMaterial) {
    return catalogOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.fabricMaterials.create(input),
        ),
      ),
    );
  }
  update(id: string, input: UpdateFabricMaterial) {
    return catalogOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.fabricMaterials.update(id, input),
        ),
      ),
    );
  }
  delete(id: string) {
    return catalogOperation(async () => {
      if (!(await this.repository.delete(id)))
        throw new NotFoundException('Catalog record not found.');
    });
  }
  private toPublic(
    row: Awaited<ReturnType<FabricMaterialsRepository['findById']>>,
  ) {
    if (!row) throw new NotFoundException('Catalog record not found.');
    return fabricMaterialSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
