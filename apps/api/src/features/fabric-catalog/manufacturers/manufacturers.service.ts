import { Injectable, NotFoundException } from '@nestjs/common';
import {
  manufacturerSchema,
  type CreateManufacturer,
  type UpdateManufacturer,
  type ManufacturerQuery,
} from '@roller-bay/shared/fabric-catalog';
import { ManufacturersRepository } from './manufacturers.repository.js';
import { catalogOperation } from '../catalog.operation.js';

@Injectable()
export class ManufacturersService {
  constructor(private readonly repository: ManufacturersRepository) {}
  list(query: ManufacturerQuery) {
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
  create(input: CreateManufacturer) {
    return catalogOperation(async () =>
      this.toPublic(await this.repository.create(input)),
    );
  }
  update(id: string, input: UpdateManufacturer) {
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
    row: Awaited<ReturnType<ManufacturersRepository['findById']>>,
  ) {
    if (!row) throw new NotFoundException('Catalog record not found.');
    return manufacturerSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
