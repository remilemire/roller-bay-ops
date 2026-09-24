'use client';
import { useRouter } from 'next/navigation';
import { PageHeading } from '@/components/ui/feedback';
import { OrderStart } from '@/features/work-orders/order-start';
/**
 * Making the order is its own request; the page then opens on it like on any
 * order reached from elsewhere.
 */
export function NewOrder() {
  const router = useRouter();
  return (
    <>
      <PageHeading
        eyebrow="FROM ORDER TO CUTTING PLAN"
        title="New order"
        description="Start with the order's number. Its blinds and its fabric follow."
      />
      <OrderStart
        onCreated={(made) =>
          router.replace(`/allocations/new?workOrder=${made.id}`)
        }
      />
    </>
  );
}
