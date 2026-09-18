'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  completionCorrectionContextSchema,
  completionCorrectionSchema,
} from '@roller-bay/shared/corrections';
import { api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { Loading, ErrorNotice } from '@/components/ui/feedback';
import {
  lookupLocations,
  locationsKey,
} from '@/features/locations/locations.api';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import {
  fieldInput,
  fieldValue,
  fieldSuffix,
  measurementHelp,
} from '@/lib/measurements';
import { shortId } from '@/lib/format';
import { CorrectionSubmit } from '@/features/corrections/correction-submit';
import { Blockers } from '@/features/corrections/blockers';
type Context = z.infer<typeof completionCorrectionContextSchema>;
export function CompletionCorrectionEditor({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: ['allocations', id, 'correction-context'],
    queryFn: ({ signal }) =>
      api(
        `/allocations/${id}/correction-context`,
        completionCorrectionContextSchema,
        { signal },
      ),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Correct cutting results"
      description="The original completion stays in history. Only selected outcomes and their retained pieces will change."
    >
      {query.isPending ? (
        <Loading />
      ) : query.data ? (
        <CompletionCorrectionForm context={query.data} close={close} />
      ) : (
        <ErrorNotice error={query.error} />
      )}
    </Dialog>
  );
}
// Request-body measurement keys and the form fields that edit them.
const BODY_FIELDS: Record<string, string> = {
  tubeOuterDiameterMm: 'tube',
  radialDepthMm: 'depth',
  explicitLengthMm: 'length',
  widthMm: 'width',
  lengthMm: 'length',
};
function CompletionCorrectionForm({
  context,
  close,
}: {
  context: Context;
  close: () => void;
}) {
  const [original] = useState(context);
  const live = useMeasurementUnits();
  const [units] = useState(live);
  const [rows, setRows] = useState(
    (context.record.completion?.items ?? []).map((item) => {
      const stock = context.stockItems.find((s) => s.id === item.stockItemId);
      return {
        id: item.stockItemId,
        selected: false,
        outcome: item.outcome as string,
        tube: fieldInput(
          units,
          'tubeDiameter',
          stock?.tubeOuterDiameterMm ?? null,
        ),
        depth: fieldInput(units, 'radialDepth', stock?.radialDepthMm ?? null),
        width: fieldInput(units, 'rollWidth', stock?.widthMm ?? null),
        length: fieldInput(
          units,
          'rollLength',
          stock?.explicitLengthMm ?? null,
        ),
        locationId: stock?.locationId ?? '',
        pieces: context.effects
          .filter(
            (e) =>
              !e.before &&
              e.sourceStockItemId === item.stockItemId &&
              !e.after.voidedAt,
          )
          .map((e) => ({
            key: e.stockItemId,
            id: e.stockItemId,
            width: fieldInput(units, 'rollWidth', e.after.widthMm),
            length: fieldInput(units, 'rollLength', e.after.explicitLengthMm),
            locationId: e.after.locationId,
          })),
      };
    }),
  );
  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  if (!original.baselineAvailable)
    return (
      <p className="notice">
        This older completion has no trustworthy stock baseline. Use audited
        current-stock adjustments instead.
      </p>
    );
  return (
    <CorrectionSubmit
      endpoint={`/allocations/${context.record.id}/completion-corrections`}
      schema={completionCorrectionSchema}
      close={close}
      // The body lists only the selected items, so their indexes are mapped
      // back to the stock item each one came from.
      fieldName={(path) => {
        const [, item, part, piece, key] =
          path.match(
            /^items\.(\d+)\.(outcome|retainedPieces\.(\d+))\.(\w+)$/,
          ) ?? [];
        const row = rows.filter((r) => r.selected)[Number(item)];
        const field = key && (BODY_FIELDS[key] ?? key);
        if (!row || !field) return null;
        return part === 'outcome'
          ? `${row.id}.${field}`
          : `${row.id}.pieces.${piece}.${field}`;
      }}
      makeBody={() => ({
        expectedRevision: original.record.revision,
        stockVersions: original.eligibility.map((e) => ({
          stockItemId: e.stockItemId,
          expectedRevision: e.revision,
        })),
        items: rows
          .filter((r) => r.selected)
          .map((r) => ({
            outcome: {
              stockItemId: r.id,
              expectedRevision: original.eligibility.find(
                (e) => e.stockItemId === r.id,
              )!.revision,
              outcome: r.outcome,
              scraps: [],
              ...(r.outcome === 'returned-remnant'
                ? {
                    widthMm: fieldValue(units, 'rollWidth', r.width),
                    explicitLengthMm: fieldValue(units, 'rollLength', r.length),
                    locationId: r.locationId,
                  }
                : {
                    ...(r.tube.trim()
                      ? {
                          tubeOuterDiameterMm: fieldValue(
                            units,
                            'tubeDiameter',
                            r.tube,
                          ),
                        }
                      : {}),
                    ...(r.outcome === 'returned-roll'
                      ? {
                          radialDepthMm: fieldValue(
                            units,
                            'radialDepth',
                            r.depth,
                          ),
                          locationId: r.locationId,
                        }
                      : {}),
                  }),
            },
            removeRetainedPieceIds: original.effects
              .filter(
                (e) =>
                  !e.before &&
                  e.sourceStockItemId === r.id &&
                  !e.after.voidedAt &&
                  !r.pieces.some((p) => p.id === e.stockItemId),
              )
              .map((e) => e.stockItemId),
            retainedPieces: r.pieces.map((p) => ({
              ...(p.id ? { id: p.id } : {}),
              widthMm: fieldValue(units, 'rollWidth', p.width),
              lengthMm: fieldValue(units, 'rollLength', p.length),
              locationId: p.locationId,
            })),
          })),
      })}
    >
      {(errors) => (
        <div className="stack">
          {rows.map((row, index) => {
            const stock = original.stockItems.find((s) => s.id === row.id)!;
            const familyIds = [
              row.id,
              ...original.effects
                .filter(
                  (e) =>
                    !e.before &&
                    e.sourceStockItemId === row.id &&
                    !e.after.voidedAt,
                )
                .map((e) => e.stockItemId),
            ];
            const eligibility = original.eligibility.filter((e) =>
              familyIds.includes(e.stockItemId),
            );
            return (
              <section className="panel" key={row.id}>
                <div className="panel-body">
                  <label className="correction-check">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={eligibility.some((e) => e.blockers.length > 0)}
                      onChange={(e) =>
                        update(index, { selected: e.target.checked })
                      }
                    />
                    Correct {stock?.fabricColorCode} · {shortId(row.id)}
                  </label>
                  <Blockers items={eligibility} />
                  {row.selected && (
                    <div className="stack">
                      <ChoiceField
                        label="Corrected outcome"
                        value={row.outcome}
                        onChange={(outcome) => update(index, { outcome })}
                        error={errors[`${row.id}.outcome`]}
                        options={[
                          { value: 'consumed', label: 'Consumed' },
                          {
                            value: stock.isRemnant
                              ? 'returned-remnant'
                              : 'returned-roll',
                            label: stock.isRemnant
                              ? 'Returned remnant'
                              : 'Returned roll',
                          },
                        ]}
                      />
                      {!stock.isRemnant && (
                        <TextField
                          label={`Tube outer diameter (${fieldSuffix(units, 'tubeDiameter')})`}
                          help={measurementHelp.tubeDiameter}
                          value={row.tube}
                          onChange={(tube) => update(index, { tube })}
                          error={errors[`${row.id}.tube`]}
                          type="number"
                        />
                      )}
                      {row.outcome === 'returned-roll' && (
                        <TextField
                          label={`Radial depth (${fieldSuffix(units, 'radialDepth')})`}
                          help={measurementHelp.radialDepth}
                          value={row.depth}
                          onChange={(depth) => update(index, { depth })}
                          error={errors[`${row.id}.depth`]}
                          type="number"
                          required
                        />
                      )}
                      {row.outcome === 'returned-remnant' && (
                        <>
                          <TextField
                            label={`Width (${fieldSuffix(units, 'rollWidth')})`}
                            value={row.width}
                            onChange={(width) => update(index, { width })}
                            error={errors[`${row.id}.width`]}
                            type="number"
                            required
                          />
                          <TextField
                            label={`Remaining length (${fieldSuffix(units, 'rollLength')})`}
                            value={row.length}
                            onChange={(length) => update(index, { length })}
                            error={errors[`${row.id}.length`]}
                            type="number"
                            required
                          />
                        </>
                      )}
                      {row.outcome !== 'consumed' && (
                        <Lookup
                          label="Returned location"
                          value={row.locationId}
                          onChange={(locationId) =>
                            update(index, { locationId })
                          }
                          error={errors[`${row.id}.locationId`]}
                          queryKey={locationsKey}
                          load={lookupLocations}
                        />
                      )}
                      <h3>Retained pieces</h3>
                      <p className="muted">
                        Removing an existing piece voids its record. Keep pieces
                        that were physically retained.
                      </p>
                      {row.pieces.map((piece, pi) => {
                        const change = (patch: Partial<typeof piece>) =>
                          update(index, {
                            pieces: row.pieces.map((p, i) =>
                              i === pi ? { ...p, ...patch } : p,
                            ),
                          });
                        return (
                          <div className="stack" key={piece.key}>
                            <strong>
                              {piece.id ? shortId(piece.id) : 'New piece'}
                            </strong>
                            <TextField
                              label={`Piece width (${fieldSuffix(units, 'rollWidth')})`}
                              value={piece.width}
                              onChange={(width) => change({ width })}
                              error={errors[`${row.id}.pieces.${pi}.width`]}
                              type="number"
                              required
                            />
                            <TextField
                              label={`Piece length (${fieldSuffix(units, 'rollLength')})`}
                              value={piece.length}
                              onChange={(length) => change({ length })}
                              error={errors[`${row.id}.pieces.${pi}.length`]}
                              type="number"
                              required
                            />
                            <Lookup
                              label="Piece location"
                              value={piece.locationId}
                              onChange={(locationId) => change({ locationId })}
                              error={
                                errors[`${row.id}.pieces.${pi}.locationId`]
                              }
                              queryKey={locationsKey}
                              load={lookupLocations}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                update(index, {
                                  pieces: row.pieces.filter((_, i) => i !== pi),
                                })
                              }
                            >
                              {piece.id ? 'Void piece' : 'Remove new piece'}
                            </Button>
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          update(index, {
                            pieces: [
                              ...row.pieces,
                              {
                                key: crypto.randomUUID(),
                                id: '',
                                width: '',
                                length: '',
                                locationId: row.locationId,
                              },
                            ],
                          })
                        }
                      >
                        Add missing piece
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </CorrectionSubmit>
  );
}
