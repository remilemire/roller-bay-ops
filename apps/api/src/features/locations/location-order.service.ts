import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MoveLocation } from '@roller-bay/shared/locations';
import { DatabaseService } from '../../database/database.service.js';
import {
  LocationOrderRepository,
  type OrderedLocationKind,
} from './location-order.repository.js';
import { locationsOperation } from './locations.operation.js';

@Injectable()
export class LocationOrderService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: LocationOrderRepository,
  ) {}

  move(kind: OrderedLocationKind, id: string, input: MoveLocation) {
    return locationsOperation(() =>
      this.database.db.transaction(async (tx) => {
        const siblings = await this.repository.lockSiblings(tx, kind, id);
        const ids = siblings.map((row) => row.id);
        if (!ids.includes(id))
          throw new NotFoundException('Location record not found.');
        if (!ids.includes(input.targetId)) {
          throw new ConflictException(
            'The destination is no longer in this parent. Refresh and try again.',
          );
        }
        if (id === input.targetId) return;
        const ordered = ids.filter((value) => value !== id);
        const destination =
          ordered.indexOf(input.targetId) +
          (input.position === 'after' ? 1 : 0);
        ordered.splice(destination, 0, id);
        await this.repository.saveOrder(tx, kind, ordered);
      }),
    );
  }
}
