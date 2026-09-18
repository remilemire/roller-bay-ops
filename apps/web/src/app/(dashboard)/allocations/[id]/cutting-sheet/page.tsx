import { CuttingSheetScreen } from '@/features/allocations/cutting-sheet-screen';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CuttingSheetScreen id={id} />;
}
