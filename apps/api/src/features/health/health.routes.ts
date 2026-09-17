import { RequestMethod } from '@nestjs/common';

// Render probes the service directly, so these routes skip middleware that
// expects requests to arrive through the frontend proxy or spends a budget.
export const HEALTH_ROUTES = [
  { path: 'health', method: RequestMethod.GET },
  { path: 'health/ready', method: RequestMethod.GET },
  { path: 'health/solver', method: RequestMethod.GET },
];
