'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Scissors } from 'lucide-react';
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
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Scissors size={15} aria-hidden="true" />
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

type Task = Recut & { worksheetId: string | null; needsCorrection: boolean };
export function RecutActions({
  recut,
  station,
}: {
  recut: Task;
  station: Station;
}) {
  const user = useCurrentUser();
  const units = useMeasurementUnits();
  // Pin the original revision while a form is open, even if the station refreshes.
  const [edit, setEdit] = useState<{
    action: 'assign' | 'complete' | 'withdraw';
    task: Task;
  } | null>(null);
  const open = (action: 'assign' | 'complete' | 'withdraw') =>
    setEdit({ action, task: recut });
  const close = () => setEdit(null);
  return (
    <section className="stack">
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
          (recut.stage === 'cutting' || recut.needsCorrection) && (
            <Button asChild>
              <Link
                href={`/stations/cutting/${recut.workOrderId}?plan=${recut.allocationId}`}
              >
                {recut.needsCorrection
                  ? 'Correct recut measurements'
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
  action,
  station,
  close,
}: {
  task: Task;
  action: 'assign' | 'complete' | 'withdraw';
  station: Station;
  close: () => void;
}) {
  const units = useMeasurementUnits();
  const [stockItemId, setStock] = useState('');
  const [employeeIds, setEmployees] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const stock = useQuery({
    queryKey: [...productionKey, 'recut-stock', task.id],
    queryFn: () => api(`/production/recuts/${task.id}/stock`, recutStockSchema),
    enabled: action === 'assign',
  });
  const expectedRevision = task.revision;
  if (action === 'withdraw')
    return (
      <div className="stack">
        <TextField
          label="Reason for withdrawal"
          value={reason}
          onChange={setReason}
          maxLength={1000}
        />
        <Submit
          path={`/production/recuts/${task.id}/withdraw`}
          schema={recutWithdrawalSchema}
          body={{ expectedRevision, reason }}
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
  if (stock.isPending) return <Loading />;
  if (stock.error)
    return (
      <ErrorNotice error={stock.error} retry={() => void stock.refetch()} />
    );
  return (
    <div className="stack">
      {stock.data.length ? (
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
        <p>No stock can fit this replacement quantity.</p>
      )}
      <Submit
        path={`/production/recuts/${task.id}/assign`}
        schema={recutAssignmentSchema}
        body={{ expectedRevision, stockItemId }}
        label="Reserve fabric"
        close={close}
      />
    </div>
  );
}
