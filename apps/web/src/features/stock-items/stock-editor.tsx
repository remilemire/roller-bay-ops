'use client';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { ErrorNotice } from '@/components/ui/feedback';
import { lookupColors, catalogKey } from '@/features/fabric-catalog';
import { lookupLocations, locationsKey } from '@/features/locations';
import { useMeasurementUnits } from '@/features/users';
import { fieldSuffix, fieldValue, measurementHelp } from '@/lib/measurements';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import { saveStock, stockKey } from './stock-items.api';
// Request-body keys and the form fields that edit them.
const BODY_FIELDS = {
  fabricColorId: 'fabricColorId',
  locationId: 'locationId',
  widthMm: 'width',
  initialLengthMm: 'initialLength',
  explicitLengthMm: 'explicitLength',
  radialDepthMm: 'depth',
  tubeOuterDiameterMm: 'tube',
} as const;
const fieldName = (issue: ErrorIssue) =>
  BODY_FIELDS[issuePath(issue) as keyof typeof BODY_FIELDS] ?? null;
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
  const { errors } = form.formState;
  const set = (name: keyof typeof errors & keyof typeof values, v: string) => {
    form.setValue(name, v);
    form.clearErrors(name);
  };
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
        tubeOuterDiameterMm:
          v.kind === 'used' ? fieldValue(units, 'tubeDiameter', v.tube) : null,
        consumedAt: null,
      };
      return saveStock({
        ...measurements,
        fabricColorId: v.fabricColorId,
        isRemnant: v.kind === 'remnant',
      });
    },
    onError: (error) => showFieldIssues(form, error, fieldName),
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
            onChange={(v) => set('fabricColorId', v)}
            error={errors.fabricColorId?.message}
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
              onChange={(v) => set('width', v)}
              error={errors.width?.message}
              type="number"
              required
            />
            <TextField
              label={`Initial length (${fieldSuffix(units, 'rollLength')})`}
              value={values.initialLength}
              onChange={(v) => set('initialLength', v)}
              error={errors.initialLength?.message}
              type="number"
              required
            />
            {values.kind === 'remnant' && (
              <TextField
                label={`Remaining length (${fieldSuffix(units, 'rollLength')})`}
                value={values.explicitLength}
                onChange={(v) => set('explicitLength', v)}
                error={errors.explicitLength?.message}
                type="number"
                required
              />
            )}
            {values.kind === 'used' && (
              <>
                <TextField
                  label={`Tube outer diameter (${fieldSuffix(units, 'tubeDiameter')})`}
                  help={measurementHelp.tubeDiameter}
                  value={values.tube}
                  onChange={(v) => set('tube', v)}
                  error={errors.tube?.message}
                  type="number"
                  required
                />
                <TextField
                  label={`Radial depth (${fieldSuffix(units, 'radialDepth')})`}
                  help={measurementHelp.radialDepth}
                  value={values.depth}
                  onChange={(v) => set('depth', v)}
                  error={errors.depth?.message}
                  type="number"
                />
              </>
            )}
          </div>
          <Lookup
            label="Location"
            value={values.locationId}
            onChange={(v) => set('locationId', v)}
            error={errors.locationId?.message}
            queryKey={locationsKey}
            load={lookupLocations}
          />
        </div>
        {mutation.error && (
          <ErrorNotice
            error={mutation.error}
            inline={(issue) => fieldName(issue) !== null}
          />
        )}
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
