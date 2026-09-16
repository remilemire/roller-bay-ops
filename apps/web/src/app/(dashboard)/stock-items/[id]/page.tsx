import { StockDetailScreen } from '@/features/stock-items/stock-detail-screen';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StockDetailScreen id={id} />;
}
