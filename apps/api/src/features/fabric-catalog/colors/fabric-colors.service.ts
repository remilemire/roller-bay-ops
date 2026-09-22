import { Injectable, NotFoundException } from '@nestjs/common';
import {
  fabricColorSchema,
  type CreateFabricColor,
  type FabricColorQuery,
  type UpdateFabricColor,
} from '@roller-bay/shared/fabric-catalog';
import { UnitOfWork } from '../../../unit-of-work/unit-of-work.js';
import { catalogOperation } from '../catalog.operation.js';
import { FabricColorsRepository } from './fabric-colors.repository.js';
@Injectable()
export class FabricColorsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: FabricColorsRepository,
  ) {}
  list(query: FabricColorQuery) {
    return catalogOperation(async () => {
      const result = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.fabricColors.list(query),
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
  create(input: CreateFabricColor) {
    return catalogOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.fabricColors.create(input),
        ),
      ),
    );
  }
  update(id: string, input: UpdateFabricColor) {
    return catalogOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.fabricColors.update(id, input),
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
