'use client';
import { use } from 'react';
import { CuttingSheetScreen } from '@/features/allocations/cutting-sheet-screen';
import { worksheetForOrder } from '@/features/production/production.api';
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CuttingSheetScreen id={id} savedWorksheet={worksheetForOrder} />;
}
