'use client';
import { use } from 'react';
import { CompletionEditor } from '@/features/allocations/completion-editor';
import { WorksheetReviewScreen } from '@/features/production/worksheet-review-screen';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorksheetReviewScreen
      key={id}
      id={id}
      completionEditor={CompletionEditor}
    />
  );
}
