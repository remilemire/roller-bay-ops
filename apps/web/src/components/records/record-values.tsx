import Link from 'next/link';
import type {
  MeasurementField,
  MeasurementUnits,
} from '@roller-bay/shared/users';
import { calendarDateLabel, dateLabel, shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';
const measurements: Record<string, MeasurementField> = {
  widthMm: 'rollWidth',
  lengthMm: 'rollLength',
  initialLengthMm: 'rollLength',
  explicitLengthMm: 'rollLength',
  remainingLengthMm: 'rollLength',
  radialDepthMm: 'radialDepth',
  tubeOuterDiameterMm: 'tubeDiameter',
  measurementThicknessMm: 'thickness',
  reservedLengthMm: 'rollLength',
  lengthAllowanceMm: 'dropAllowance',
  edgeTrimMm: 'edgeTrim',
  minimumRemnantWidthMm: 'minimumRemnantWidth',
  minimumRemnantLengthMm: 'minimumRemnantLength',
};
const labels: Record<string, string> = {
  fabricColorId: 'Fabric',
  locationId: 'Location',
  initialLengthMm: 'Initial length',
  explicitLengthMm: 'Measured length',
  radialDepthMm: 'Radial depth',
  tubeOuterDiameterMm: 'Tube outer diameter',
  measurementThicknessMm: 'Thickness used',
  widthMm: 'Width',
  lengthMm: 'Length',
  remainingLengthMm: 'Remaining length',
  reservedLengthMm: 'Reserved length',
  lengthAllowanceMm: 'Length allowance',
  edgeTrimMm: 'Edge trim',
  minimumRemnantWidthMm: 'Minimum remnant width',
  minimumRemnantLengthMm: 'Minimum remnant length',
  purchaseOrderNumber: 'Purchase order',
  orderNumber: 'Production order',
  shipDate: 'Ship date',
  scheduledAt: 'Scheduled',
  allocatedAt: 'Allocated',
  cutAt: 'Cut',
  shippedAt: 'Shipped',
  voidedAt: 'Voided',
  consumedAt: 'Consumed',
  sourceStockItemId: 'Source stock',
  stockItemId: 'Stock item',
  isUsed: 'Previously used',
  isRemnant: 'Remnant',
  employees: 'Completed by',
  employeeId: 'Employee',
  employeeName: 'Name',
  employeeInitials: 'Initials',
};
/** Renders an audit or submitted record's values with field labels and units. */
export function RecordValues({
  value,
  field = '',
  referenceLabels = {},
  section = '',
  units,
}: {
  value: unknown;
  field?: string;
  section?: string;
  referenceLabels?: Record<string, string>;
  units: MeasurementUnits;
}) {
  const measurement =
    section === 'requirements' && field === 'widthMm'
      ? 'blindWidth'
      : section === 'requirements' && field === 'lengthMm'
        ? 'finishedDrop'
        : section === 'cuts' && field === 'lengthMm'
          ? 'cutLength'
          : measurements[field];
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === 'number')
    return (
      <span>{measurement ? fieldLabel(units, measurement, value) : value}</span>
    );
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string') {
    if (referenceLabels[value])
      return <span title={value}>{referenceLabels[value]}</span>;
    if (field === 'stockItemId' || field === 'sourceStockItemId')
      return <Link href={`/stock-items/${value}`}>{shortId(value)}</Link>;
    if (field.endsWith('Id') || field === 'id')
      return <span title={value}>{shortId(value)}</span>;
    if (field === 'shipDate') return <span>{calendarDateLabel(value)}</span>;
    if (field.endsWith('At') && value) return <span>{dateLabel(value)}</span>;
    return (
      <span>
        {['returned-roll', 'returned-remnant'].includes(value)
          ? value.replaceAll('-', ' ')
          : value}
      </span>
    );
  }
  if (Array.isArray(value))
    return (
      <ol className="audit-list">
        {value.map((v, i) => (
          <li key={i}>
            <RecordValues
              units={units}
              section={section}
              referenceLabels={referenceLabels}
              value={v}
            />
          </li>
        ))}
      </ol>
    );
  return (
    <dl className="audit-values">
      {Object.entries(value)
        .filter(
          ([k]) =>
            ![
              'revision',
              'expectedRevision',
              'expectedUpdatedAt',
              'updatedAt',
              'createdAt',
              'createdByUserId',
              'submittedByUserId',
              'stockVersions',
              'stockEffects',
              'idempotencyKey',
            ].includes(k),
        )
        .map(([k, v]) => (
          // Nested records stack under their label so depth does not squeeze them.
          <div
            key={k}
            className={v && typeof v === 'object' ? 'nested' : undefined}
          >
            <dt className="detail-label">
              {labels[k] ??
                k
                  .replace(/([A-Z])/g, ' $1')
                  .replace(/^./, (s) => s.toUpperCase())}
            </dt>
            <dd style={{ margin: 0 }}>
              <RecordValues
                units={units}
                referenceLabels={referenceLabels}
                value={v}
                field={k}
                section={['requirements', 'cuts'].includes(k) ? k : section}
              />
            </dd>
          </div>
        ))}
    </dl>
  );
}
