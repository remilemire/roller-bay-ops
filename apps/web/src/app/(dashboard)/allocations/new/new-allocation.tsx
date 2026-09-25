'use client';
import { AllocationEditor } from '@/features/allocations/allocation-editor';
import { OrderCreateDialog } from '@/features/work-orders/order-create-dialog';
/** A new allocation, whose order picker can add an order in a modal. */
export function NewAllocation({ workOrderId }: { workOrderId?: string }) {
  return (
    <AllocationEditor
      workOrderId={workOrderId}
      addOrder={(props) => <OrderCreateDialog {...props} />}
    />
  );
}
