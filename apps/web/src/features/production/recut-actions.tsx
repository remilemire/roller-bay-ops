'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  recutAssignmentSchema,
  recutBlindsSchema,
  recutRequestSchema,
  recutSignoffSchema,
  recutStockSchema,
  recutWithdrawalSchema,
  type Recut,
  type RecutSelection,
} from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import { useCurrentUser } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
import { measurementLabel } from '@/lib/measurements';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ChoiceField, TextField } from '@/components/ui/field';
import { ErrorNotice, Loading } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import {
  mutationResultSchema,
  productionKey,
  recutStageLabel,
} from './production.api';
import { useProductionWrite } from './use-production-write';
import { EmployeeSelection } from './employee-selection';

function Submit<T>({
  path,
  schema,
  body,
  label,
  close,
  disabled = false,
}: {
  path: string;
  schema: z.ZodType<T>;
  body: T;
  label: string;
  close: () => void;
  disabled?: boolean;
}) {
  const user = useCurrentUser();
  const client = useQueryClient();
  const write = useProductionWrite({
    scope: `recut:${user.id}:${path}`,
    path,
    inputSchema: schema,
    outputSchema: mutationResultSchema,
    onSuccess: async () => {
      await Promise.all(
        [
          productionKey,
          ['allocations'],
          ['stock-items'],
          ['work-orders'],
          ['history'],
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      );
      close();
    },
  });
  return (
    <>
      {write.error && <ErrorNotice error={write.error} />}
      <div className="form-actions">
        <Button
          disabled={
            write.isPending ||
            (!write.pending && (disabled || !schema.safeParse(body).success))
          }
          onClick={() => write.mutate(write.pending ?? body)}
        >
          {write.pending ? 'Retry original request' : label}
        </Button>
      </div>
    </>
  );
}

export function RequestRecut({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Request recut
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Request recut · ${orderNumber}`}
      >
        {open && <RequestForm orderId={orderId} close={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}
function RequestForm({
  orderId,
  close,
}: {
  orderId: string;
  close: () => void;
}) {
  const units = useMeasurementUnits();
  const blinds = useQuery({
    queryKey: [...productionKey, 'recut-blinds', orderId],
    queryFn: () =>
      api(`/production/orders/${orderId}/recut-blinds`, recutBlindsSchema),
  });
  const [requirementId, setBlind] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  if (blinds.isPending) return <Loading />;
  if (blinds.error)
    return (
      <ErrorNotice error={blinds.error} retry={() => void blinds.refetch()} />
    );
  const selected = blinds.data.find((b) => b.id === requirementId);
  return (
    <div className="stack">
      <ChoiceField
        label="Blind to replace"
        value={requirementId}
        onChange={setBlind}
        options={blinds.data.map((b) => ({
          value: b.id,
          label: `Line ${b.position} · ${b.fabricColorCode} · ${measurementLabel(b.widthMm, units.blindWidth)} × ${measurementLabel(b.lengthMm, units.finishedDrop)} · Qty ${b.quantity}`,
        }))}
      />
      <TextField
        label="Replacement quantity"
        inputMode="numeric"
        value={quantity}
        onChange={setQuantity}
      />
      <TextField
        label="Reason for recut"
        value={reason}
        onChange={setReason}
        maxLength={1000}
      />
      <Submit
        path={`/production/orders/${orderId}/recuts`}
        schema={recutRequestSchema}
        body={{
          requirementId,
          quantity: Number(quantity),
          reason,
        }}
        disabled={!selected || Number(quantity) > selected.quantity}
        label="Send recut request"
        close={close}
      />
    </div>
  );
}

type Task = Recut & {
  worksheetId: string | null;
  worksheetRevision?: number | null;
  needsCorrection: boolean;
};
export function RecutActions({
  recut,
  orderRecuts,
  station,
}: {
  recut: Task;
  orderRecuts: Task[];
  station: Station;
}) {
  const user = useCurrentUser();
  const units = useMeasurementUnits();
  // Pin the original revision while a form is open, even if the station refreshes.
  const [edit, setEdit] = useState<{
    action: 'assign' | 'complete' | 'withdraw';
    task: Task;
    eligible: Task[];
  } | null>(null);
  const open = (action: 'assign' | 'complete' | 'withdraw') =>
    setEdit({
      action,
      task: recut,
      eligible: orderRecuts.filter(
        (r) =>
          r.id !== recut.id &&
          r.fabricColorCode === recut.fabricColorCode &&
          r.stage === 'requested',
      ),
    });
  const close = () => setEdit(null);
  const groupSize = recut.allocationId
    ? orderRecuts.filter(
        (r) => r.allocationId === recut.allocationId && r.stage !== 'withdrawn',
      ).length
    : 0;
  return (
    <section className="station-recut">
      <div>
        <strong>
          Recut · {recut.quantity} × {recut.fabricColorCode}
        </strong>{' '}
        · {measurementLabel(recut.widthMm, units.blindWidth)} ×{' '}
        {measurementLabel(recut.lengthMm, units.finishedDrop)}
        <p>
          {recut.reason} · {recutStageLabel[recut.stage]}
        </p>
      </div>
      <div className="inline-actions">
        {recut.stage === 'requested' && user.role !== 'production' && (
          <Button onClick={() => open('assign')}>Assign fabric</Button>
        )}
        {station === 'cutting' &&
          recut.allocationId &&
          orderRecuts.find(
            (r) =>
              r.allocationId === recut.allocationId &&
              (r.stage === 'cutting' || r.needsCorrection),
          )?.id === recut.id && (
            <Button asChild>
              <Link
                href={`/stations/cutting/${recut.workOrderId}?plan=${recut.allocationId}`}
              >
                {recut.needsCorrection
                  ? 'Correct recut measurements'
                  : groupSize > 1
                    ? `Open shared worksheet · ${groupSize} recuts`
                    : 'Open replacement worksheet'}
              </Link>
            </Button>
          )}
        {recut.stage === station &&
          (station === 'assembly' || station === 'checking') && (
            <Button onClick={() => open('complete')}>
              {station === 'assembly'
                ? 'Record replacement assembly'
                : 'Accept replacement'}
            </Button>
          )}
        {user.role !== 'production' &&
          recut.stage !== 'withdrawn' &&
          recut.stage !== 'accepted' && (
            <Button variant="ghost" onClick={() => open('withdraw')}>
              Withdraw recut
            </Button>
          )}
      </div>
      {edit && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) close();
          }}
          title={
            edit.action === 'assign'
              ? 'Assign replacement fabric'
              : edit.action === 'withdraw'
                ? 'Withdraw recut'
                : station === 'assembly'
                  ? 'Record replacement assembly'
                  : 'Accept replacement'
          }
        >
          <RecutForm
            task={edit.task}
            eligible={edit.eligible}
            sharedUncut={
              recut.stage === 'cutting' &&
              orderRecuts.some(
                (r) =>
                  r.id !== recut.id && r.allocationId === recut.allocationId,
              )
            }
            action={edit.action}
            station={station}
            close={close}
          />
        </Dialog>
      )}
    </section>
  );
}
function RecutForm({
  task,
  eligible,
  sharedUncut,
  action,
  station,
  close,
}: {
  task: Task;
  eligible: Task[];
  sharedUncut: boolean;
  action: 'assign' | 'complete' | 'withdraw';
  station: Station;
  close: () => void;
}) {
  const [employeeIds, setEmployees] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const expectedRevision = task.revision;
  const [confirmedUnused, setConfirmedUnused] = useState(false);
  const hasOpenSheet = task.stage === 'cutting' && !!task.worksheetId;
  if (action === 'withdraw')
    return (
      <div className="stack">
        {sharedUncut && (
          <p>
            The app will generate a new cutting plan for the remaining recuts on
            this roll. If the fabric no longer fits, they return to Awaiting
            fabric.
          </p>
        )}
        {hasOpenSheet && (
          <label className="correction-check">
            <input
              type="checkbox"
              checked={confirmedUnused}
              onChange={(e) => setConfirmedUnused(e.target.checked)}
            />{' '}
            No fabric has been cut on this worksheet. Cancel the sheet and
            discard its draft.
          </label>
        )}
        <TextField
          label="Reason for withdrawal"
          value={reason}
          onChange={setReason}
          maxLength={1000}
        />
        <Submit
          path={`/production/recuts/${task.id}/withdraw`}
          schema={recutWithdrawalSchema}
          body={{
            expectedRevision,
            reason,
            ...(hasOpenSheet &&
              confirmedUnused &&
              task.worksheetRevision && {
                unusedWorksheet: {
                  id: task.worksheetId!,
                  expectedRevision: task.worksheetRevision,
                },
              }),
          }}
          disabled={
            hasOpenSheet && (!confirmedUnused || !task.worksheetRevision)
          }
          label="Withdraw recut"
          close={close}
        />
      </div>
    );
  if (action === 'complete')
    return (
      <div className="stack">
        <EmployeeSelection value={employeeIds} onChange={setEmployees} />
        <Submit
          path={`/production/${station}/recuts/${task.id}/complete`}
          schema={recutSignoffSchema}
          body={{ expectedRevision, employeeIds }}
          label={
            station === 'checking' ? 'Accept replacement' : 'Record assembly'
          }
          close={close}
        />
      </div>
    );
  return <AssignFabric task={task} eligible={eligible} close={close} />;
}

function AssignFabric({
  task,
  eligible,
  close,
}: {
  task: Task;
  eligible: Task[];
  close: () => void;
}) {
  const units = useMeasurementUnits();
  const [selected, setSelected] = useState<string[]>([]);
  const [stockItemId, setStock] = useState('');
  const additionalRecuts = eligible
    .filter((r) => selected.includes(r.id))
    .map((r) => ({ id: r.id, expectedRevision: r.revision }));
  const selection: RecutSelection = additionalRecuts.length
    ? { additionalRecuts }
    : {};
  const stock = useQuery({
    queryKey: [...productionKey, 'recut-stock', task.id, selection],
    queryFn: ({ signal }) =>
      additionalRecuts.length
        ? api(`/production/recuts/${task.id}/stock-options`, recutStockSchema, {
            method: 'POST',
            body: selection,
            signal,
          })
        : api(`/production/recuts/${task.id}/stock`, recutStockSchema, {
            signal,
          }),
  });
  return (
    <div className="stack">
      {eligible.length > 0 && (
        <fieldset className="form-fieldset">
          <legend>Cut together on one worksheet</legend>
          {[task, ...eligible].map((r) => (
            <label className="correction-check" key={r.id}>
              <input
                type="checkbox"
                disabled={r.id === task.id}
                checked={r.id === task.id || selected.includes(r.id)}
                onChange={(e) => {
                  setStock('');
                  setSelected(
                    e.target.checked
                      ? [...selected, r.id]
                      : selected.filter((id) => id !== r.id),
                  );
                }}
              />
              {r.quantity} × {r.fabricColorCode} ·{' '}
              {measurementLabel(r.widthMm, units.blindWidth)} ×{' '}
              {measurementLabel(r.lengthMm, units.finishedDrop)} · {r.reason}
            </label>
          ))}
        </fieldset>
      )}
      {stock.isPending ? (
        <Loading />
      ) : stock.error ? (
        <ErrorNotice error={stock.error} retry={() => void stock.refetch()} />
      ) : stock.data.length ? (
        <ChoiceField
          label={`Stock · ${task.fabricColorCode}`}
          value={stockItemId}
          onChange={setStock}
          options={stock.data.map((s) => ({
            value: s.id,
            label: `${s.isRemnant ? 'Remnant' : 'Roll'} ${s.id.slice(0, 8).toUpperCase()} · ${s.locationLabel} · ${measurementLabel(s.widthMm, units.rollWidth)} wide · ${measurementLabel(s.availableLengthMm, units.rollLength)} available`,
          }))}
        />
      ) : (
        <p>No stock can fit the selected replacements.</p>
      )}
      <Submit
        path={`/production/recuts/${task.id}/assign`}
        schema={recutAssignmentSchema}
        body={{ expectedRevision: task.revision, stockItemId, ...selection }}
        disabled={
          !stock.data?.some((s) => s.id === stockItemId) || !!stock.error
        }
        label="Reserve fabric"
        close={close}
      />
    </div>
  );
}
