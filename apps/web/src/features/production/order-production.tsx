'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stationSchema, type Station } from '@roller-bay/shared/users';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { milestoneCorrectionSchema } from '@roller-bay/shared/production';
import { useCurrentUser, useCanManage } from '@/features/auth';
import { useProductionWrite } from './use-production-write';
import { dateTimeLabel } from '@/lib/format';
import { FACILITY_TIME_ZONE, facilityTimeToIso } from '@/lib/facility-time';
import { Button } from '@/components/ui/button';
import { ChoiceField, TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { EmployeeSelection, useEmployeeSelection } from './employee-selection';
import { CompletionAction } from './completion-action';
import {
  completions,
  completionLabels,
  stationLabels,
  productionKey,
  mutationResultSchema,
} from './production.api';
export function OrderProduction({ order }: { order: WorkOrder }) {
  const query = useQuery(completions(order.id));
  const canManage = useCanManage();
  const [station, setStation] = useState<Station>('cutting');
  const [correct, setCorrect] = useState(false);
  const employee = useEmployeeSelection();
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
      </div>
      <div className="panel-body stack">
        {query.error && <ErrorNotice error={query.error} />}
        <dl className="record-list">
          {stationSchema.options.map((s) => {
            const c = query.data?.find((v) => v.station === s);
            return (
              <div key={s}>
                <dt className="detail-label">{stationLabels[s]}</dt>
                <dd className="detail-value">
                  {c
                    ? `${c.employeeName} (${c.employeeInitials}) · ${dateTimeLabel(c.completedAt)}`
                    : order[stamp[s]]
                      ? `${dateTimeLabel(order[stamp[s]]!)} · Legacy record; employee not recorded`
                      : 'Not recorded'}
                </dd>
              </div>
            );
          })}
        </dl>
        <ChoiceField
          label="Station"
          value={station}
          onChange={(s) => {
            const next = stationSchema.safeParse(s);
            if (next.success) {
              setStation(next.data);
              employee.selectEmployee('');
            }
          }}
          options={stationSchema.options.map((s) => ({
            value: s,
            label: stationLabels[s],
          }))}
        />
        <EmployeeSelection
          value={employee.employeeId}
          onChange={employee.selectEmployee}
        />
        {!order.cancelledAt && order.allocatedAt && (
          <CompletionAction
            key={station}
            station={station}
            orderId={order.id}
            orderNumber={order.orderNumber}
            employeeId={employee.employeeId}
            done={!!order[stamp[station]]}
          />
        )}
        {canManage && (
          <Button variant="outline" onClick={() => setCorrect(true)}>
            Correct {completionLabels[station]} record
          </Button>
        )}
        {correct && (
          <Correction
            order={order}
            station={station}
            employeeId={employee.employeeId}
            close={() => setCorrect(false)}
          />
        )}
      </div>
    </section>
  );
}
function Correction({
  order,
  station,
  employeeId,
  close,
}: {
  order: WorkOrder;
  station: Station;
  employeeId: string;
  close: () => void;
}) {
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
      <div className="stack">
        <label>
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />{' '}
          Clear this milestone
        </label>
        {!clear && (
          <>
            <p>The selected employee will receive the corrected attribution.</p>
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
              employee, time, and reason.
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
        <Button
          disabled={
            mutation.isPending ||
            !!mutation.pending ||
            !reason.trim() ||
            (!clear && (!employeeId || !time))
          }
          onClick={() => {
            try {
              mutation.mutate({
                expectedRevision: order.revision,
                reason,
                employeeId: clear ? null : employeeId,
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
    </Dialog>
  );
}
