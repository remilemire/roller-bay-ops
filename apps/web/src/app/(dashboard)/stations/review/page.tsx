import { redirect } from 'next/navigation';
import { CuttingReviewScreen } from '@/features/production/cutting-review-screen';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ worksheet?: string | string[] }>;
}) {
  const { worksheet } = await searchParams;
  if (typeof worksheet === 'string' && worksheet)
    redirect(`/stations/review/${encodeURIComponent(worksheet)}`);
  return <CuttingReviewScreen />;
}
