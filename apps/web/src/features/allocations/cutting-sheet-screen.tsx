'use client';
import Link from 'next/link';
import type { z } from 'zod';
import { useState, type ReactNode } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import type {
  AllocationDetail,
  allocationDraftSchema,
} from '@roller-bay/shared/allocations';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Loading, PageHeading } from '@/components/ui/feedback';
import { stockLocationLabel } from '@/features/stock-items';
import { useMeasurementUnits } from '@/features/users';
import { dateLabel, shortId } from '@/lib/format';
import { fieldAmount, fieldLabel, fieldSuffix } from '@/lib/measurements';
import { useHydrated } from '@/lib/use-hydrated';
import { allocationDetail } from './allocations.api';
import { cuttingSheetItems, type SheetItem } from './cutting-sheet';

/**
 * The plan a cutting station froze when it began, if any. Production owns the
 * worksheet; the route supplies its query so this screen can print from it.
 */
export type SavedWorksheetQuery = (workOrderId: string) => UseQueryOptions<{
  allocationId: string;
  snapshot: AllocationDetail;
} | null>;
export function CuttingSheetScreen({
  id,
  savedWorksheet,
}: {
  id: string;
  savedWorksheet: SavedWorksheetQuery;
}) {
  const query = useQuery(allocationDetail(id));
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <AvailableCuttingSheet
      record={query.data}
      savedWorksheet={savedWorksheet}
    />
  );
}
function AvailableCuttingSheet({
  record,
  savedWorksheet,
}: {
  record: AllocationDetail | z.infer<typeof allocationDraftSchema>;
  savedWorksheet: SavedWorksheetQuery;
}) {
  const query = useQuery(savedWorksheet(record.workOrderId));
  if (query.data && query.data.allocationId === record.id)
    return <CuttingSheet allocation={query.data.snapshot} />;
  const id = record.id;
  // Drafts may be incomplete, and once results are recorded the embedded
  // stock rows already hold post-cut balances, so only active plans print.
  if (record.state !== 'active')
    return (
      <div className="notice notice-info">
        <span>
          {record.state === 'draft'
            ? 'Drafts have no cutting sheet. Confirm the allocation first.'
            : `This allocation is ${record.state}; its cutting sheet is no longer available.`}{' '}
          <Link className="text-link" href={`/allocations/${id}`}>
            Back to allocation
          </Link>
        </span>
      </div>
    );
  return <CuttingSheet allocation={record} />;
}

export function CuttingSheet({ allocation }: { allocation: AllocationDetail }) {
  const units = useMeasurementUnits();
  const hydrated = useHydrated();
  const [printedAt] = useState(() => new Date().toISOString());
  const settings = allocation.settings;
  const minimum =
    settings &&
    `${fieldLabel(units, 'minimumRemnantWidth', settings.minimumRemnantWidthMm)} × ${fieldLabel(units, 'minimumRemnantLength', settings.minimumRemnantLengthMm)}`;
  return (
    <div className="sheet">
      <PageHeading
        eyebrow={`CUTTING SHEET · ${shortId(allocation.id)}`}
        title={allocation.orderNumber}
        description={`Revision ${allocation.revision} · Created ${dateLabel(allocation.createdAt)}${hydrated ? ` · Printed ${dateLabel(printedAt)}` : ''}`}
      >
        <Button onClick={() => window.print()}>
          <Printer size={16} />
          Print
        </Button>
        <Button asChild variant="outline">
          <Link href={`/allocations/${allocation.id}`}>Back to allocation</Link>
        </Button>
      </PageHeading>
      {allocation.needsReplanning && (
        <div className="notice notice-warning" role="alert">
          Some reserved fabric is no longer available in the required amount.
          Review this plan before cutting.
        </div>
      )}
      <div className="stack">
        <section className="panel">
          <div className="panel-body">
            {settings ? (
              <div className="sheet-fields">
                <Detail label="Edge trim">
                  {fieldLabel(units, 'edgeTrim', settings.edgeTrimMm)} each edge
                </Detail>
                <Detail label="Minimum remnant (width × length)">
                  {minimum}
                </Detail>
                {settings.dropAllowanceMm !== undefined && (
                  <Detail label="Drop allowance">
                    {fieldLabel(
                      units,
                      'dropAllowance',
                      settings.dropAllowanceMm,
                    )}
                  </Detail>
                )}
              </div>
            ) : (
              <p>Cutting rules were not recorded for this allocation.</p>
            )}
          </div>
        </section>
        {cuttingSheetItems(allocation).map((item) => (
          <StockPanel
            key={item.stockItem.id}
            item={item}
            units={units}
            minimum={minimum}
          />
        ))}
      </div>
    </div>
  );
}

