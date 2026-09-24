'use client';
import { CancellationReview } from './cancellation-review';
export function OrderCancellation({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  return <CancellationReview id={id} kind="order" close={close} />;
}
