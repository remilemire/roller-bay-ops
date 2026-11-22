'use client';
import { use } from 'react';
import { CompletionEditor } from '@/features/allocations/completion-editor';
import { CuttingWorkspace } from '@/features/production/cutting-workspace';
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { id } = use(params);
  const { plan } = use(searchParams);
  return (
    <CuttingWorkspace
      planId={plan}
      orderId={id}
      completionEditor={CompletionEditor}
    />
  );
}
