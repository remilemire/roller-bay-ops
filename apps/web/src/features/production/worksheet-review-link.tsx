'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { worksheetForOrder } from './production.api';

export function WorksheetReviewLink({
  orderId,
  allocationId,
}: {
  orderId: string;
  allocationId: string;
}) {
  const { data: sheet } = useQuery(worksheetForOrder(orderId));
  if (
    !sheet?.submittedAt ||
    sheet.reviewedAt ||
    sheet.allocationId !== allocationId
  )
    return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/stations/review/${sheet.id}`}>
        Review submitted worksheet
      </Link>
    </Button>
  );
}
