import { AllocationDetailScreen } from '@/features/allocations/allocation-detail-screen';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AllocationDetailScreen id={id} />;
}
