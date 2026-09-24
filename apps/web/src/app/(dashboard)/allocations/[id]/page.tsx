'use client';
import { use } from 'react';
import { AllocationDetailScreen } from '@/features/allocations/allocation-detail-screen';
import { History } from '@/features/audit/history';
import { CancellationReview } from '@/features/work-order-cancellation/cancellation-review';
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  const { id } = use(params);
  const { action } = use(searchParams);
  return (
    <AllocationDetailScreen
      id={id}
      recordResults={action === 'record-cutting-results'}
      history={<History type="allocations" id={id} />}
      cancellation={(close) => (
        <CancellationReview id={id} kind="allocation" close={close} />
      )}
    />
  );
}
