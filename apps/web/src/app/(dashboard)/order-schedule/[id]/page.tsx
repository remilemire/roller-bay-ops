import { OrderDetailScreen } from '@/features/order-schedule/order-detail-screen';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetailScreen id={id} />;
}
