'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { worksheetForOrder } from './production.api';

export function ExistingCuttingWorksheetLink({
  orderId,
  allocationId,
}: {
  orderId: string;
  allocationId: string;
}) {
  const query = useQuery(worksheetForOrder(orderId));
  if (!query.data || query.data.allocationId !== allocationId) return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/stations/cutting/${orderId}`}>Open cutting worksheet</Link>
    </Button>
  );
}
