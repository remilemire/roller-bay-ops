import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

// A 512-line cut sheet can exceed Express's default 100 KiB on validation,
// draft save and submission. Mount a router so Nest still installs its normal
// JSON parser for the rest of the API.
export function useAllocationBodyParser(
  app: NestExpressApplication,
  limit: number,
) {
  app.use('/api/allocations', express.Router().use(express.json({ limit })));
}
