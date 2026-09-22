import { ForbiddenException } from '@nestjs/common';
import type { Station, User } from '@roller-bay/shared/users';
export function requireStation(user: User, station?: Station) {
  if (
    user.role === 'production' &&
    (station ? !user.stations.includes(station) : !user.stations.length)
  )
    throw new ForbiddenException(
      'This account is not assigned to this station.',
    );
}
