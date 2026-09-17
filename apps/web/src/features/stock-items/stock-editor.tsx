'use client';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { ErrorNotice } from '@/components/ui/feedback';
import {
  lookupColors,
  catalogKey,
} from '@/features/fabric-catalog/catalog.api';
import {
  lookupLocations,
  locationsKey,
} from '@/features/locations/locations.api';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { nullableNumber } from '@/lib/format';
import { fieldSuffix, fieldValue } from '@/lib/measurements';
import { saveStock, stockKey } from './stock-items.api';
export function StockEditor({ close }: { close: () => void }) {
  // Pin the units this form opened with: a session refetch must not relabel
  // or reinterpret dirty input.
  const liveUnits = useMeasurementUnits();
  const [units] = useState(liveUnits);
  const form = useForm({
    defaultValues: {
      fabricColorId: '',
      locationId: '',
      kind: 'new',
      width: '',
      initialLength: '',
      explicitLength: '',
      depth: '',
      tube: '',
    },
  });
  const values = {
    ...form.getValues(),
    ...useWatch({ control: form.control }),
  };
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (v: typeof values) => {
      const measurements = {
        locationId: v.locationId,
        widthMm: fieldValue(units, 'rollWidth', v.width),
        initialLengthMm: fieldValue(units, 'rollLength', v.initialLength),
        isUsed: v.kind !== 'new',
        explicitLengthMm:
          v.kind === 'remnant'
            ? fieldValue(units, 'rollLength', v.explicitLength)
            : null,
        radialDepthMm:
          v.kind === 'used' ? fieldValue(units, 'radialDepth', v.depth) : null,
        tubeOuterDiameterMm: v.kind === 'used' ? nullableNumber(v.tube) : null,
        consumedAt: null,
      };
      return saveStock({
        ...measurements,
        fabricColorId: v.fabricColorId,
        isRemnant: v.kind === 'remnant',
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: stockKey }),
        client.invalidateQueries({ queryKey: ['allocations'] }),
        client.invalidateQueries({ queryKey: ['stock-receipts'] }),
      ]);
      close();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title="Add opening stock"
      description="For fabric already on hand. Record arriving deliveries through Stock receipts."
    >
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <div className="stack">
          <Lookup
            label="Fabric color"
            value={values.fabricColorId}
            onChange={(v) => form.setValue('fabricColorId', v)}
            queryKey={[...catalogKey, 'colors']}
            load={lookupColors}
          />
          <ChoiceField
            label="Stock type"
            value={values.kind}
            onChange={(v) => form.setValue('kind', v)}
            options={[
              { value: 'new', label: 'Unused roll' },
              { value: 'used', label: 'Used roll' },
              { value: 'remnant', label: 'Remnant' },
            ]}
          />
          <div className="form-grid">
            <TextField
              label={`Width (${fieldSuffix(units, 'rollWidth')})`}
              value={values.width}
              onChange={(v) => form.setValue('width', v)}
              type="number"
              required
            />
            <TextField
              label={`Initial length (${fieldSuffix(units, 'rollLength')})`}
              value={values.initialLength}
              onChange={(v) => form.setValue('initialLength', v)}
              type="number"
              required
            />
            {values.kind === 'remnant' && (
              <TextField
                label={`Remaining length (${fieldSuffix(units, 'rollLength')})`}
                value={values.explicitLength}
                onChange={(v) => form.setValue('explicitLength', v)}
                type="number"
                required
              />
            )}
            {values.kind === 'used' && (
              <>
                <TextField
                  label="Tube outer diameter (mm)"
                  value={values.tube}
                  onChange={(v) => form.setValue('tube', v)}
                  type="number"
                  required
                  hint="A positive multiple of 5."
                />
                <TextField
                  label={`Radial depth (${fieldSuffix(units, 'radialDepth')})`}
                  value={values.depth}
                  onChange={(v) => form.setValue('depth', v)}
                  type="number"
                  hint="From the tube surface to the outside of the fabric."
                />
              </>
            )}
          </div>
          <Lookup
            label="Location"
            value={values.locationId}
            onChange={(v) => form.setValue('locationId', v)}
            queryKey={locationsKey}
            load={lookupLocations}
          />
        </div>
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save stock item'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
