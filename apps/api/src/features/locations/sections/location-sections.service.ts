import { Injectable, NotFoundException } from '@nestjs/common';
import {
  locationSectionSchema,
  type CreateLocationSection,
  type UpdateLocationSection,
  type LocationSectionQuery,
} from '@roller-bay/shared/locations';
import { LocationSectionsRepository } from './location-sections.repository.js';
import { locationsOperation } from '../locations.operation.js';

@Injectable()
export class LocationSectionsService {
  constructor(private readonly repository: LocationSectionsRepository) {}
  list(query: LocationSectionQuery) {
    return locationsOperation(async () => {
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
    return locationsOperation(async () =>
      this.toPublic(await this.repository.findById(id)),
    );
  }
  create(input: CreateLocationSection) {
    return locationsOperation(async () =>
      this.toPublic(await this.repository.create(input)),
    );
  }
  update(id: string, input: UpdateLocationSection) {
    return locationsOperation(async () =>
      this.toPublic(await this.repository.update(id, input)),
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
