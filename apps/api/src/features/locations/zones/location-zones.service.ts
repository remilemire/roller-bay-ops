import { Injectable, NotFoundException } from '@nestjs/common';
import {
  locationZoneSchema,
  type CreateLocationZone,
  type LocationZoneQuery,
  type UpdateLocationZone,
} from '@roller-bay/shared/locations';
import { UnitOfWork } from '../../../unit-of-work/unit-of-work.js';
import { locationsOperation } from '../locations.operation.js';
import { LocationZonesRepository } from './location-zones.repository.js';
@Injectable()
export class LocationZonesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: LocationZonesRepository,
  ) {}
  list(query: LocationZoneQuery) {
    return locationsOperation(async () => {
      const result = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.locationZones.list(query),
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
  create(input: CreateLocationZone) {
    return locationsOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.locationZones.create(input),
        ),
      ),
    );
  }
  update(id: string, input: UpdateLocationZone) {
    return locationsOperation(async () =>
      this.toPublic(
        await this.unitOfWork.transaction(async (context) =>
          context.locationZones.update(id, input),
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
    row: Awaited<ReturnType<LocationZonesRepository['findById']>>,
  ) {
    if (!row) throw new NotFoundException('Location record not found.');
    return locationZoneSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
