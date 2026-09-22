import { CuttingWorkspace } from '@/features/production/cutting-workspace';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CuttingWorkspace orderId={id} />;
}
