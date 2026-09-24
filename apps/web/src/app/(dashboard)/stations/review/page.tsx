'use client';
import { CompletionEditor } from '@/features/allocations/completion-editor';
import { CuttingReviewScreen } from '@/features/production/cutting-review-screen';
export default function Page() {
  return <CuttingReviewScreen completionEditor={CompletionEditor} />;
}
