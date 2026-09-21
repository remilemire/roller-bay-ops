import { OrderDetailScreen } from '@/features/work-orders/order-detail-screen';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetailScreen id={id} />;
}
