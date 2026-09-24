'use client';
import { use } from 'react';
import { History } from '@/features/audit/history';
import { OrderProduction } from '@/features/production/order-production';
import { CancellationReview } from '@/features/work-order-cancellation/cancellation-review';
import { OrderDetailScreen } from '@/features/work-orders/order-detail-screen';
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <OrderDetailScreen
      id={id}
      history={<History type="work-orders" id={id} />}
      production={(order) => <OrderProduction order={order} />}
      cancellation={(close) => (
        <CancellationReview id={id} kind="order" close={close} />
      )}
    />
  );
}
