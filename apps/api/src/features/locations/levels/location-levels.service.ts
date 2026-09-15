import { Injectable, NotFoundException } from '@nestjs/common';
import {
  locationSchema,
  type CreateLocation,
  type UpdateLocation,
  type LocationQuery,
} from '@roller-bay/shared/locations';
import { LocationLevelsRepository } from './location-levels.repository.js';
import { locationsOperation } from '../locations.operation.js';

@Injectable()
export class LocationLevelsService {
  constructor(private readonly repository: LocationLevelsRepository) {}
  list(query: LocationQuery) {
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
  create(input: CreateLocation) {
    return locationsOperation(async () =>
      this.toPublic(await this.repository.create(input)),
    );
  }
  update(id: string, input: UpdateLocation) {
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
