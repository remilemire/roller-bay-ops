import { AllocationEditor } from '@/features/allocations/allocation-editor';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workOrder?: string | string[] }>;
}) {
  const { workOrder } = await searchParams;
  return (
    <AllocationEditor
      workOrderId={typeof workOrder === 'string' ? workOrder : undefined}
    />
  );
}
