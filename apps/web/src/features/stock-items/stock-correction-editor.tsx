'use client';
import { useState } from 'react';
import type { StockItem } from '@roller-bay/shared/stock-items';
import {
  stockCorrectionSchema,
  stockVoidSchema,
} from '@roller-bay/shared/corrections';
import { Dialog } from '@/components/ui/dialog';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { useMeasurementUnits } from '@/features/users';
import { useCurrentUser } from '@/features/auth';
import { locationsKey, lookupLocations } from '@/features/locations';
import {
  fieldInput,
  fieldValue,
  fieldSuffix,
  measurementHelp,
} from '@/lib/measurements';
import { CorrectionSubmit } from '@/components/corrections/correction-submit';
// Request-body change keys and the form fields that edit them.
const CHANGE_FIELDS: Record<string, string> = {
  widthMm: 'width',
  initialLengthMm: 'length',
  explicitLengthMm: 'remaining',
  radialDepthMm: 'depth',
  tubeOuterDiameterMm: 'tube',
  isUsed: 'used',
  consumedAt: 'consumed',
  locationId: 'locationId',
};
export function StockCorrectionEditor({
  item: initialItem,
  close,
  voiding = false,
}: {
  item: StockItem;
  close: () => void;
  voiding?: boolean;
}) {
  const [item] = useState(initialItem);
  const user = useCurrentUser();
  const live = useMeasurementUnits();
  const [units] = useState(live);
  const [original] = useState(item);
  const [width, setWidth] = useState(
    fieldInput(units, 'rollWidth', item.widthMm),
  );
  const [length, setLength] = useState(
    fieldInput(units, 'rollLength', item.initialLengthMm),
  );
  const [remaining, setRemaining] = useState(
    fieldInput(units, 'rollLength', item.explicitLengthMm),
  );
  const [depth, setDepth] = useState(
    fieldInput(units, 'radialDepth', item.radialDepthMm),
  );
  const [tube, setTube] = useState(
    fieldInput(units, 'tubeDiameter', item.tubeOuterDiameterMm),
  );
  const [used, setUsed] = useState(item.isUsed ? 'yes' : 'no');
  const [consumed, setConsumed] = useState(item.consumedAt ? 'yes' : 'no');
  const [locationId, setLocation] = useState(item.locationId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={voiding ? 'Void stock record' : 'Correct stock'}
      description={
        voiding
          ? 'Use this for a record entered by mistake. Its history will remain available.'
          : 'Record the actual current stock. Older receipt and cutting forms stay unchanged.'
      }
    >
      <CorrectionSubmit
        userId={user.id}
        units={units}
        endpoint={`/stock-items/${item.id}/${voiding ? 'void' : 'corrections'}`}
        schema={voiding ? stockVoidSchema : stockCorrectionSchema}
        close={close}
        fieldName={(path) =>
          CHANGE_FIELDS[path.replace(/^changes\./, '')] ?? null
        }
        makeBody={() => ({
          expectedRevision: original.revision,
          ...(!voiding
            ? {
                changes: {
                  widthMm: fieldValue(units, 'rollWidth', width),
                  initialLengthMm: fieldValue(units, 'rollLength', length),
                  explicitLengthMm: item.isRemnant
                    ? fieldValue(units, 'rollLength', remaining)
                    : null,
                  // Only submit depth when it changed, so unrelated edits retain the stored thickness.
                  ...(fieldValue(units, 'radialDepth', depth) !==
                  original.radialDepthMm
                    ? { radialDepthMm: fieldValue(units, 'radialDepth', depth) }
                    : {}),
                  tubeOuterDiameterMm: item.isRemnant
                    ? null
                    : fieldValue(units, 'tubeDiameter', tube),
                  isUsed: used === 'yes',
                  locationId,
                  consumedAt:
                    consumed === 'yes'
                      ? (original.consumedAt ?? new Date().toISOString())
                      : null,
                },
              }
            : {}),
        })}
      >
        {(errors) =>
          !voiding && (
            <div className="stack">
              <TextField
                label={`Width (${fieldSuffix(units, 'rollWidth')})`}
                value={width}
                onChange={setWidth}
                error={errors.width}
                type="number"
                required
              />
              <TextField
                label={`Initial length (${fieldSuffix(units, 'rollLength')})`}
                value={length}
                onChange={setLength}
                error={errors.length}
                type="number"
                required
              />
              {item.isRemnant ? (
                <TextField
                  label={`Remaining length (${fieldSuffix(units, 'rollLength')})`}
                  value={remaining}
                  onChange={setRemaining}
                  error={errors.remaining}
                  type="number"
                  required
                />
              ) : (
                <>
                  <TextField
                    label={`Radial depth (${fieldSuffix(units, 'radialDepth')})`}
                    help={measurementHelp.radialDepth}
                    value={depth}
                    onChange={setDepth}
                    error={errors.depth}
                    type="number"
                    optional
                  />
                  <TextField
                    label={`Tube outer diameter (${fieldSuffix(units, 'tubeDiameter')})`}
                    help={measurementHelp.tubeDiameter}
                    value={tube}
                    onChange={setTube}
                    error={errors.tube}
                    type="number"
                  />
                </>
              )}
              <ChoiceField
                label="Previously used"
                value={used}
                onChange={setUsed}
                error={errors.used}
                options={[
                  { value: 'no', label: 'No' },
                  { value: 'yes', label: 'Yes' },
                ]}
              />
              <ChoiceField
                label="Consumed"
                value={consumed}
                onChange={setConsumed}
                error={errors.consumed}
                options={[
                  { value: 'no', label: 'No' },
                  { value: 'yes', label: 'Yes' },
                ]}
              />
              <Lookup
                label="Location"
                value={locationId}
                onChange={setLocation}
                error={errors.locationId}
                queryKey={locationsKey}
                load={lookupLocations}
              />
            </div>
          )
        }
      </CorrectionSubmit>
    </Dialog>
  );
}
