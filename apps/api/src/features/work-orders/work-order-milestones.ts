import type { Station } from '@roller-bay/shared/users';
// Production records own attribution; these fields project its effective milestones onto an order.
export const milestoneTimestampField = {
  cutting: 'cutAt',
  assembly: 'assembledAt',
  checking: 'checkedAt',
  shipping: 'shippedAt',
} as const satisfies Record<Station, string>;
