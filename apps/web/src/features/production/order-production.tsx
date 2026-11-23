'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stationSchema, type Station } from '@roller-bay/shared/users';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import {
  recutSchema,
  milestoneCorrectionSchema,
  type ProductionCompletion,
} from '@roller-bay/shared/production';
import { useCurrentUser, useCanManage } from '@/features/auth';
import { useProductionWrite } from './use-production-write';
import { dateTimeLabel } from '@/lib/format';
import { FACILITY_TIME_ZONE, facilityTimeToIso } from '@/lib/facility-time';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { RequestRecut } from './recut-actions';
import { EmployeeSelection } from './employee-selection';
import {
  recutStageLabel,
  completions,
  completionLabels,
  stationLabels,
  productionKey,
  mutationResultSchema,
  employeeNames,
} from './production.api';
export function OrderProduction({ order }: { order: WorkOrder }) {
  const query = useQuery(completions(order.id));
  const replacements = useQuery({
    queryKey: [...productionKey, 'order-recuts', order.id],
    queryFn: () =>
      api(`/production/orders/${order.id}/recuts`, recutSchema.array()),
    refetchInterval: 10000,
  });
  const canManage = useCanManage();
  const [correcting, setCorrecting] = useState<Station | null>(null);
  const stamp = {
    cutting: 'cutAt',
    assembly: 'assembledAt',
    checking: 'checkedAt',
    shipping: 'shippedAt',
  } as const;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Production</h2>
        {order.allocatedAt && !order.cancelledAt && (
          <RequestRecut orderId={order.id} orderNumber={order.orderNumber} />
        )}
      </div>
      <div className="panel-body stack">
        {query.error && (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        )}
        <dl className="record-list">
          {stationSchema.options.map((s) => {
            const c = query.data?.find((v) => v.station === s);
            return (
              <div key={s}>
                <dt className="detail-label">{stationLabels[s]}</dt>
                <dd className="detail-value inline-actions">
                  <span>
                    {c
                      ? `${employeeNames(c.employees)} · ${dateTimeLabel(c.completedAt)}`
                      : order[stamp[s]]
                        ? `${dateTimeLabel(order[stamp[s]]!)} · Legacy record; employee not recorded`
                        : 'Not recorded'}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Correct ${completionLabels[s]} record`}
                      onClick={() => setCorrecting(s)}
                    >
                      Correct
                    </Button>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        {replacements.error && (
          <ErrorNotice
            error={replacements.error}
            retry={() => void replacements.refetch()}
          />
        )}
        {!!replacements.data?.length && (
          <>
            <h3>Recuts</h3>
            <dl className="record-list">
              {replacements.data.map((r) => (
                <div key={r.id}>
                  <dt>
                    {r.quantity} × {r.fabricColorCode}
                  </dt>
                  <dd>
                    {recutStageLabel[r.stage]} · {r.reason}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {correcting && (
          <Correction
            order={order}
            station={correcting}
            current={query.data?.find((c) => c.station === correcting)}
            close={() => setCorrecting(null)}
          />
        )}
      </div>
    </section>
  );
}
function Correction({
  order,
  station,
  current,
  close,
}: {
  order: WorkOrder;
  station: Station;
  current: ProductionCompletion | undefined;
  close: () => void;
}) {
  // The dialog starts from the recorded attribution so an admin adds or
  // removes people rather than re-entering everyone.
  const [employeeIds, setEmployeeIds] = useState(
    () => current?.employees.map((e) => e.employeeId) ?? [],
  );
  const [reason, setReason] = useState('');
  const [clear, setClear] = useState(false);
  const [time, setTime] = useState('');
  const [timeError, setTimeError] = useState<string>();
  const user = useCurrentUser();
  const client = useQueryClient();
  const scope = `production-correction:${user.id}:${order.id}:${station}`;
  const mutation = useProductionWrite({
    scope,
    path: `/production/${station}/orders/${order.id}/corrections`,
    inputSchema: milestoneCorrectionSchema,
    outputSchema: mutationResultSchema,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: productionKey }),
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
      close();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) close();
      }}
      title={`Correct ${completionLabels[station]} record`}
    >
      <div className="form-stack">
        <label className="check-field">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />{' '}
          Clear this milestone
        </label>
        {!clear && (
          <>
            <EmployeeSelection value={employeeIds} onChange={setEmployeeIds} />
            <TextField
              label={`Actual completion time (${FACILITY_TIME_ZONE})`}
              type="datetime-local"
              value={time}
              onChange={(value) => {
                setTime(value);
                setTimeError(undefined);
              }}
              error={timeError}
            />
          </>
        )}
        <TextField
          label="Reason"
          value={reason}
          onChange={setReason}
          required
        />
        {mutation.error && <ErrorNotice error={mutation.error} />}
        {mutation.pending && (
          <>
            <p>
              The previous correction has an uncertain result. Retry its saved
              employees, time, and reason.
            </p>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(mutation.pending!)}
            >
              Retry original correction
            </Button>
          </>
        )}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !!mutation.pending ||
              !reason.trim() ||
              (!clear && (!employeeIds.length || !time))
            }
            onClick={() => {
              try {
                mutation.mutate({
                  expectedRevision: order.revision,
                  reason,
                  employeeIds: clear ? null : employeeIds,
                  completedAt: clear ? null : facilityTimeToIso(time),
                });
              } catch (error) {
                setTimeError(
                  error instanceof Error ? error.message : 'Invalid time.',
                );
              }
            }}
          >
            Save correction
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