// Each block follows the work order: find the stock, cut, record, keep.
function StockPanel({
  item,
  units,
  minimum,
}: {
  item: SheetItem;
  units: MeasurementUnits;
  minimum: string | null;
}) {
  const stock = item.stockItem;
  const kind = stock.isRemnant ? 'Remnant' : 'Roll';
  // The table mirrors the completion form's retained pieces, so the plan's
  // reusable offcuts are only a hint of what to look for, not rows to tick.
  const expected = item.plannedRemnants
    ?.map(
      (piece) =>
        `${piece.quantity > 1 ? `${piece.quantity} × ` : ''}${fieldLabel(units, 'rollWidth', piece.widthMm)} × ${fieldLabel(units, 'rollLength', piece.lengthMm)} (${piece.source})`,
    )
    .join('; ');
  return (
    <section className="panel sheet-item">
      <div className="panel-heading">
        <div>
          <h2>
            {stock.fabricColorCode} · {shortId(stock.id)}
          </h2>
          <p>
            {kind} · {stock.materialName} · {stock.manufacturerName} ·{' '}
            {fieldLabel(units, 'rollWidth', stock.widthMm)} wide
          </p>
        </div>
      </div>
      <div className="panel-body stack">
        <div className="sheet-fields">
          <Detail label="Current location">{stockLocationLabel(stock)}</Detail>
          <Detail label="Length before cutting">
            {fieldLabel(units, 'rollLength', item.lengthBeforeMm)}
          </Detail>
          <Detail label="Estimated length after cutting">
            {fieldLabel(units, 'rollLength', item.estimatedAfterMm)}
          </Detail>
        </div>
        <div>
          <h3>Cuts</h3>
          <div className="data-table-wrap">
            <table
              aria-label={`Cuts from ${stock.fabricColorCode} ${shortId(stock.id)}`}
            >
              <thead>
                <tr>
                  <th className="sheet-col-check">Done</th>
                  <th className="sheet-col-sm">Cut</th>
                  <th className="sheet-col-md">Cut length</th>
                  <th>Blinds</th>
                </tr>
              </thead>
              <tbody>
                {item.cuts.map((cut) => (
                  <tr key={cut.number}>
                    <td>
                      <Check />
                    </td>
                    <td>Cut {cut.number}</td>
                    <td>{fieldLabel(units, 'cutLength', cut.lengthMm)}</td>
                    <td>
                      <div className="sheet-blinds">
                        {cut.blinds.map((blind, index) => (
                          <span key={index}>
                            Blind {blind.number} ·{' '}
                            {fieldLabel(units, 'blindWidth', blind.widthMm)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>Record after cutting</h3>
          <div className="sheet-choices">
            <Check label="Fully consumed" />
            <Check label={`${kind} returned to storage`} />
          </div>
          <div className="sheet-fields">
            {stock.isRemnant ? (
              <>
                <Detail
                  label={`Remaining width (${fieldSuffix(units, 'rollWidth')})`}
                >
                  <Blank />
                </Detail>
                <Detail
                  label={`Remaining length (${fieldSuffix(units, 'rollLength')})`}
                >
                  <Blank />
                </Detail>
              </>
            ) : (
              <>
                <Detail
                  label={`Tube outer diameter (${fieldSuffix(units, 'tubeDiameter')})`}
                  hint={
                    stock.tubeOuterDiameterMm === null
                      ? 'New roll: measure after the first cut.'
                      : undefined
                  }
                >
                  {stock.tubeOuterDiameterMm === null ? (
                    <Blank />
                  ) : (
                    fieldAmount(
                      units,
                      'tubeDiameter',
                      stock.tubeOuterDiameterMm,
                    )
                  )}
                </Detail>
                <Detail
                  label={`Radial depth (${fieldSuffix(units, 'radialDepth')})`}
                >
                  <Blank />
                </Detail>
              </>
            )}
            <Detail
              grow
              label="Location after use"
              hint="Leave blank if fully consumed."
            >
              <Blank wide />
            </Detail>
          </div>
        </div>
        <div>
          <h3>Kept remnants</h3>
          {expected && (
            <p className="sheet-note sheet-expected">
              Expected reusable offcuts: {expected}
            </p>
          )}
          <div className="data-table-wrap">
            <table
              aria-label={`Kept remnants from ${stock.fabricColorCode} ${shortId(stock.id)}`}
            >
              <thead>
                <tr>
                  <th className="sheet-col-sm">
                    Width ({fieldSuffix(units, 'rollWidth')})
                  </th>
                  <th className="sheet-col-sm">
                    Length ({fieldSuffix(units, 'rollLength')})
                  </th>
                  <th className="sheet-col-check">Qty</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }, (_, index) => (
                  <tr className="sheet-fill" key={index}>
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {minimum && (
            <p className="sheet-note">
              Keep pieces at least {minimum}. Each kept piece becomes its own
              stock item.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Detail({
  label,
  hint,
  grow = false,
  children,
}: {
  label: string;
  hint?: string;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={grow ? 'grow' : undefined}>
      <div className="detail-label">{label}</div>
      <div className="detail-value">{children}</div>
      {hint && <div className="sheet-note">{hint}</div>}
    </div>
  );
}

// Hand-fill affordances are plain bordered spans: borders print everywhere,
// disabled inputs do not, and a paper form needs no control semantics.
function Blank({ wide = false }: { wide?: boolean }) {
  return (
    <span className={wide ? 'sheet-blank wide' : 'sheet-blank'} aria-hidden />
  );
}

function Check({ label }: { label?: string }) {
  return (
    <span className="sheet-check">
      <span className="sheet-box" aria-hidden />
      {label}
    </span>
  );
}
