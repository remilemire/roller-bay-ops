'use client';
import type { AllocationDetail } from '@roller-bay/shared/allocations';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { cuttingSheetItems } from '@/features/allocations';
import { stockLocationLabel } from '@/features/stock-items';
import { fieldLabel } from '@/lib/measurements';
import { dateLabel, shortId } from '@/lib/format';
export function CuttingInstructions({
  allocation,
  units,
  checked,
  onCheck,
}: {
  allocation: AllocationDetail;
  units: MeasurementUnits;
  checked: number[];
  onCheck?: (cuts: number[]) => void;
}) {
  const rules = allocation.settings;
  return (
    <div className="stack">
      {allocation.needsReplanning && (
        <p className="notice notice-warning" role="alert">
          Some reserved fabric is no longer available in the required amount.
          Review this plan before cutting.
        </p>
      )}
      <p className="muted">
        Allocation {shortId(allocation.id)} · Plan revision{' '}
        {allocation.revision} · Created {dateLabel(allocation.createdAt)}
      </p>
      <p>
        {rules ? (
          <>
            Edge trim {fieldLabel(units, 'edgeTrim', rules.edgeTrimMm)} each
            side
            {rules.dropAllowanceMm !== undefined && (
              <>
                {' '}
                · Drop allowance{' '}
                {fieldLabel(units, 'dropAllowance', rules.dropAllowanceMm)}
              </>
            )}
          </>
        ) : (
          'Cutting rules were not recorded for this allocation.'
        )}
      </p>
      {cuttingSheetItems(allocation).map((item) => (
        <section className="panel" key={item.stockItem.id}>
          <div className="panel-heading">
            <h2>
              {item.stockItem.fabricColorCode} · {shortId(item.stockItem.id)}
            </h2>
            <span>{item.stockItem.isRemnant ? 'Remnant' : 'Roll'}</span>
          </div>
          <div className="panel-body stack">
            <p>
              {item.stockItem.manufacturerName} · {item.stockItem.materialName}{' '}
              · {fieldLabel(units, 'rollWidth', item.stockItem.widthMm)} wide
            </p>
            <p>
              Location: <strong>{stockLocationLabel(item.stockItem)}</strong>
            </p>
            <dl className="details-grid record-list">
              <div>
                <dt className="detail-label">
                  Length before cutting (last reconciled)
                </dt>
                <dd className="detail-value">
                  {fieldLabel(units, 'rollLength', item.lengthBeforeMm)}
                </dd>
              </div>
              <div>
                <dt className="detail-label">Planned use</dt>
                <dd className="detail-value">
                  {fieldLabel(
                    units,
                    'rollLength',
                    item.cuts.reduce((sum, cut) => sum + cut.lengthMm, 0),
                  )}
                </dd>
              </div>
              <div>
                <dt className="detail-label">Estimated length after cutting</dt>
                <dd className="detail-value">
                  {fieldLabel(units, 'rollLength', item.estimatedAfterMm)}
                </dd>
              </div>
              {!item.stockItem.isRemnant && (
                <div className="span-full">
                  <dt className="detail-label">Tube outer diameter</dt>
                  <dd className="detail-value">
                    {item.stockItem.tubeOuterDiameterMm === null
                      ? 'New roll: measure after the first cut.'
                      : fieldLabel(
                          units,
                          'tubeDiameter',
                          item.stockItem.tubeOuterDiameterMm,
                        )}
                  </dd>
                </div>
              )}
            </dl>
            <p className="muted">
              The estimate does not update stock. Record actual measurements
              after cutting.
            </p>
            {item.cuts.map((c) => (
              <label className="cutting-check" key={c.number}>
                <input
                  type="checkbox"
                  aria-label={`Cut ${c.number} done`}
                  checked={checked.includes(c.number - 1)}
                  disabled={!onCheck}
                  onChange={(e) =>
                    onCheck?.(
                      e.target.checked
                        ? [...checked, c.number - 1]
                        : checked.filter((i) => i !== c.number - 1),
                    )
                  }
                />
                <span>
                  <strong>
                    Cut {c.number} ·{' '}
                    {fieldLabel(units, 'cutLength', c.lengthMm)}
                  </strong>
                  <br />
                  {c.blinds.map((b, i) => (
                    <span key={i}>
                      Blind {b.number} ·{' '}
                      {fieldLabel(units, 'blindWidth', b.widthMm)}
                      {i < c.blinds.length - 1 ? ' / ' : ''}
                    </span>
                  ))}
                </span>
              </label>
            ))}
            {item.plannedRemnants && item.plannedRemnants.length > 0 && (
              <div className="stack">
                <h3>Expected reusable offcuts</h3>
                <ul>
                  {item.plannedRemnants.map((piece, index) => (
                    <li key={index}>
                      {piece.quantity > 1 ? `${piece.quantity} × ` : ''}
                      {fieldLabel(units, 'rollWidth', piece.widthMm)} ×{' '}
                      {fieldLabel(units, 'rollLength', piece.lengthMm)} ·{' '}
                      {piece.source}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  Suggestions from the plan. Enter the actual pieces you keep in
                  cutting results, with their quantities and storage locations.
                </p>
              </div>
            )}
            {rules && (
              <p>
                Keep remnants at least{' '}
                {fieldLabel(
                  units,
                  'minimumRemnantWidth',
                  rules.minimumRemnantWidthMm,
                )}{' '}
                ×{' '}
                {fieldLabel(
                  units,
                  'minimumRemnantLength',
                  rules.minimumRemnantLengthMm,
                )}
                . Each kept piece becomes its own stock item.
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
