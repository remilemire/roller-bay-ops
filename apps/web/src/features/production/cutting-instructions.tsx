'use client';
import type { AllocationDetail } from '@roller-bay/shared/allocations';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { cuttingSheetItems } from '@/features/allocations';
import { stockLocationLabel } from '@/features/stock-items';
import { fieldLabel } from '@/lib/measurements';
import { shortId } from '@/lib/format';
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
      <p>
        Plan revision {allocation.revision}
        {rules && (
          <>
            {' '}
            · Edge trim {fieldLabel(units, 'edgeTrim', rules.edgeTrimMm)} each
            side · Drop allowance{' '}
            {fieldLabel(units, 'dropAllowance', rules.dropAllowanceMm ?? 0)}
          </>
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
            <p>Location at start: {stockLocationLabel(item.stockItem)}</p>
            <p>
              Last reconciled length:{' '}
              {fieldLabel(units, 'rollLength', item.lengthBeforeMm)} · Planned
              use:{' '}
              {fieldLabel(
                units,
                'rollLength',
                item.lengthBeforeMm - item.estimatedAfterMm,
              )}
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
                .
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
