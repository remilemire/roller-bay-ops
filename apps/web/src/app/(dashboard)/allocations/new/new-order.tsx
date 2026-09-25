'use client';
import { useRouter } from 'next/navigation';
import { PageHeading } from '@/components/ui/feedback';
import { OrderCreateForm } from '@/features/work-orders/order-create-dialog';
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
        description="Start with the order's number and blind count. Its blinds and their fabric follow."
      />
      <section className="panel">
        <div className="panel-body">
          <OrderCreateForm
            onCreated={(made) =>
              router.replace(`/allocations/new?workOrder=${made.id}`)
            }
          />
        </div>
      </section>
    </>
  );
}
