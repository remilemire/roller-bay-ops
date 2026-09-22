import { Injectable, NotFoundException } from '@nestjs/common';
import {
  locationSchema,
  type CreateLocation,
  type LocationQuery,
  type UpdateLocation,
} from '@roller-bay/shared/locations';
import { UnitOfWork } from '../../../unit-of-work/unit-of-work.js';
import { locationsOperation } from '../locations.operation.js';
import { LocationLevelsRepository } from './location-levels.repository.js';
@Injectable()
export class LocationLevelsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: LocationLevelsRepository,
  ) {}
  list(query: LocationQuery) {
    return locationsOperation(async () => {
      const result = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.locationLevels.list(query),
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
    return locationsOperation(async () =>
      this.toPublic(await this.repository.findById(id)),
    );
  }
  create(input: CreateLocation) {
    return locationsOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.locationLevels.create(input),
        ),
      ),
    );
  }
  update(id: string, input: UpdateLocation) {
    return locationsOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.locationLevels.update(id, input),
        ),
      ),
    );
  }
  delete(id: string) {
    return locationsOperation(async () => {
      if (!(await this.repository.delete(id)))
        throw new NotFoundException('Location record not found.');
    });
  }
  private toPublic(
    row: Awaited<ReturnType<LocationLevelsRepository['findById']>>,
  ) {
    if (!row) throw new NotFoundException('Location record not found.');
    return locationSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
