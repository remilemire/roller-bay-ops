'use client';
import { CancellationReview } from '@/features/work-orders/cancellation-review';
export function AllocationCancellation({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  return <CancellationReview id={id} kind="allocation" close={close} />;
}
