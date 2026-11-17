import Link from 'next/link';
import type { StockCuttingOutcome } from '@roller-bay/shared/stock-items';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { RecordValues } from '@/components/records/record-values';
import { shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';

const outcomeLabels: Record<StockCuttingOutcome['outcome'], string> = {
  consumed: 'Fully consumed',
  'returned-roll': 'Roll returned to stock',
  'returned-remnant': 'Remnant returned to stock',
};

export function SubmittedCuttingResults({
  items,
  units,
}: {
  items: StockCuttingOutcome[];
  units: MeasurementUnits;
}) {
  return (
    <div className="submitted-cutting-results">
      {items.map((item) => (
        <section
          className="submitted-stock-result"
          key={item.stockItemId}
          aria-label={`Stock item ${shortId(item.stockItemId)}`}
        >
          <div className="submitted-stock-heading">
            <h4>
              Stock item{' '}
              <Link href={`/stock-items/${item.stockItemId}`}>
                {shortId(item.stockItemId)}
              </Link>
            </h4>
            <span>{outcomeLabels[item.outcome]}</span>
          </div>
          <dl className="submitted-stock-measurements">
            {'radialDepthMm' in item && (
              <div>
                <dt>Radial depth</dt>
                <dd>{fieldLabel(units, 'radialDepth', item.radialDepthMm)}</dd>
              </div>
            )}
            {'tubeOuterDiameterMm' in item &&
              item.tubeOuterDiameterMm !== undefined && (
                <div>
                  <dt>Tube outer diameter</dt>
                  <dd>
                    {fieldLabel(
                      units,
                      'tubeDiameter',
                      item.tubeOuterDiameterMm,
                    )}
                  </dd>
                </div>
              )}
            {item.outcome === 'returned-remnant' && (
              <>
                <div>
                  <dt>Width</dt>
                  <dd>{fieldLabel(units, 'rollWidth', item.widthMm)}</dd>
                </div>
                <div>
                  <dt>Remaining length</dt>
                  <dd>
                    {fieldLabel(units, 'rollLength', item.explicitLengthMm)}
                  </dd>
                </div>
              </>
            )}
            {'locationId' in item && (
              <div>
                <dt>Return location</dt>
                <dd>
                  <RecordValues
                    value={item.locationId}
                    field="locationId"
                    units={units}
                  />
                </dd>
              </div>
            )}
          </dl>
          {!item.scraps.length ? (
            <p className="submitted-remnant-empty">No retained remnants.</p>
          ) : (
            <div className="submitted-remnants">
              <h4>Retained remnants</h4>
              <ul>
                {item.scraps.map((piece, index) => (
                  <li key={index}>
                    <span>
                      {piece.quantity} ×{' '}
                      {fieldLabel(units, 'rollWidth', piece.widthMm)} wide ·{' '}
                      {fieldLabel(units, 'rollLength', piece.lengthMm)} long
                    </span>
                    <span className="muted">
                      Location{' '}
                      <RecordValues
                        value={piece.locationId}
                        field="locationId"
                        units={units}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
