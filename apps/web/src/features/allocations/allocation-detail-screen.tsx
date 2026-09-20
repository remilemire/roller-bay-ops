'use client';
import { History } from '@/features/audit/history';
import { useCanManage } from '@/features/auth/auth-boundary';
import { CompletionCorrectionEditor } from './completion-correction-editor';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import {
  allocationRecordSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Check, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  ErrorNotice,
  Loading,
  PageHeading,
  Status,
} from '@/components/ui/feedback';
import { dateLabel, shortId } from '@/lib/format';
import { InfoTip } from '@/components/ui/info-tip';
import { fieldLabel, measurementHelp } from '@/lib/measurements';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { stockLocationLabel } from '@/features/stock-items/stock-location';
import {
  allocationDetail,
  cancelAllocation,
  allocationKey,
} from './allocations.api';
import { AllocationEditor } from './allocation-editor';
import { CompletionEditor } from './completion-editor';
export function AllocationDetailScreen({ id }: { id: string }) {
  const query = useQuery(allocationDetail(id));
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  return (
    <>
      {query.error && (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      )}
      <AllocationRecord key={id} allocation={query.data} />
    </>
  );
}
function AllocationRecord({
  allocation,
}: {
  allocation: z.infer<typeof allocationRecordSchema>;
}) {
  const id = allocation.id;
  const admin = useCanManage();
  const [correcting, setCorrecting] = useState(false);
  const units = useMeasurementUnits();
  // A background confirmation must not replace the employee's open draft form.
  const [draft, setDraft] = useState(
    allocation.state === 'draft' ? allocation : null,
  );
  // Pin the record used to begin editing; refetches must not silently advance
  // the revision against which the employee's changes will be checked.
  const [editingRecord, setEditingRecord] = useState<AllocationDetail | null>(
    null,
  );
  const [mode, setMode] = useState<'read' | 'edit' | 'complete'>('read');
  const [cancel, setCancel] = useState(false);
  const client = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => cancelAllocation(id, allocation.revision),
    onSuccess: async () => {
      setCancel(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: allocationKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
        // Cancelling returns the scheduled order to `scheduled`.
        client.invalidateQueries({ queryKey: ['order-schedule'] }),
      ]);
    },
  });
  if (draft)
    return (
      <>
        <AllocationEditor initial={draft} onSubmitted={() => setDraft(null)} />
        <History type="allocations" id={id} />
      </>
    );
  if (mode === 'edit' && editingRecord)
    return (
      <AllocationEditor active={editingRecord} close={() => setMode('read')} />
    );
  if (mode === 'complete' && editingRecord)
    return (
      <CompletionEditor
        allocation={editingRecord}
        close={() => setMode('read')}
      />
    );
  if (allocation.state === 'draft') return <Loading />;
  return (
    <>
      <PageHeading
        eyebrow={`ALLOCATION · ${shortId(id)}`}
        title={allocation.orderNumber}
        description={`Created ${dateLabel(allocation.createdAt)} · Revision ${allocation.revision}`}
      >
        {allocation.state === 'active' && (
          <Button asChild variant="outline">
            <Link href={`/allocations/${id}/cutting-sheet`}>
              <Printer size={16} />
              Cutting sheet
            </Link>
          </Button>
        )}
        {admin && allocation.state === 'completed' && (
          <Button onClick={() => setCorrecting(true)}>
            Correct cutting results
          </Button>
        )}
        {allocation.state === 'active' && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditingRecord(allocation);
                setMode('edit');
              }}
            >
              <Pencil size={16} />
              Edit plan
            </Button>
            <Button
              onClick={() => {
                setEditingRecord(allocation);
                setMode('complete');
              }}
            >
              <Check size={16} />
              Record cutting results
            </Button>
          </>
        )}
      </PageHeading>
      {allocation.correctedAt && (
        <p className="notice">
          Cutting results corrected {dateLabel(allocation.correctedAt)}.
          Original results remain in history.
        </p>
      )}
      {correcting && (
        <CompletionCorrectionEditor
          id={id}
          close={() => setCorrecting(false)}
        />
      )}
      {allocation.needsReplanning && (
        <div className="notice notice-warning" role="alert">
          Some reserved fabric is no longer available in the required amount.
          Review this plan before cutting.
        </div>
      )}
      <div className="stack">
        <section className="panel">
          <div className="panel-heading">
            <h2>Cutting plan</h2>
            <Status value={allocation.state} />
          </div>
          <div className="panel-body">
            {allocation.plan.cuts.map((cut, index) => {
              const stock = allocation.items.find(
                (item) => item.stockItemId === cut.stockItemId,
              )?.stockItem;
              return (
                <div className="plan-cut" key={index}>
                  <div className="form-row-header">
                    <h3>
                      Cut {index + 1} · {stock?.fabricColorCode} ·{' '}
                      {fieldLabel(units, 'cutLength', cut.lengthMm)}
                      <InfoTip text={measurementHelp.cutLength} />
                    </h3>
                    <Link
                      className="text-link"
                      href={`/stock-items/${cut.stockItemId}`}
                    >
                      {shortId(cut.stockItemId)}
                    </Link>
                  </div>
                  <p
                    className="muted"
                    style={{ margin: '6px 0 12px', fontSize: 12 }}
                  >
                    {stock &&
                      `${fieldLabel(units, 'rollWidth', stock.widthMm)} ${stock.isRemnant ? 'remnant' : 'roll'} · ${stockLocationLabel(stock)}`}
                  </p>
                  <div
                    className="plan-strip"
                    aria-label={`Blind order within cut ${index + 1}`}
                  >
                    {cut.items.flatMap((assignment) => {
                      const ri = allocation.requirements.findIndex(
                        (r) => r.id === assignment.requirementId,
                      );
                      const requirement = allocation.requirements[ri];
                      // One span per physical blind so the strip shows every
                      // piece across the width rather than a combined count.
                      return Array.from(
                        { length: assignment.quantity },
                        (_, copy) => (
                          <span
                            key={`${assignment.requirementId}-${copy}`}
                            style={{ flex: requirement?.widthMm ?? 1 }}
                          >
                            Blind {ri + 1}
                            <br />
                            {requirement &&
                              fieldLabel(
                                units,
                                'blindWidth',
                                requirement.widthMm,
                              )}
                          </span>
                        ),
                      );
                    })}
                  </div>
                  <small className="muted">
                    Assignment order shown; diagram is not a cutting template.
                  </small>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Required blinds</h2>
          </div>
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Blind</th>
                  <th>Width</th>
                  <th>
                    Finished drop
                    <InfoTip text={measurementHelp.finishedDrop} />
                  </th>
                  <th>
                    Drop allowance
                    <InfoTip text={measurementHelp.dropAllowance} />
                  </th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {allocation.requirements.map((r, i) => (
                  <tr key={r.id}>
                    <td>Blind {i + 1}</td>
                    <td>{fieldLabel(units, 'blindWidth', r.widthMm)}</td>
                    <td>{fieldLabel(units, 'finishedDrop', r.lengthMm)}</td>
                    <td>
                      {fieldLabel(units, 'dropAllowance', r.lengthAllowanceMm)}
                    </td>
                    <td>{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {allocation.settings && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Cutting rules</h2>
            </div>
            <div className="panel-body details-grid">
              <div>
                <div className="detail-label">
                  Edge trim
                  <InfoTip text={measurementHelp.edgeTrim} />
                </div>
                <strong>
                  {fieldLabel(
                    units,
                    'edgeTrim',
                    allocation.settings.edgeTrimMm,
                  )}
                </strong>
              </div>
              <div>
                <div className="detail-label">Minimum reusable width</div>
                <strong>
                  {fieldLabel(
                    units,
                    'minimumRemnantWidth',
                    allocation.settings.minimumRemnantWidthMm,
                  )}
                </strong>
              </div>
              <div>
                <div className="detail-label">Minimum reusable length</div>
                <strong>
                  {fieldLabel(
                    units,
                    'minimumRemnantLength',
                    allocation.settings.minimumRemnantLengthMm,
                  )}
                </strong>
              </div>
            </div>
          </section>
        )}
        {allocation.plannedSummary && (
          <div className="notice notice-info">
            <span>
              {allocation.plannedSummary.cutCount} cuts ·{' '}
              {allocation.plannedSummary.stockItemCount} stock items ·{' '}
              {(
                Number(allocation.plannedSummary.wasteAreaMm2) / 1_000_000
              ).toFixed(4)}{' '}
              m² planned waste
            </span>
          </div>
        )}
        {allocation.completion && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Cutting results recorded</h2>
            </div>
            <div className="panel-body stack">
              <p>
                {allocation.completion.items.length} stock outcomes recorded.{' '}
                {allocation.completion.createdStockItemIds.length} retained
                remnants created.
              </p>
              <div className="data-table-wrap">
                <table aria-label="Effective cutting results">
                  <thead>
                    <tr>
                      <th>Stock</th>
                      <th>Outcome</th>
                      <th>Recorded measurements</th>
                      <th>Retained pieces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocation.completion.items.map((outcome) => (
                      <tr key={outcome.stockItemId}>
                        <td>
                          <Link
                            className="text-link"
                            href={`/stock-items/${outcome.stockItemId}`}
                          >
                            {shortId(outcome.stockItemId)}
                          </Link>
                        </td>
                        <td>
                          {outcome.outcome === 'consumed'
                            ? 'Consumed'
                            : outcome.outcome === 'returned-roll'
                              ? 'Returned roll'
                              : 'Returned remnant'}
                        </td>
                        <td>
                          {outcome.outcome === 'returned-roll' ? (
                            <>
                              Depth{' '}
                              {fieldLabel(
                                units,
                                'radialDepth',
                                outcome.radialDepthMm,
                              )}
                              {outcome.tubeOuterDiameterMm !== undefined && (
                                <>
                                  {' '}
                                  · tube{' '}
                                  {fieldLabel(
                                    units,
                                    'tubeDiameter',
                                    outcome.tubeOuterDiameterMm,
                                  )}
                                </>
                              )}
                            </>
                          ) : outcome.outcome === 'returned-remnant' ? (
                            <>
                              {fieldLabel(units, 'rollWidth', outcome.widthMm)}{' '}
                              ×{' '}
                              {fieldLabel(
                                units,
                                'rollLength',
                                outcome.explicitLengthMm,
                              )}
                            </>
                          ) : (
                            'Fully consumed'
                          )}
                        </td>
                        <td>
                          {outcome.scraps.length
                            ? outcome.scraps.map((piece, index) => (
                                <div key={index}>
                                  {piece.quantity} ×{' '}
                                  {fieldLabel(
                                    units,
                                    'rollWidth',
                                    piece.widthMm,
                                  )}{' '}
                                  ×{' '}
                                  {fieldLabel(
                                    units,
                                    'rollLength',
                                    piece.lengthMm,
                                  )}
                                </div>
                              ))
                            : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {allocation.completion.createdStockItemIds.length > 0 && (
                <div className="inline-actions" style={{ flexWrap: 'wrap' }}>
                  {allocation.completion.createdStockItemIds.map((stockId) => (
                    <Link
                      className="text-link"
                      href={`/stock-items/${stockId}`}
                      key={stockId}
                    >
                      Remnant {shortId(stockId)}
                    </Link>
                  ))}
                </div>
              )}
              {allocation.completion.affectedAllocationIds.length > 0 && (
                <div className="notice notice-warning">
                  <div>
                    <strong>Allocations flagged for replanning</strong>
                    {allocation.completion.affectedAllocationIds.map(
                      (other) => (
                        <p key={other}>
                          <Link
                            className="text-link"
                            href={`/allocations/${other}`}
                          >
                            {shortId(other)}
                          </Link>
                        </p>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
        {allocation.state === 'active' && (
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setCancel(true)}>
              Cancel allocation
            </Button>
          </div>
        )}
      </div>
      <History type="allocations" id={id} />
      <Dialog
        open={cancel}
        onOpenChange={setCancel}
        title="Cancel this allocation?"
        description="The order stays in history and its reservations are released. No stock measurements are changed."
      >
        {cancelMutation.error && <ErrorNotice error={cancelMutation.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            onClick={() => setCancel(false)}
            disabled={cancelMutation.isPending}
          >
            Keep allocation
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            Cancel allocation
          </Button>
        </div>
      </Dialog>
    </>
  );
}
