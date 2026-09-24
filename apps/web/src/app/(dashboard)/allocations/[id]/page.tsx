import { AllocationDetailScreen } from '@/features/allocations/allocation-detail-screen';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  const { id } = await params;
  const { action } = await searchParams;
  return (
    <AllocationDetailScreen
      id={id}
      recordResults={action === 'record-cutting-results'}
    />
  );
}
