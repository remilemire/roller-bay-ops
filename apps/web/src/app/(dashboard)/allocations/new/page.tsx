import { AllocationEditor } from '@/features/allocations/allocation-editor';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workOrder?: string | string[] }>;
}) {
  const { workOrder } = await searchParams;
  const workOrderId = typeof workOrder === 'string' ? workOrder : undefined;
  // Keyed by the order: the form reads it once, when it mounts.
  return <AllocationEditor key={workOrderId} workOrderId={workOrderId} />;
}
