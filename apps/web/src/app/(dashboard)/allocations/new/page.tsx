import { AllocationEditor } from '@/features/allocations/allocation-editor';
import { NewOrder } from './new-order';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workOrder?: string | string[] }>;
}) {
  const { workOrder } = await searchParams;
  // Keyed by the order: the form reads it once, when it mounts.
  if (typeof workOrder === 'string')
    return <AllocationEditor key={workOrder} workOrderId={workOrder} />;
  return <NewOrder />;
}
