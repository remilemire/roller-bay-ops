import { Injectable, NotFoundException } from '@nestjs/common';
import {
  locationSectionSchema,
  type CreateLocationSection,
  type LocationSectionQuery,
  type UpdateLocationSection,
} from '@roller-bay/shared/locations';
import { UnitOfWork } from '../../../unit-of-work/unit-of-work.js';
import { locationsOperation } from '../locations.operation.js';
import { LocationSectionsRepository } from './location-sections.repository.js';
@Injectable()
export class LocationSectionsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: LocationSectionsRepository,
  ) {}
  list(query: LocationSectionQuery) {
    return locationsOperation(async () => {
      const result = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.locationSections.list(query),
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
  create(input: CreateLocationSection) {
    return locationsOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.locationSections.create(input),
        ),
      ),
    );
  }
  update(id: string, input: UpdateLocationSection) {
    return locationsOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.locationSections.update(id, input),
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
    row: Awaited<ReturnType<LocationSectionsRepository['findById']>>,
  ) {
    if (!row) throw new NotFoundException('Location record not found.');
    return locationSectionSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
