'use client';
import { use } from 'react';
import { CompletionEditor } from '@/features/allocations/completion-editor';
import { CuttingWorkspace } from '@/features/production/cutting-workspace';
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CuttingWorkspace orderId={id} completionEditor={CompletionEditor} />;
}
