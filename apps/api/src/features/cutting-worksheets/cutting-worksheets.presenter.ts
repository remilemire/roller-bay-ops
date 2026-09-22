import {
  worksheetSchema,
  worksheetListSchema,
} from '@roller-bay/shared/production';
import type { WorksheetRecord } from './cutting-worksheets.table.js';
export const presentWorksheet = (row: WorksheetRecord) =>
  worksheetSchema.parse({
    ...row,
    startedAt: row.startedAt.toISOString(),
    abandonedAt: row.abandonedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  });
export const presentWorksheetSummary = (row: WorksheetRecord) =>
  worksheetListSchema.element.parse(presentWorksheet(row));
